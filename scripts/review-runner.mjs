import { spawn as nodeSpawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { resolve, sep, join, relative } from "node:path";
import { buildCommand, READ_ONLY_DECLARATION } from "./backends.mjs";

export const DEFAULT_EXTS = [".swift", ".js", ".ts", ".tsx", ".jsx", ".py", ".go", ".rs", ".java", ".kt", ".c", ".cpp", ".h", ".m", ".mm"];
const MAX_FILES_WARN = 50;
const SKIP_DIRS = new Set(["node_modules", ".git", ".build", "DerivedData", "Pods", "__pycache__", "dist", "build", ".next", ".turbo"]);

export const VERIFY_PROMPT = "以下是本次代码改动（git diff 输出，`-` 行是删除/改前，`+` 行是新增/改后，每个 `@@` 是一处改动区域）。请逐处（每个 @@）验证：① 改动是否正确实现目标；② 有无引入回归或新 bug；③ 有无遗漏。输出 JSON：{ \"severity\": \"high/medium/low\", \"issues\": [{ \"file\": \"路径\", \"line\": 行号, \"finding\": \"描述\", \"fix\": \"建议\" }], \"summary\": \"总体结论\" }，line 指改动后文件的行号。";

let _spawn = null;

export function setSpawn(fn) {
  _spawn = fn;
}

let _gitSpawn = null;

export function setGitSpawn(fn) {
  _gitSpawn = fn;
}

export class RunnerError extends Error {
  constructor(message, { exitCode, stderr } = {}) {
    super(message);
    this.name = "RunnerError";
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

export class TimeoutError extends Error {
  constructor(message = "Review timed out") {
    super(message);
    this.name = "TimeoutError";
  }
}

export class AuthError extends Error {
  constructor(message = "Authentication failed") {
    super(message);
    this.name = "AuthError";
  }
}

const SIGKILL_DELAY = 5000;

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

function collectStream(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    stream.on("error", reject);
  });
}

export function extractJson(text) {
  try {
    return JSON.parse(text);
  } catch {}

  const jsonBlock = text.match(/```json\s*([\s\S]*?)```\s*$/m);
  if (jsonBlock) {
    try {
      return JSON.parse(jsonBlock[1].trim());
    } catch {}
  }

  const anyBlock = text.match(/```\s*([\s\S]*?)```\s*$/m);
  if (anyBlock) {
    try {
      return JSON.parse(anyBlock[1].trim());
    } catch {}
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(text.substring(firstBrace, lastBrace + 1));
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

export async function review({ model, code, customPrompt, timeout = 60000, file, dir, exts, allowExternal = false, backend = "codebuddy", diff = false }) {

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
    timeout = 60000;
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
  }

  const spawn = _spawn ?? nodeSpawn;
  const prompt = customPrompt ?? (diff ? VERIFY_PROMPT : "Review the following code for bugs, security issues, and code quality problems. Output the result as a JSON object with fields: severity (high/medium/low), issues (array of {file, line, finding, fix}), and summary (string).");

  const readOnlyPrefix = backend === "codebuddy" ? "" : `${READ_ONLY_DECLARATION}\n\n`;
  const fullPrompt = `${readOnlyPrefix}${prompt}\n\nCODE:\n${frameCode(code)}`;

  const { command, args, stdin } = buildCommand(backend, { model, prompt: fullPrompt });

  let proc;
  try {
    proc = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new RunnerError(`${command} not found`, { exitCode: -1, stderr: err.message });
    }
    throw err;
  }

  if (stdin !== null) {
    try {
      proc.stdin.write(stdin);
      proc.stdin.end();
    } catch (err) {
      proc.kill("SIGKILL");
      throw new RunnerError(`failed to write to ${command} stdin`, { exitCode: -1, stderr: err.message });
    }
  }

  const stdoutPromise = collectStream(proc.stdout);
  const stderrPromise = collectStream(proc.stderr);

  let closeHandler, errorHandler;
  const closePromise = new Promise((resolve, reject) => {
    closeHandler = (code, signal) => {
      resolve({ code, signal });
    };
    errorHandler = (err) => reject(err);
    proc.on("close", closeHandler);
    proc.on("error", errorHandler);
  });

  let timedOut = false;
  let forceKillTimer;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGTERM");
    forceKillTimer = setTimeout(() => {
      proc.kill("SIGKILL");
    }, SIGKILL_DELAY);
  }, timeout);

  try {
    const [{ code: exitCode, signal: exitSignal }, stdout, stderr] = await Promise.all([
      closePromise,
      stdoutPromise,
      stderrPromise,
    ]);

    if (timedOut) {
      throw new TimeoutError();
    }

    if (exitCode !== 0 || (exitCode === null && exitSignal !== null)) {
      throw new RunnerError(`${command} exited with code ${exitCode}, signal ${exitSignal}`, { exitCode, stderr });
    }

    if (isAuthError(stderr)) {
      throw new AuthError();
    }

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
  } finally {
    clearTimeout(timer);
    clearTimeout(forceKillTimer);
    proc.removeListener("close", closeHandler);
    proc.removeListener("error", errorHandler);
  }
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

  const rawTimeout = timeoutIdx !== -1 ? parseInt(args[timeoutIdx + 1], 10) : 60000;
  const timeout = Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : 60000;
  const backend = backendIdx !== -1 ? args[backendIdx + 1] : "codebuddy";

  if (file && dir) {
    console.error("--file and --dir are mutually exclusive");
    process.exit(1);
  }

  if (!file && !dir && !diff) {
    console.error("Either --file, --dir, or --diff is required");
    process.exit(1);
  }

  const result = await review({ model, file, dir, exts, customPrompt, timeout, allowExternal, backend, diff });
  console.log(JSON.stringify(result, null, 2));
  if (!result.success) process.exit(1);
}
