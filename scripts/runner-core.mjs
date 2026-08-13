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
  constructor(message = "Process timed out") {
    super(message);
    this.name = "TimeoutError";
  }
}

const SIGKILL_DELAY = 5000;

export function collectStream(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    stream.on("error", reject);
  });
}

export async function runProcess({ command, args, stdin = null, timeout, spawn = null, cwd = undefined }) {
  const sp = spawn ?? _spawn ?? nodeSpawn;

  let proc;
  try {
    proc = sp(command, args, { stdio: ["pipe", "pipe", "pipe"], cwd });
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

    return { exitCode, signal: exitSignal, stdout, stderr, timedOut };
  } finally {
    clearTimeout(timer);
    clearTimeout(forceKillTimer);
    proc.removeListener("close", closeHandler);
    proc.removeListener("error", errorHandler);
  }
}
