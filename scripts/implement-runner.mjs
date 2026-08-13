import { spawn as nodeSpawn } from "node:child_process";
import { Buffer } from "node:buffer";

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
  constructor(message = "Implement timed out") {
    super(message);
    this.name = "TimeoutError";
  }
}

const SIGKILL_DELAY = 5000;

function collectStream(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    stream.on("error", reject);
  });
}

export async function implement({ model, task, timeout = 120000, permissionMode = "acceptEdits" }) {
  if (!model || typeof model !== "string" || model.startsWith("-")) {
    throw new RunnerError("model is required", { exitCode: -1, stderr: "model parameter is required" });
  }

  if (!task || typeof task !== "string" || !task.trim()) {
    throw new RunnerError("task is required", { exitCode: -1, stderr: "task parameter is required" });
  }

  if (!Number.isFinite(timeout) || timeout <= 0) {
    timeout = 120000;
  }

  const spawn = _spawn ?? nodeSpawn;

  let proc;
  try {
    proc = spawn("codebuddy", [
      "--model", model,
      "--permission-mode", permissionMode,
      "--print",
    ], { stdio: ["pipe", "pipe", "pipe"] });
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new RunnerError("codebuddy not found", { exitCode: -1, stderr: err.message });
    }
    throw err;
  }

  try {
    proc.stdin.write(task);
    proc.stdin.end();
  } catch (err) {
    proc.kill("SIGKILL");
    throw new RunnerError("failed to write to codebuddy stdin", { exitCode: -1, stderr: err.message });
  }

  const stdoutPromise = collectStream(proc.stdout);
  const stderrPromise = collectStream(proc.stderr);

  let closeHandler, errorHandler;
  const closePromise = new Promise((resolve, reject) => {
    closeHandler = (code, signal) => resolve({ code, signal });
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

    return {
      model,
      success: true,
      output: stdout.trim() || "(no output)",
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
  const taskIdx = args.indexOf("--task");
  const timeoutIdx = args.indexOf("--timeout");
  const permissionIdx = args.indexOf("--permission-mode");

  if (modelIdx === -1 || taskIdx === -1) {
    console.error("Usage: node implement-runner.mjs --model <model> --task <task> [--timeout <ms>] [--permission-mode <mode>]");
    process.exit(1);
  }

  const model = args[modelIdx + 1];
  const task = args[taskIdx + 1];
  const rawTimeout = timeoutIdx !== -1 ? parseInt(args[timeoutIdx + 1], 10) : 120000;
  const timeout = Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : 120000;
  const permissionMode = permissionIdx !== -1 ? args[permissionIdx + 1] : "acceptEdits";

  const result = await implement({ model, task, timeout, permissionMode });
  console.log(JSON.stringify(result, null, 2));
  if (!result.success) process.exit(1);
}
