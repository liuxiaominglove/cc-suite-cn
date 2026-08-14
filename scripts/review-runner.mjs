import { spawn as nodeSpawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { resolve, sep, join, relative, dirname } from "node:path";
import { tmpdir } from "node:os";
import { jsonrepair } from "jsonrepair";
import { buildCommand, READ_ONLY_DECLARATION } from "./backends.mjs";
import { runProcess, setSpawn, RunnerError, TimeoutError } from "./runner-core.mjs";

export { setSpawn, RunnerError, TimeoutError };

export const DEFAULT_EXTS = [".swift", ".js", ".ts", ".tsx", ".jsx", ".py", ".go", ".rs", ".java", ".kt", ".c", ".cpp", ".h", ".m", ".mm"];
export const DEFAULT_TIMEOUT = 900000;
const MAX_FILES_WARN = 50;
const SKIP_DIRS = new Set(["node_modules", ".git", ".build", "DerivedData", "Pods", "__pycache__", "dist", "build", ".next", ".turbo"]);

const DEFAULT_RETRY_BACKOFF_MS = [10000, 30000];
let _retryBackoffMs = DEFAULT_RETRY_BACKOFF_MS;

export function setRetryBackoffMs(ms) {
  _retryBackoffMs = ms ?? DEFAULT_RETRY_BACKOFF_MS;
}

export async function withRetry(fn, { maxRetries = 0, backoffMs = _retryBackoffMs } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const retryable = err instanceof TimeoutError || err instanceof RunnerError;
      if (!retryable || attempt >= maxRetries) throw err;
      const delay = backoffMs[attempt] ?? backoffMs[backoffMs.length - 1] ?? 0;
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}

export const REVIEW_PROMPT = "Review the following code for bugs, security issues, and code quality problems. Write the `finding` and `fix` fields in English. Output the result as a JSON object with fields: severity (high/medium/low), issues (array of {file, line, finding, fix}), and summary (string).";

export const NL_REVIEW_PROMPT = "Review the following natural-language prompt artifact (an opencode command, skill, agent, or rule definition), NOT executable code. Evaluate quality across these dimensions: (1) trigger description clarity; (2) explicit output format; (3) error-path coverage (empty input, missing files, malformed input); (4) vague quantifiers; (5) prohibitions without alternatives; (6) internal consistency with companion SKILL.md or AGENTS.md. Write the `finding` and `fix` fields in English. Output the result as a JSON object with fields: severity (high/medium/low), issues (array of {file, line, finding, fix}), and summary (string).";

export function isNLArtifact(file) {
  if (typeof file !== "string" || !file) return false;
  const f = file.toLowerCase();
  if (!f.endsWith(".md")) return false;
  return (
    f.includes("/commands/") ||
    f.includes("/skills/") ||
    f.includes("/agents/") ||
    f.includes("/rules/") ||
    f.endsWith("skill.md") ||
    f.endsWith("agents.md") ||
    f.endsWith("claude.md")
  );
}

export const VERIFY_PROMPT = "以下是本次代码改动（git diff 输出，`-` 行是删除/改前，`+` 行是新增/改后，每个 `@@` 是一处改动区域）。请逐处（每个 @@）验证：① 改动是否正确实现目标；② 有无引入回归或新 bug；③ 有无遗漏。输出 JSON：{ \"severity\": \"high/medium/low\", \"issues\": [{ \"file\": \"路径\", \"line\": 行号, \"finding\": \"描述\", \"fix\": \"建议\" }], \"summary\": \"总体结论\" }，finding 和 fix 字段请用英文输出，line 指改动后文件的行号。";

const RULE_FILES = ["AGENTS.md", "CLAUDE.md"];
const RULES_MAX_LINES = 400;

function truncateLines(text, maxLines) {
  const lines = text.split("\n");
  return lines.length <= maxLines ? text : lines.slice(0, maxLines).join("\n");
}

export async function collectProjectRules({ cwd = process.cwd(), readFile = null, ruleFiles = RULE_FILES, maxLines = RULES_MAX_LINES } = {}) {
  const read = readFile ?? (async (p) => (await import("node:fs/promises")).readFile(p, "utf-8"));
  const sections = [];
  for (const name of ruleFiles) {
    const filePath = join(cwd, name);
    try {
      const raw = await read(filePath);
      if (typeof raw === "string" && raw.trim()) {
        sections.push(`=== ${name} ===\n${truncateLines(raw, maxLines)}`);
      }
    } catch {
      // 规则文件不存在或不可读：跳过，不拖垮评审
    }
  }
  return sections.join("\n\n");
}

export function buildRulesSection(rules) {
  const text = (rules ?? "").trim();
  return text ? `\n\n[项目规则]\n${text}` : "";
}

let _gitSpawn = null;

export function setGitSpawn(fn) {
  _gitSpawn = fn;
}

export class AuthError extends Error {
  constructor(message = "Authentication failed") {
    super(message);
    this.name = "AuthError";
  }
}

export async function collectSourceFiles(dirPath, exts = DEFAULT_EXTS) {
  const { readdir } = await import("node:fs/promises");

  const files = [];
  const entries = await readdir(dirPath, { withFileTypes: true });

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith(".")) continue;

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const sub = await collectSourceFiles(join(dirPath, entry.name), exts);
      files.push(...sub);
    } else if (entry.isFile()) {
      if (exts.some((e) => entry.name.endsWith(e))) {
        files.push(join(dirPath, entry.name));
      }
    }
  }

  return files;
}

