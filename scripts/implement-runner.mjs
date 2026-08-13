import { spawn as nodeSpawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { readCallbacks } from "./opencode-mcp-bridge.mjs";

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

export const DEFAULT_TIMEOUT = 120000;
export const DEFAULT_BRIDGE_TIMEOUT = 300000;

export function resolveTimeout(timeout, bridge) {
  if (Number.isFinite(timeout) && timeout > 0) {
    return timeout;
  }
  return bridge ? DEFAULT_BRIDGE_TIMEOUT : DEFAULT_TIMEOUT;
}

export const BOUNDARY_PROMPT = "你是独立施工队，负责独立完成下方任务。你手上有 delegate_to_opencode 工具，可以回调 opencode 总指挥，但必须遵守：① 只在真正拿不准、需要拍板的具体点上回调，最多回调 5 次；② 不许把整个任务踢回给总指挥；③ 回调时在 task 里写清楚上下文和你的问题。";

export function buildImplementArgs({ model, permissionMode = "bypassPermissions", bridgeConfig = null }) {
  const args = ["--model", model, "--permission-mode", permissionMode];
  if (bridgeConfig) args.push("--mcp-config", bridgeConfig);
  args.push("--print", "--disallowedTools", "Bash");
  return args;
}

export function shouldWarnCallbackCount(count, threshold = 3) {
  return count >= threshold;
}

function collectStream(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    stream.on("error", reject);
  });
}

export async function implement({ model, task, timeout = null, permissionMode = "acceptEdits", bridge = false, bridgeConfig = null, callbackLog = null }) {
  if (!model || typeof model !== "string" || model.startsWith("-")) {
    throw new RunnerError("model is required", { exitCode: -1, stderr: "model parameter is required" });
  }

  if (!task || typeof task !== "string" || !task.trim()) {
    throw new RunnerError("task is required", { exitCode: -1, stderr: "task parameter is required" });
  }

  timeout = resolveTimeout(timeout, bridge);

  const spawn = _spawn ?? nodeSpawn;
  const args = bridge
    ? buildImplementArgs({ model, bridgeConfig })
    : ["--model", model, "--permission-mode", permissionMode, "--print"];
  const prompt = bridge ? `${BOUNDARY_PROMPT}\n\n${task}` : task;

  let proc;
  try {
    proc = spawn("codebuddy", args, { stdio: ["pipe", "pipe", "pipe"] });
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new RunnerError("codebuddy not found", { exitCode: -1, stderr: err.message });
    }
    throw err;
  }

  try {
    proc.stdin.write(prompt);
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

    const callbacks = callbackLog ? await readCallbacks(callbackLog) : [];

    return {
      model,
      success: true,
      output: stdout.trim() || "(no output)",
      callbackCount: callbacks.length,
      callbacks,
      warnCallbacks: shouldWarnCallbackCount(callbacks.length),
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
  const bridge = args.includes("--bridge");

  if (modelIdx === -1 || taskIdx === -1) {
    console.error("Usage: node implement-runner.mjs --model <model> --task <task> [--timeout <ms>] [--bridge]");
    process.exit(1);
  }

  const model = args[modelIdx + 1];
  const task = args[taskIdx + 1];
  const rawTimeout = timeoutIdx !== -1 ? parseInt(args[timeoutIdx + 1], 10) : null;
  const timeout = Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : null;

  let result;
  if (bridge) {
    const { buildBridgeConfig } = await import("./bridge-config.mjs");
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "impl-bridge-"));
    const bridgeConfig = join(dir, "bridge.json");
    const callbackLog = join(dir, "callbacks.jsonl");
    await writeFile(bridgeConfig, JSON.stringify(buildBridgeConfig({ gate: "open", maxCallbacks: 5, callbackLog })));
    result = await implement({ model, task, timeout, bridge: true, bridgeConfig, callbackLog });
  } else {
    result = await implement({ model, task, timeout });
  }

  console.log(JSON.stringify(result, null, 2));
  if (result.warnCallbacks) {
    console.error(`\n⚠️ 警告：本任务回调了 ${result.callbackCount} 次（≥3），偏多，请留意是否有"小事也回调"的乱回调。`);
  }
  if (!result.success) process.exit(1);
}
