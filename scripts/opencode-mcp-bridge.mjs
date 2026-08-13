import { spawn as nodeSpawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

let _spawn = null;

export function setSpawn(fn) {
  _spawn = fn;
}

export function checkGate(env = process.env) {
  return env.OPC_BRIDGE_GATE === "open";
}

export function checkCallbackLimit(count, max) {
  return count < max;
}

export async function appendCallback(path, entry) {
  const { appendFile } = await import("node:fs/promises");
  await appendFile(path, JSON.stringify(entry) + "\n", "utf-8");
}

export async function readCallbacks(path) {
  const { readFile } = await import("node:fs/promises");
  try {
    const raw = await readFile(path, "utf-8");
    return raw.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

export function createServer({ runOpencodeFn = runOpencode, env = process.env } = {}) {
  const server = new McpServer({ name: "opencode-bridge", version: "0.1.0" });
  const maxCallbacks = Number(env.OPC_MAX_CALLBACKS) || Infinity;
  const callbackLog = env.OPC_CALLBACK_LOG || null;
  let callbacks = 0;

  server.registerTool(
    "delegate_to_opencode",
    {
      description: "将任务委托回 opencode 总指挥，返回其回复。仅当桥闸门打开（OPC_BRIDGE_GATE=open）时可用，且有回调次数上限。",
      inputSchema: { task: z.string() },
    },
    async ({ task }) => {
      if (!checkGate(env)) {
        return { content: [{ type: "text", text: "禁止回派：桥闸门关闭，请独立完成，不要转交回 opencode 主控。" }] };
      }
      if (!checkCallbackLimit(callbacks, maxCallbacks)) {
        return { content: [{ type: "text", text: `已达回调上限（${maxCallbacks} 次），请自行决定，不再回调。` }] };
      }
      callbacks += 1;
      if (callbackLog) {
        await appendCallback(callbackLog, { timestamp: new Date().toISOString(), task });
      }
      const result = await runOpencodeFn(task);
      const text = result.ok
        ? result.output
        : `(opencode 调用失败：${result.reason}${result.stderr ? " — " + result.stderr : ""})`;
      return { content: [{ type: "text", text }] };
    }
  );

  return server;
}

export function runOpencode(task, { timeoutMs = 120000 } = {}) {
  const spawn = _spawn ?? nodeSpawn;

  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn("opencode", ["run", task], { stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      resolve({ ok: false, reason: err.code === "ENOENT" ? "opencode_not_found" : err.message });
      return;
    }

    const stdout = [];
    const stderr = [];
    proc.stdout.on("data", (c) => stdout.push(Buffer.from(c)));
    proc.stderr.on("data", (c) => stderr.push(Buffer.from(c)));

    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      resolve({ ok: false, reason: "timeout" });
    }, timeoutMs);

    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, reason: err.code === "ENOENT" ? "opencode_not_found" : err.message });
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ ok: true, output: Buffer.concat(stdout).toString("utf-8").trim() });
      } else {
        resolve({ ok: false, reason: `exit_${code}`, stderr: Buffer.concat(stderr).toString("utf-8").trim() });
      }
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