export function validateFilePath(filePath, baseDir = process.cwd(), opts = {}) {
  if (opts.allowExternal) return resolve(baseDir, filePath);

  const resolved = resolve(baseDir, filePath);
  const resolvedBase = resolve(baseDir);
  if (resolved !== resolvedBase && !resolved.startsWith(resolvedBase + sep)) {
    throw new RunnerError("File path is outside project directory", { exitCode: -1, stderr: "Invalid file path" });
  }
  return resolved;
}

export function extractJson(text) {
  if (typeof text !== "string" || !text.trim()) return null;

  const candidates = [];
  const push = (c) => {
    const t = (c ?? "").trim();
    if (t && !candidates.includes(t)) candidates.push(t);
  };

  push(text);

  const jsonBlock = text.match(/```json\s*([\s\S]*?)```\s*$/m);
  if (jsonBlock) push(jsonBlock[1]);

  const anyBlock = text.match(/```\s*([\s\S]*?)```\s*$/m);
  if (anyBlock) push(anyBlock[1]);

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    push(text.substring(firstBrace, lastBrace + 1));
  }

  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {}
  }

  for (const c of candidates) {
    if (!/[{[[]/.test(c)) continue;
    try {
      return JSON.parse(jsonrepair(c));
    } catch {}
  }

  return null;
}

export function frameCode(code) {
  let maxRun = 0;
  let cur = 0;
  for (const ch of code) {
    if (ch === "`") {
      cur += 1;
      if (cur > maxRun) maxRun = cur;
    } else {
      cur = 0;
    }
  }
  const fence = "`".repeat(Math.max(3, maxRun + 1));
  return `${fence}\n${code}\n${fence}`;
}

export function resolveReviewCwd(backend) {
  return backend === "kimi" || backend === "qwen" ? tmpdir() : undefined;
}

function isAuthError(stderr) {
  const lower = stderr.toLowerCase();
  return lower.includes("401") || lower.includes("unauthorized") || lower.includes("invalid api key");
}

export function getDiff({ cwd = process.cwd(), spawn } = {}) {
  const gitSpawn = spawn ?? _gitSpawn ?? nodeSpawn;

  return new Promise((resolve, reject) => {
    let proc;
    try {
      proc = gitSpawn("git", ["diff", "HEAD"], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      if (err.code === "ENOENT") {
        reject(new RunnerError("git not found", { exitCode: -1, stderr: err.message }));
      } else {
        reject(err);
      }
      return;
    }

    const stdout = [];
    const stderr = [];
    proc.stdout.on("data", (c) => stdout.push(Buffer.from(c)));
    proc.stderr.on("data", (c) => stderr.push(Buffer.from(c)));
    proc.on("error", (err) => {
      if (err.code === "ENOENT") {
        reject(new RunnerError("git not found", { exitCode: -1, stderr: err.message }));
      } else {
        reject(err);
      }
    });
    proc.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString("utf-8"));
      } else {
        reject(new RunnerError(`git exited with code ${code}`, { exitCode: code, stderr: Buffer.concat(stderr).toString("utf-8") }));
      }
    });
  });
}

