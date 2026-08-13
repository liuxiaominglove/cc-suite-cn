import { spawn as nodeSpawn } from "node:child_process";
import { Buffer } from "node:buffer";

let _spawn = null;

export function setSpawn(fn) {
  _spawn = fn;
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await checkCodebuddy();
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}
