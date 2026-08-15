import { spawn as nodeSpawn, execSync } from "node:child_process";
import { Buffer } from "node:buffer";
import { pathToFileURL } from "node:url";

let _spawn = null;

export function setSpawn(fn) {
  _spawn = fn;
}

export const REQUIRED_CLIS = ["codebuddy", "kimi", "qwen"];
export const REQUIRED_KEYS = ["DASHSCOPE_API_KEY", "MOONSHOT_API_KEY", "TOKENHUB_API_KEY"];

function defaultWhich(command) {
  try {
    const out = execSync(`command -v "${command}"`, { encoding: "utf8" }).trim();
    return out || null;
  } catch {
    return null;
  }
}

export function checkCli(command, { which = null } = {}) {
  const resolver = which ?? defaultWhich;
  return resolver(command) || null;
}

export function checkEnvKeys(env = process.env) {
  return REQUIRED_KEYS.map((name) => ({ name, set: Boolean(env[name] && String(env[name]).trim()) }));
}

export function preflightAll({ env = process.env, which = null } = {}) {
  const clis = REQUIRED_CLIS.map((name) => ({ name, path: checkCli(name, { which }) }));
  const keys = checkEnvKeys(env);
  return {
    clis,
    keys,
    ok: clis.every((c) => c.path) && keys.every((k) => k.set),
  };
}

export function checkCodebuddy({ timeoutMs = 10000 } = {}) {
  const spawn = _spawn ?? nodeSpawn;

  let proc;
  try {
    proc = spawn("codebuddy", ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    if (err.code === "ENOENT") {
      return Promise.resolve({ ok: false, reason: "not_found", hint: "npm install -g @tencent-ai/codebuddy-code" });
    }
    throw err;
  }

  const stdout = [];
  const stderr = [];
  proc.stdout.on("data", (c) => stdout.push(Buffer.from(c)));
  proc.stderr.on("data", (c) => stderr.push(Buffer.from(c)));

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      resolve({ ok: false, reason: "timeout" });
    }, timeoutMs);

    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        reason: err.code === "ENOENT" ? "not_found" : err.message,
        hint: err.code === "ENOENT" ? "npm install -g @tencent-ai/codebuddy-code" : undefined,
      });
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ ok: true, version: Buffer.concat(stdout).toString("utf-8").trim() });
      } else {
        resolve({ ok: false, reason: `exit_${code}`, stderr: Buffer.concat(stderr).toString("utf-8").trim() });
      }
    });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = preflightAll();
  const cb = await checkCodebuddy();

  console.log("=== CLI 可用性 ===");
  for (const c of report.clis) {
    console.log(`${c.path ? "✅" : "❌"} ${c.name}${c.path ? ` → ${c.path}` : "（未安装）"}`);
  }
  console.log("\n=== API Key ===");
  for (const k of report.keys) {
    console.log(`${k.set ? "✅" : "❌"} ${k.name}${k.set ? "" : "（未设置，加入 ~/.zshrc）"}`);
  }
  console.log(`\ncodebuddy 版本：${cb.ok ? cb.version : cb.reason}`);

  process.exit(report.ok ? 0 : 1);
}