export async function review({ model, code, customPrompt, timeout = DEFAULT_TIMEOUT, file, dir, exts, allowExternal = false, backend = "codebuddy", diff = false, retries = 0, cwd = process.cwd(), projectRules = null, fileName = null }) {

  let ruleCwd = cwd;

  if (!model || typeof model !== "string") {
    throw new RunnerError("model is required", { exitCode: -1, stderr: "model parameter is required" });
  }

  if (model.startsWith("-")) {
    throw new RunnerError("invalid model name", { exitCode: -1, stderr: "model must not start with -" });
  }

  if (diff) {
    if (code || file || dir) {
      throw new RunnerError("diff is mutually exclusive with code, file, and dir", { exitCode: -1, stderr: "Cannot combine diff with code/file/dir" });
    }
    const diffText = await getDiff();
    if (!diffText.trim()) {
      return { model, success: false, summary: "no changes to verify (git diff HEAD is empty)", issues: [] };
    }
    code = diffText;
  }

  if (!Number.isFinite(timeout) || timeout <= 0) {
    timeout = DEFAULT_TIMEOUT;
  }

  if (dir != null && typeof dir !== "string") {
    throw new RunnerError("dir must be a string", { exitCode: -1, stderr: "Invalid dir type" });
  }

  if (dir) {
    if (code || file) {
      throw new RunnerError("dir is mutually exclusive with code and file", { exitCode: -1, stderr: "Cannot combine dir with code/file" });
    }

    const { readFile } = await import("node:fs/promises");
    const resolvedDir = validateFilePath(dir, process.cwd(), { allowExternal });
    ruleCwd = resolvedDir;
    const resolvedExts = exts ?? DEFAULT_EXTS;
    const srcFiles = await collectSourceFiles(resolvedDir, resolvedExts);

    if (srcFiles.length === 0) {
      return {
        model,
        success: false,
        summary: `No source files found in ${dir} (exts: ${resolvedExts.join(",")})`,
        issues: [],
        dir,
        fileCount: 0,
      };
    }

    const parts = [];
    for (const f of srcFiles) {
      const relPath = relative(resolvedDir, f);
      const content = await readFile(f, "utf-8");
      parts.push(`// === File: ${relPath} ===\n${content}`);
    }
    code = parts.join("\n\n");

    if (srcFiles.length > MAX_FILES_WARN) {
      process.stderr.write(`Warning: ${srcFiles.length} source files found — review may hit token limits\n`);
    }
  }

  if (!code && !file) {
    throw new RunnerError("code or file or dir is required", { exitCode: -1, stderr: "No code content provided" });
  }

  if (code !== undefined && typeof code !== "string") {
    throw new RunnerError("code must be a string", { exitCode: -1, stderr: "Invalid code type" });
  }

  if (customPrompt != null && typeof customPrompt !== "string") {
    throw new RunnerError("customPrompt must be a string", { exitCode: -1, stderr: "Invalid customPrompt type" });
  }

  if (file !== undefined && file !== null && typeof file !== "string") {
    throw new RunnerError("file must be a string", { exitCode: -1, stderr: "Invalid file type" });
  }

  if (file) {
    const { readFile } = await import("node:fs/promises");
    const resolved = validateFilePath(file, process.cwd(), { allowExternal });
    code = await readFile(resolved, "utf-8");
    ruleCwd = dirname(resolved);
  }

  const prompt = customPrompt ?? (diff ? VERIFY_PROMPT : (isNLArtifact(file) ? NL_REVIEW_PROMPT : REVIEW_PROMPT));

  const readOnlyPrefix = `${READ_ONLY_DECLARATION}\n\n`;
  const rules = projectRules ?? (await collectProjectRules({ cwd: ruleCwd }));
  const fileLabel = fileName ? `\n\nFILE: ${fileName}` : "";
  const fullPrompt = `${readOnlyPrefix}${prompt}${buildRulesSection(rules)}${fileLabel}\n\nCODE:\n${frameCode(code)}`;

  const { command, args, stdin } = buildCommand(backend, { model, prompt: fullPrompt });

  const { stdout } = await withRetry(async () => {
    const { exitCode, signal: exitSignal, stdout, stderr, timedOut } = await runProcess({ command, args, stdin, timeout, cwd: resolveReviewCwd(backend) });

    if (timedOut) {
      throw new TimeoutError();
    }

    const failed = exitCode !== 0 || (exitCode === null && exitSignal !== null);
    if (failed && isAuthError(stderr)) {
      throw new AuthError();
    }

    if (failed) {
      throw new RunnerError(`${command} exited with code ${exitCode}, signal ${exitSignal}`, { exitCode, stderr });
    }

    return { stdout };
  }, { maxRetries: retries });

  if (!stdout.trim()) {
    return {
      model,
      success: false,
      summary: "No output from reviewer",
      issues: [],
    };
  }

  const parsed = extractJson(stdout);
  if (parsed) {
    return {
      model,
      success: true,
      severity: parsed.severity ?? "unknown",
      issues: parsed.issues ?? [],
      summary: parsed.summary ?? "",
    };
  }

  return {
    model,
    success: true,
    severity: "unknown",
    issues: [],
    summary: stdout.trim(),
    parseError: true,
  };
}

