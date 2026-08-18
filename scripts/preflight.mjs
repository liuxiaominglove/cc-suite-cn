import { spawn as nodeSpawn, execSync } from "node:child_process";
import { Buffer } from "node:buffer";
import { pathToFileURL } from "node:url";

let _spawn = null;

export function setSpawn(fn) {
  _spawn = fn;
}

export const REQUIRED_CLIS = ["codebuddy", "kimi", "qwen"];
export const REQUIRED_KEYS = ["DASHSCOPE_API_KEY", "MOONSHOT_API_KEY"];

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

export function checkVersion(command, { timeoutMs = 10000, installHint = null } = {}) {
  const spawn = _spawn ?? nodeSpawn;

  const hint = installHint ?? `npm install -g ${command}`;
  let proc;
  try {
    proc = spawn(command, ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    if (err.code === "ENOENT") {
      return Promise.resolve({ ok: false, reason: "not_found", hint });
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
        hint: err.code === "ENOENT" ? hint : undefined,
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

export function checkCodebuddy(opts = {}) {
  return checkVersion("codebuddy", { installHint: "npm install -g @tencent-ai/codebuddy-code", ...opts });
}

export function checkKimi(opts = {}) {
  return checkVersion("kimi", { installHint: "npm install -g @moonshot-ai/kimi-code", ...opts });
}

export function checkQwen(opts = {}) {
  return checkVersion("qwen", { installHint: "npm install -g @qwen-code/qwen-code", ...opts });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = preflightAll();
  const versions = await Promise.all([checkCodebuddy(), checkKimi(), checkQwen()]);

  console.log("=== CLI 可用性 ===");
  for (const c of report.clis) {
    console.log(`${c.path ? "✅" : "❌"} ${c.name}${c.path ? ` → ${c.path}` : "（未安装）"}`);
  }
  console.log("\n=== CLI 版本实测（--version）===");
  const versionLines = [["codebuddy", versions[0]], ["kimi", versions[1]], ["qwen", versions[2]]];
  for (const [name, v] of versionLines) {
    console.log(`${v.ok ? "✅" : "❌"} ${name}: ${v.ok ? v.version : v.reason}`);
  }
  console.log("\n=== API Key ===");
  for (const k of report.keys) {
    console.log(`${k.set ? "✅" : "❌"} ${k.name}${k.set ? "" : "（未设置，加入 ~/.zshrc）"}`);
  }

  process.exit(report.ok ? 0 : 1);
}
