import { spawn as nodeSpawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { resolve, sep } from "node:path";

let _spawn = null;

export function setSpawn(fn) {
  _spawn = fn;
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

function isAuthError(stderr) {
  const lower = stderr.toLowerCase();
  return lower.includes("401") || lower.includes("unauthorized") || lower.includes("invalid api key");
}

export async function review({ model, code, customPrompt, timeout = 60000, file, allowExternal = false }) {

  if (!model || typeof model !== "string") {
    throw new RunnerError("model is required", { exitCode: -1, stderr: "model parameter is required" });
  }

  if (model.startsWith("-")) {
    throw new RunnerError("invalid model name", { exitCode: -1, stderr: "model must not start with -" });
  }

  if (!Number.isFinite(timeout) || timeout <= 0) {
    timeout = 60000;
  }

  if (!code && !file) {
    throw new RunnerError("code or file is required", { exitCode: -1, stderr: "No code content provided" });
  }

  if (code !== undefined && typeof code !== "string") {
    throw new RunnerError("code must be a string", { exitCode: -1, stderr: "Invalid code type" });
  }

  if (customPrompt != null && typeof customPrompt !== "string") {
    throw new RunnerError("customPrompt must be a string", { exitCode: -1, stderr: "Invalid customPrompt type" });
  }

  if (file !== undefined && typeof file !== "string") {
    throw new RunnerError("file must be a string", { exitCode: -1, stderr: "Invalid file type" });
  }

  if (file) {
    const { readFile } = await import("node:fs/promises");
    const resolved = validateFilePath(file, process.cwd(), { allowExternal });
    code = await readFile(resolved, "utf-8");
  }

  const hasBackticks = code.includes("```");
  const codeContent = hasBackticks
    ? Buffer.from(code, "utf-8").toString("base64")
    : code;

  const spawn = _spawn ?? nodeSpawn;
  const prompt = customPrompt ?? "Review the following code for bugs, security issues, and code quality problems. Output the result as a JSON object with fields: severity (high/medium/low), issues (array of {file, line, finding, fix}), and summary (string).";

  const codeTag = hasBackticks ? "CODE (BASE64)" : "CODE";
  const decodeHint = hasBackticks ? "\n(The code above is Base64-encoded. You MUST decode it mentally — do NOT use any tools, do NOT try to execute commands. Simply recognize this is Base64 text, decode it in your mind, and review the decoded code directly. Start your response with the review findings.)" : "";
  const fullPrompt = `${prompt}\n\n${codeTag}:\n\`\`\`\n${codeContent}\n\`\`\`${decodeHint}`;

  let proc;
  try {
    proc = spawn("codebuddy", [
      "--model", model,
      "--print",
      "--output-format", "text",
    ], { stdio: ["pipe", "pipe", "pipe"] });
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new RunnerError("codebuddy not found", { exitCode: -1, stderr: err.message });
    }
    throw err;
  }

  try {
    proc.stdin.write(fullPrompt);
    proc.stdin.end();
  } catch (err) {
    proc.kill("SIGKILL");
    throw new RunnerError("failed to write to codebuddy stdin", { exitCode: -1, stderr: err.message });
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
      throw new RunnerError(`codebuddy exited with code ${exitCode}, signal ${exitSignal}`, { exitCode, stderr });
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
  const promptIdx = args.indexOf("--prompt");
  const timeoutIdx = args.indexOf("--timeout");
  const allowExternal = args.includes("--allow-external");

  if (modelIdx === -1) {
    console.error("Usage: node review-runner.mjs --model <model> --file <path> [--prompt <text>] [--timeout <ms>]");
    process.exit(1);
  }

  const model = args[modelIdx + 1];
  if (!model || model.startsWith("--")) {
    console.error("--model requires a valid model name");
    process.exit(1);
  }

  const file = fileIdx !== -1 ? args[fileIdx + 1] : null;
  const customPrompt = promptIdx !== -1 ? args[promptIdx + 1] : null;

  const rawTimeout = timeoutIdx !== -1 ? parseInt(args[timeoutIdx + 1], 10) : 60000;
  const timeout = Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : 60000;

  if (!file) {
    console.error("--file is required");
    process.exit(1);
  }

  const result = await review({ model, file, customPrompt, timeout, allowExternal });
  console.log(JSON.stringify(result, null, 2));
  if (!result.success) process.exit(1);
}