export function chunkCode(code, { chunkSize = 800, overlap = 10 } = {}) {
  const text = typeof code === "string" ? code : "";
  const lines = text.split("\n");
  if (lines.length <= chunkSize) {
    return [{ code: text, startLine: 1 }];
  }
  const chunks = [];
  let start = 0;
  while (start < lines.length) {
    const end = Math.min(start + chunkSize, lines.length);
    chunks.push({ code: lines.slice(start, end).join("\n"), startLine: start + 1 });
    if (end >= lines.length) break;
    start = end - overlap;
  }
  return chunks;
}

export function offsetFindings(chunkResults) {
  const all = [];
  for (const { startLine, result } of chunkResults) {
    if (!result || result.success === false) continue;
    for (const issue of result.issues || []) {
      const line = typeof issue.line === "number" ? issue.line + startLine - 1 : issue.line;
      all.push({ ...issue, line });
    }
  }
  return all;
}

export async function reviewFile({ model, backend, file, chunkSize = 800, overlap = 10, timeout = DEFAULT_TIMEOUT, customPrompt = null, allowExternal = false, reviewFn = null, readFn = null, retries = 0 }) {
  const reviewFnUsed = reviewFn ?? review;
  const read = readFn ?? (async (f) => {
    const { readFile } = await import("node:fs/promises");
    const resolved = validateFilePath(f, process.cwd(), { allowExternal });
    return readFile(resolved, "utf-8");
  });

  let code;
  try {
    code = await read(file);
  } catch (err) {
    return reviewFnUsed({ model, backend, file, timeout, customPrompt, allowExternal, retries });
  }

  const chunks = chunkCode(code, { chunkSize, overlap });
  if (chunks.length === 1) {
    return reviewFnUsed({ model, backend, code, timeout, customPrompt, retries, fileName: file });
  }

  const chunkResults = await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const r = await reviewFnUsed({ model, backend, code: chunk.code, timeout, customPrompt, retries, fileName: file });
        return { startLine: chunk.startLine, result: r };
      } catch (err) {
        return { startLine: chunk.startLine, result: { success: false, error: err.message } };
      }
    })
  );

  const issues = offsetFindings(chunkResults);
  const severity = chunkResults.find((c) => c.result?.severity)?.result?.severity ?? "unknown";

  return {
    model,
    success: chunkResults.some((c) => c.result?.success),
    severity,
    issues,
    summary: `分 ${chunks.length} 块评审`,
    chunkCount: chunks.length,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const modelIdx = args.indexOf("--model");
  const fileIdx = args.indexOf("--file");
  const dirIdx = args.indexOf("--dir");
  const extsIdx = args.indexOf("--exts");
  const promptIdx = args.indexOf("--prompt");
  const timeoutIdx = args.indexOf("--timeout");
  const backendIdx = args.indexOf("--backend");
  const allowExternal = args.includes("--allow-external");
  const diff = args.includes("--diff");

  if (modelIdx === -1) {
    console.error("Usage: node review-runner.mjs --model <model> --file <path> [--prompt <text>] [--timeout <ms>]");
    console.error("       node review-runner.mjs --model <model> --dir <path> --exts <.ext1,.ext2> [--prompt <text>] [--timeout <ms>]");
    console.error("       node review-runner.mjs --model <model> --diff [--backend <name>]");
    process.exit(1);
  }

  const model = args[modelIdx + 1];
  if (!model || model.startsWith("--")) {
    console.error("--model requires a valid model name");
    process.exit(1);
  }

  const file = fileIdx !== -1 ? args[fileIdx + 1] : null;
  const dir = dirIdx !== -1 ? args[dirIdx + 1] : null;
  const extsRaw = extsIdx !== -1 ? args[extsIdx + 1] : null;
  const exts = extsRaw ? extsRaw.split(",").map((e) => e.trim()) : null;
  const customPrompt = promptIdx !== -1 ? args[promptIdx + 1] : null;

  const rawTimeout = timeoutIdx !== -1 ? parseInt(args[timeoutIdx + 1], 10) : DEFAULT_TIMEOUT;
  const timeout = Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : DEFAULT_TIMEOUT;
  const backend = backendIdx !== -1 ? args[backendIdx + 1] : "codebuddy";

  if (file && dir) {
    console.error("--file and --dir are mutually exclusive");
    process.exit(1);
  }

  if (!file && !dir && !diff) {
    console.error("Either --file, --dir, or --diff is required");
    process.exit(1);
  }

  const useChunking = !!(file && !dir && !diff);
  const result = useChunking
    ? await reviewFile({ model, backend, file, customPrompt, allowExternal, timeout })
    : await review({ model, file, dir, exts, customPrompt, timeout, allowExternal, backend, diff });
  console.log(JSON.stringify(result, null, 2));
  if (!result.success) process.exit(1);
}
