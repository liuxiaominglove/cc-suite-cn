import { spawn as nodeSpawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { resolve, sep, join, relative, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { jsonrepair } from "jsonrepair";
import { buildCommand, READ_ONLY_DECLARATION } from "./backends.mjs";
import { runProcess, setSpawn, RunnerError, TimeoutError, isMainModule } from "./runner-core.mjs";
import { CRITIC_MODEL } from "./models.mjs";

export { setSpawn, RunnerError, TimeoutError };

export const DEFAULT_EXTS = [".swift", ".js", ".ts", ".tsx", ".jsx", ".py", ".go", ".rs", ".java", ".kt", ".c", ".cpp", ".h", ".m", ".mm"];
export const DEFAULT_TIMEOUT = 900000;
const MAX_FILES_WARN = 50;
const SKIP_DIRS = new Set(["node_modules", ".git", ".build", "DerivedData", "Pods", "__pycache__", "dist", "build", ".next", ".turbo"]);

export const SOURCE_IMPORT_EXTS = [".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".tsx", ".jsx"];

const DEFAULT_RETRY_BACKOFF_MS = [10000, 30000];
let _retryBackoffMs = DEFAULT_RETRY_BACKOFF_MS;

export function setRetryBackoffMs(ms) {
  _retryBackoffMs = ms ?? DEFAULT_RETRY_BACKOFF_MS;
}

export async function withRetry(fn, { maxRetries = 0, backoffMs = _retryBackoffMs } = {}) {
  const attempts = Number.isFinite(maxRetries) && maxRetries > 0 ? Math.floor(maxRetries) : 0;
  let lastErr;
  for (let attempt = 0; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const retryable = err instanceof TimeoutError || err instanceof RunnerError;
      if (!retryable || attempt >= attempts) throw err;
      const delay = backoffMs[attempt] ?? backoffMs[backoffMs.length - 1] ?? 0;
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastErr ?? new Error("withRetry: fn was never called");
}

export const REVIEW_PROMPT = "Review the following code and report ONLY concrete bugs that cause incorrect behavior, security vulnerabilities, or data corruption/loss. Each `finding` must state (a) the trigger condition and (b) the actual impact. Do NOT report: code style, naming, minor performance suggestions, defensive null-check recommendations, or \"could be improved\" observations unless they cause a crash or data loss. Severity: high = crash/security/data corruption; medium = wrong behavior on specific input; low = edge case (report sparingly). Before reporting any bug, trace its call chain: locate the function the bug involves, find that function's implementation (in the CODE or in the `[项目上下文]` section listing imported modules), and confirm the bug genuinely exists in that implementation. If the function already handles the case (e.g. tilde expansion, path normalization, null guards), it is NOT a bug — do not report it. Write the `finding` and `fix` fields in English. Output the result as a JSON object with fields: chain_analysis (string: for EACH reported issue, name the function it involves and state what that function's implementation actually does), severity (high/medium/low), issues (array of {file, line, finding, fix}), and summary (string).";

export const NL_REVIEW_PROMPT = "Review the following natural-language prompt artifact (an opencode command, skill, agent, or rule definition), NOT executable code. Evaluate quality across these dimensions: (1) trigger description clarity; (2) explicit output format; (3) error-path coverage (empty input, missing files, malformed input); (4) vague quantifiers; (5) prohibitions without alternatives; (6) internal consistency with companion SKILL.md or AGENTS.md. Write the `finding` and `fix` fields in English. Output the result as a JSON object with fields: severity (high/medium/low), issues (array of {file, line, finding, fix}), and summary (string).";

export const CRITIC_PROMPT = "你是独立代码批判员（第二意见）。下方是其他评审员（glm/kimi）报的 finding 清单 + 完整代码。你的职责不是重新扫描代码，而是批判这份清单：1) 对每条 finding 判断「同意」(真 bug) 或「反对」(假阳)，并给一句理由（核查代码对应位置与被调用函数的真实实现，若该函数已处理了 finding 所说的问题，如 ~ 展开/路径归一化/null 守卫，则判反对）；2) 指出清单遗漏的真 bug（补漏）。输出 JSON：{\"verdicts\":[{\"index\":数字,\"agree\":true/false,\"reason\":\"一句理由\"}],\"missed\":[{\"file\":\"路径\",\"line\":数字,\"finding\":\"描述\"}]}";

export function buildCriticPrompt(findings, code) {
  const list = (findings ?? [])
    .map((f, i) => `[${i}] ${f.file ?? ""}:${f.line ?? ""} — ${f.finding ?? ""}`)
    .join("\n");
  return `${CRITIC_PROMPT}\n\nFINDINGS:\n${list || "（空清单）"}\n\nCODE:\n${frameCode(code ?? "")}`;
}

export async function criticize({ findings, code, model = CRITIC_MODEL, backend = "qwen", timeout = DEFAULT_TIMEOUT, spawn = null, retries = 0 }) {
  const prompt = buildCriticPrompt(findings, code);
  const { command, args, stdin } = buildCommand(backend, { model, prompt });

  const { stdout } = await withRetry(async () => {
    const { exitCode, signal: exitSignal, stdout, stderr, timedOut } = await runProcess({ command, args, stdin, timeout, spawn, cwd: resolveReviewCwd(backend) });
    if (timedOut) throw new TimeoutError();
    const failed = exitCode !== 0 || (exitCode === null && exitSignal !== null);
    if (failed && isAuthError(stderr)) throw new AuthError();
    if (failed) throw new RunnerError(`${command} exited with code ${exitCode}`, { exitCode, stderr });
    if (!stdout.trim()) throw new RunnerError(`${command} returned empty output (possible rate limit)`, { exitCode, stderr });
    return { stdout };
  }, { maxRetries: retries });

  const parsed = extractJson(stdout);
  if (!parsed || typeof parsed !== "object") {
    return { verdicts: [], missed: [] };
  }
  return {
    verdicts: Array.isArray(parsed.verdicts) ? parsed.verdicts : [],
    missed: Array.isArray(parsed.missed) ? parsed.missed : [],
  };
}

export function parseCriticArgs(args) {
  const fileIdx = args.indexOf("--file");
  const findingsIdx = args.indexOf("--findings-file");
  return {
    file: fileIdx !== -1 ? args[fileIdx + 1] : null,
    findingsFile: findingsIdx !== -1 ? args[findingsIdx + 1] : null,
  };
}

export const SELF_CHECK_PROMPT = "下面是你自己刚报的 finding 清单 + 完整代码。请逐条自检：对每条 finding，找到它涉及的函数，核对该函数的真实实现（在 CODE 或 [项目上下文] 里）——若该函数已处理了所说的问题（如 ~ 展开、路径归一化、null 守卫），就把这条判 keep=false。只保留经自检仍成立的 finding。输出 JSON：{\"survivors\":[{\"index\":数字,\"keep\":true/false,\"reason\":\"一句理由\"}]}";

export function buildSelfCheckPrompt(findings, code) {
  const list = (findings ?? [])
    .map((f, i) => `[${i}] ${f.file ?? ""}:${f.line ?? ""} — ${f.finding ?? ""}`)
    .join("\n");
  return `${SELF_CHECK_PROMPT}\n\nFINDINGS:\n${list || "（空清单）"}\n\nCODE:\n${frameCode(code ?? "")}`;
}

export async function selfCheck({ findings, code, model, backend = "codebuddy", timeout = DEFAULT_TIMEOUT, spawn = null, retries = 0 }) {
  const prompt = buildSelfCheckPrompt(findings, code);
  const { command, args, stdin } = buildCommand(backend, { model, prompt });

  const { stdout } = await withRetry(async () => {
    const { exitCode, signal: exitSignal, stdout, stderr, timedOut } = await runProcess({ command, args, stdin, timeout, spawn, cwd: resolveReviewCwd(backend) });
    if (timedOut) throw new TimeoutError();
    const failed = exitCode !== 0 || (exitCode === null && exitSignal !== null);
    if (failed && isAuthError(stderr)) throw new AuthError();
    if (failed) throw new RunnerError(`${command} exited with code ${exitCode}`, { exitCode, stderr });
    return { stdout };
  }, { maxRetries: retries });

  const parsed = extractJson(stdout);
  if (!parsed || !Array.isArray(parsed.survivors)) {
    return { survivors: [] };
  }
  return { survivors: parsed.survivors };
}

export function applySelfCheck(findings, survivors) {
  const keep = new Set(
    (survivors ?? [])
      .filter((s) => s && s.keep === true)
      .map((s) => Number(s.index))
      .filter((n) => Number.isInteger(n) && n >= 0)
  );
  return (findings ?? []).filter((_, i) => keep.has(i));
}

export function isNLArtifact(file) {
  if (typeof file !== "string" || !file) return false;
  const f = file.toLowerCase();
  if (!f.endsWith(".md")) return false;
  const bn = basename(f);
  return (
    f.includes("/commands/") ||
    f.includes("/skills/") ||
    f.includes("/agents/") ||
    f.includes("/rules/") ||
    bn === "skill.md" ||
    bn === "agents.md" ||
    bn === "claude.md"
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
    let dir = cwd;
    for (;;) {
      const filePath = join(dir, name);
      try {
        const raw = await read(filePath);
        if (typeof raw === "string" && raw.trim()) {
          sections.push(`=== ${name} ===\n${truncateLines(raw, maxLines)}`);
          break;
        }
      } catch {
        // 规则文件不存在或不可读：向上一级目录继续找
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return sections.join("\n\n");
}

export function buildRulesSection(rules) {
  const text = (rules ?? "").trim();
  return text ? `\n\n[项目规则]\n${text}` : "";
}

export const WORKER_LESSONS_FILE = fileURLToPath(new URL("./worker-lessons.md", import.meta.url));

export function stripMarkdownComments(text) {
  return String(text ?? "").replace(/<!--[\s\S]*?-->/g, "");
}

export async function collectWorkerLessons({ readFile = null, filePath = WORKER_LESSONS_FILE, maxLines = 200 } = {}) {
  const read = readFile ?? (async (p) => (await import("node:fs/promises")).readFile(p, "utf-8"));
  try {
    const raw = await read(filePath);
    if (typeof raw === "string" && raw.trim()) {
      return truncateLines(stripMarkdownComments(raw), maxLines);
    }
  } catch {
    // 教训书不存在或不可读：不注入，静默跳过
  }
  return "";
}

export function buildLessonsSection(lessons) {
  const text = (lessons ?? "").trim();
  return text ? `\n\n[评审教训]\n${text}` : "";
}

function extractExports(content) {
  const names = [];
  const declRe = /export\s+(?:async\s+)?(?:function|const|class|let|var)\s+([\w$]+)/g;
  let m;
  while ((m = declRe.exec(content)) !== null) {
    names.push(m[1]);
  }
  const namedRe = /export\s*\{([^}]+)\}/g;
  while ((m = namedRe.exec(content)) !== null) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) names.push(name);
    }
  }
  return [...new Set(names)];
}

export async function collectImportContext(filePath, { readFile = null } = {}) {
  const read = readFile ?? (async (p) => (await import("node:fs/promises")).readFile(p, "utf-8"));
  const content = await read(filePath).catch(() => "");
  if (!content) return "";

  const baseDir = dirname(filePath);
  const patterns = [
    /import[^;'"]*?from\s*['"](\.[^'"]+)['"]/g,
    /import\s*['"](\.[^'"]+)['"]/g,
    /require\(\s*['"](\.[^'"]+)['"]/g,
  ];
  const localImports = [];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(content)) !== null) {
      localImports.push(m[1]);
    }
  }
  if (localImports.length === 0) return "";

  const parts = [];
  for (const imp of [...new Set(localImports)]) {
    const abs = resolve(baseDir, imp);
    const hasSourceExt = SOURCE_IMPORT_EXTS.some((e) => abs.endsWith(e));
    const indexCandidates = [`${abs}/index.js`, `${abs}/index.mjs`, `${abs}/index.ts`];
    const extCandidates = SOURCE_IMPORT_EXTS.map((e) => `${abs}${e}`);
    const candidates = hasSourceExt ? [abs, ...indexCandidates] : [...extCandidates, ...indexCandidates];
    let modContent = null;
    for (const c of candidates) {
      const r = await read(c).catch(() => null);
      if (r != null) {
        modContent = r;
        break;
      }
    }
    if (modContent == null) continue;
    if (modContent.split("\n").length <= 80) {
      parts.push(`${imp}:\n${modContent}`);
    } else {
      const exports = extractExports(modContent);
      if (exports.length) parts.push(`${imp} 导出: ${exports.join(", ")}`);
    }
  }
  return parts.length ? parts.join("\n\n") : "";
}

function summarizeStack(filename, content) {
  if (filename === "package.json") {
    try {
      const pkg = JSON.parse(content);
      if (!pkg || typeof pkg !== "object") return "";
      const parts = [];
      const engine = pkg.engines?.node;
      parts.push(`Node.js${engine ? ` (node ${engine})` : ""}`);
      const deps = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];
      if (deps.length) parts.push(`deps: ${deps.slice(0, 10).join(", ")}`);
      if (pkg.scripts?.test) {
        const t = String(pkg.scripts.test);
        parts.push(`test: ${t.length > 60 ? t.slice(0, 60) + "…" : t}`);
      }
      return parts.join(" | ");
    } catch {
      return "";
    }
  }
  if (filename === "requirements.txt") {
    const deps = content
      .split("\n")
      .map((l) => l.trim().split(/[<>=!~\s\[]/)[0])
      .filter((d) => d && !d.startsWith("#") && !d.startsWith("-"))
      .slice(0, 10);
    return `Python${deps.length ? ` | deps: ${deps.join(", ")}` : ""}`;
  }
  if (filename === "pyproject.toml") {
    return "Python";
  }
  if (filename === "go.mod") {
    const m = content.match(/^go (\d+\.\d+)/m);
    return `Go${m ? ` (go ${m[1]})` : ""}`;
  }
  if (filename === "Cargo.toml") {
    return "Rust";
  }
  return "";
}

export async function collectStackContext(dir, { readFile = null } = {}) {
  const read = readFile ?? (async (p) => (await import("node:fs/promises")).readFile(p, "utf-8"));
  const stackFiles = ["package.json", "requirements.txt", "pyproject.toml", "go.mod", "Cargo.toml"];
  let cur = dir;
  for (;;) {
    for (const f of stackFiles) {
      const content = await read(join(cur, f)).catch(() => null);
      if (content != null) {
        const summary = summarizeStack(f, content);
        if (summary) return summary;
      }
    }
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return "";
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

export class SourceTamperedError extends Error {
  constructor(message = "Reviewed source files were modified during review") {
    super(message);
    this.name = "SourceTamperedError";
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
  const basePrefix = resolvedBase.endsWith(sep) ? resolvedBase : resolvedBase + sep;
  if (resolved !== resolvedBase && !resolved.startsWith(basePrefix)) {
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

export function hashFileContent(content) {
  return createHash("sha256").update(String(content ?? "")).digest("hex");
}

export async function snapshotSourceHashes(paths, { readFile = null } = {}) {
  const read = readFile ?? (async (p) => (await import("node:fs/promises")).readFile(p));
  const hashes = {};
  for (const p of paths ?? []) {
    if (!p || typeof p !== "string") continue;
    try {
      const content = await read(p);
      hashes[p] = hashFileContent(content);
    } catch {
      // 读不到的文件跳过（文件可能不存在，如 code 内联但 file 只是标签）
    }
  }
  return hashes;
}

// 只检测「被审文件被修改」：只遍历 before 的 key。
// 评审期间新建的文件不在被审集合内，其风险已由 cwd 隔离（tmpdir）兜底，故不在此检测。
export function hashesDiffer(before, after) {
  for (const [p, h] of Object.entries(before ?? {})) {
    if ((after ?? {})[p] !== h) return true;
  }
  return false;
}

/**
 * 所有 backend 的子进程 cwd 统一隔离到 tmpdir。
 * 调用方仍传 backend（`resolveReviewCwd(backend)`），此处故意忽略——
 * code 与项目规则已内联进 prompt，评审员无需项目 cwd；未知 backend 也 fail-safe 到 tmpdir。
 */
export function resolveReviewCwd() {
  return tmpdir();
}

export function isAuthError(stderr) {
  const lower = String(stderr ?? "").toLowerCase();
  if (lower.includes("unauthorized") || lower.includes("invalid api key")) return true;
  return /(?:^|[\s=(])(?:HTTP[\s/]*)?401\b(?![:\d])/.test(lower);
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

export async function review({ model, code, customPrompt, timeout = DEFAULT_TIMEOUT, file, dir, exts, allowExternal = false, backend = "codebuddy", diff = false, retries = 0, cwd = process.cwd(), projectRules = null, fileName = null, feedbackPreamble = null, workerLessons = null }) {

  let ruleCwd = cwd;
  let importContext = "";
  let stackContext = "";
  let sourcePaths = [];

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
    const diffText = await getDiff({ cwd });
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
    const resolvedDir = validateFilePath(dir, cwd, { allowExternal });
    ruleCwd = resolvedDir;
    stackContext = await collectStackContext(resolvedDir);
    const resolvedExts = exts ?? DEFAULT_EXTS;
    const srcFiles = await collectSourceFiles(resolvedDir, resolvedExts);
    sourcePaths = srcFiles;

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
    const resolved = validateFilePath(file, cwd, { allowExternal });
    ruleCwd = dirname(resolved);
    sourcePaths = [resolved];
    if (!isNLArtifact(fileName ?? file)) {
      importContext = await collectImportContext(resolved);
      stackContext = await collectStackContext(ruleCwd);
    }
    if (typeof code !== "string" || code === "") {
      const { readFile } = await import("node:fs/promises");
      code = await readFile(resolved, "utf-8");
    }
  }

  const prompt = customPrompt ?? (diff ? VERIFY_PROMPT : (isNLArtifact(fileName ?? file) ? NL_REVIEW_PROMPT : REVIEW_PROMPT));

  const readOnlyPrefix = `${READ_ONLY_DECLARATION}\n\n`;
  const feedbackSection = feedbackPreamble ? `${feedbackPreamble}\n\n` : "";
  const rules = projectRules ?? (await collectProjectRules({ cwd: ruleCwd }));
  const lessons = workerLessons ?? (await collectWorkerLessons());
  const fileLabel = fileName ? `\n\nFILE: ${fileName}` : "";
  const importSection = importContext ? `\n\n[项目上下文] 本文件 import 的本地模块：\n${importContext}` : "";
  const stackSection = stackContext ? `\n\n[技术栈] ${stackContext}` : "";
  const fullPrompt = `${readOnlyPrefix}${feedbackSection}${prompt}${buildRulesSection(rules)}${buildLessonsSection(lessons)}${stackSection}${importSection}${fileLabel}\n\nCODE:\n${frameCode(code)}`;

  const beforeHashes = await snapshotSourceHashes(sourcePaths);

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

    if (!stdout.trim()) {
      throw new RunnerError(`${command} returned empty output (possible rate limit)`, { exitCode, stderr });
    }

    return { stdout };
  }, { maxRetries: retries });

  const afterHashes = await snapshotSourceHashes(sourcePaths);
  if (hashesDiffer(beforeHashes, afterHashes)) {
    throw new SourceTamperedError();
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
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new Error("chunkSize must be a positive integer");
  }
  if (!Number.isInteger(overlap) || overlap < 0 || overlap >= chunkSize) {
    throw new Error("overlap must be a non-negative integer less than chunkSize");
  }
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

export async function reviewFile({ model, backend, file, chunkSize = 800, overlap = 10, timeout = DEFAULT_TIMEOUT, customPrompt = null, allowExternal = false, reviewFn = null, readFn = null, retries = 0, feedbackPreamble = null }) {
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
    return reviewFnUsed({ model, backend, file, timeout, customPrompt, allowExternal, retries, feedbackPreamble });
  }

  const chunks = chunkCode(code, { chunkSize, overlap });
  if (chunks.length === 1) {
    return reviewFnUsed({ model, backend, code, file, timeout, customPrompt, allowExternal, retries, fileName: file, feedbackPreamble });
  }

  const chunkResults = await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const r = await reviewFnUsed({ model, backend, code: chunk.code, file, timeout, customPrompt, allowExternal, retries, fileName: file, feedbackPreamble });
        return { startLine: chunk.startLine, result: r };
      } catch (err) {
        return { startLine: chunk.startLine, result: { success: false, error: err.message } };
      }
    })
  );

  const issues = offsetFindings(chunkResults);
  const SEVERITY_ORDER = { high: 3, medium: 2, low: 1 };
  const severity = chunkResults.reduce((worst, c) => {
    const s = c.result?.severity;
    if (!s) return worst;
    return (SEVERITY_ORDER[s] ?? 0) > (SEVERITY_ORDER[worst] ?? 0) ? s : worst;
  }, "unknown");

  const chunkErrors = chunkResults
    .filter((c) => !c.result?.success)
    .map((c) => ({ startLine: c.startLine, error: c.result?.error ?? "unknown error" }));

  return {
    model,
    success: chunkResults.every((c) => c.result?.success),
    severity,
    issues,
    chunkErrors,
    summary: `分 ${chunks.length} 块评审`,
    chunkCount: chunks.length,
  };
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  const criticIdx = args.indexOf("--critic");
  if (criticIdx !== -1) {
    const { file, findingsFile } = parseCriticArgs(args);
    const backend = args.indexOf("--backend") !== -1 ? args[args.indexOf("--backend") + 1] : "qwen";
    const model = args.indexOf("--model") !== -1 ? args[args.indexOf("--model") + 1] : CRITIC_MODEL;
    if (!file || !findingsFile) {
      console.error("Usage: node review-runner.mjs --critic --file <path> --findings-file <json-file> [--backend qwen] [--model ...]");
      process.exit(1);
    }
    const { readFile } = await import("node:fs/promises");
    const code = await readFile(file, "utf-8");
    const findings = JSON.parse(await readFile(findingsFile, "utf-8"));
    let result;
    try {
      result = await criticize({ findings, code, model, backend, retries: 2 });
    } catch (err) {
      result = { verdicts: [], missed: [], error: err?.message ?? String(err) };
    }
    if (result.missed?.length) {
      try {
        const { persistMissed } = await import("./missed-log.mjs");
        const entries = result.missed.map((m) => ({
          file: m.file ?? file,
          line: m.line ?? null,
          finding: m.finding ?? "",
          source: "qwen-critic",
          projectDir: process.cwd(),
          timestamp: new Date().toISOString(),
        }));
        await persistMissed(entries);
      } catch {
        // 漏报落库失败不阻断批判输出
      }
    }
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }

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
  if (!backend || backend.startsWith("--")) {
    console.error("--backend requires a value (codebuddy/kimi/qwen)");
    process.exit(1);
  }

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
