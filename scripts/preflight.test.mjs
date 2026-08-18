import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { checkCodebuddy, checkKimi, checkQwen, setSpawn, checkCli, checkEnvKeys, preflightAll, REQUIRED_CLIS, REQUIRED_KEYS } from "./preflight.mjs";

function createMockProc() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = () => {};
  return proc;
}

describe("checkCodebuddy", () => {
  it("returns ok with version when codebuddy exits 0", async () => {
    const proc = createMockProc();
    setSpawn(() => proc);
    const p = checkCodebuddy();
    proc.stdout.emit("data", Buffer.from("2.0.0\n"));
    proc.emit("close", 0);
    const result = await p;
    assert.equal(result.ok, true);
    assert.equal(result.version, "2.0.0");
  });

  it("returns not_found when spawn throws ENOENT", async () => {
    setSpawn(() => {
      const err = new Error("spawn codebuddy ENOENT");
      err.code = "ENOENT";
      throw err;
    });
    const result = await checkCodebuddy();
    assert.equal(result.ok, false);
    assert.equal(result.reason, "not_found");
    assert.ok(result.hint.includes("npm install"));
  });

  it("returns exit failure with stderr", async () => {
    const proc = createMockProc();
    setSpawn(() => proc);
    const p = checkCodebuddy();
    proc.stderr.emit("data", Buffer.from("boom"));
    proc.emit("close", 1);
    const result = await p;
    assert.equal(result.ok, false);
    assert.equal(result.reason, "exit_1");
    assert.equal(result.stderr, "boom");
  });

  it("returns timeout when process never closes", async () => {
    const proc = createMockProc();
    setSpawn(() => proc);
    const result = await checkCodebuddy({ timeoutMs: 20 });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "timeout");
  });
});

describe("checkVersion 泛化（kimi/qwen 复用）", () => {
  it("checkKimi 跑 kimi --version 成功返回版本", async () => {
    let captured = null;
    const proc = createMockProc();
    setSpawn((cmd, args) => { captured = { cmd, args }; return proc; });
    const p = checkKimi();
    proc.stdout.emit("data", Buffer.from("1.2.3\n"));
    proc.emit("close", 0);
    const r = await p;
    assert.equal(captured.cmd, "kimi");
    assert.deepEqual(captured.args, ["--version"]);
    assert.equal(r.ok, true);
    assert.equal(r.version, "1.2.3");
  });

  it("checkKimi ENOENT 返回 not_found + 安装提示", async () => {
    setSpawn(() => { const e = new Error("kimi ENOENT"); e.code = "ENOENT"; throw e; });
    const r = await checkKimi();
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_found");
    assert.ok(r.hint.includes("kimi-code"), "hint 应含 kimi 包名");
  });

  it("checkQwen 跑 qwen --version 成功返回版本", async () => {
    let captured = null;
    const proc = createMockProc();
    setSpawn((cmd, args) => { captured = { cmd, args }; return proc; });
    const p = checkQwen();
    proc.stdout.emit("data", Buffer.from("0.21.0\n"));
    proc.emit("close", 0);
    const r = await p;
    assert.equal(captured.cmd, "qwen");
    assert.equal(r.ok, true);
    assert.equal(r.version, "0.21.0");
  });

  it("checkCodebuddy 仍是薄包装（--version 命令正确）", async () => {
    let captured = null;
    const proc = createMockProc();
    setSpawn((cmd, args) => { captured = { cmd, args }; return proc; });
    const p = checkCodebuddy();
    proc.stdout.emit("data", Buffer.from("2.0.0\n"));
    proc.emit("close", 0);
    const r = await p;
    assert.equal(captured.cmd, "codebuddy");
    assert.deepEqual(captured.args, ["--version"]);
    assert.equal(r.version, "2.0.0");
  });
});

describe("checkCli", () => {
  it("returns the resolved path when found", () => {
    assert.equal(checkCli("codebuddy", { which: () => "/usr/local/bin/codebuddy" }), "/usr/local/bin/codebuddy");
  });

  it("returns null when not found", () => {
    assert.equal(checkCli("codebuddy", { which: () => null }), null);
  });
});

describe("checkEnvKeys", () => {
  it("marks keys set vs missing", () => {
    const keys = checkEnvKeys({ DASHSCOPE_API_KEY: "x", MOONSHOT_API_KEY: "y" });
    const map = Object.fromEntries(keys.map((k) => [k.name, k.set]));
    assert.equal(map.DASHSCOPE_API_KEY, true);
    assert.equal(map.MOONSHOT_API_KEY, true);
  });

  it("treats blank strings as missing", () => {
    const keys = checkEnvKeys({ DASHSCOPE_API_KEY: "   " });
    assert.equal(keys.find((k) => k.name === "DASHSCOPE_API_KEY").set, false);
  });
});

describe("preflightAll", () => {
  it("aggregates clis + keys and computes ok", () => {
    const which = (c) => ({ codebuddy: "/x/codebuddy", kimi: "/x/kimi", qwen: "/x/qwen" }[c] ?? null);
    const env = { DASHSCOPE_API_KEY: "a", MOONSHOT_API_KEY: "b" };
    const r = preflightAll({ env, which });
    assert.equal(r.ok, true);
    assert.deepEqual(r.clis.map((c) => c.name), REQUIRED_CLIS);
    assert.deepEqual(r.keys.map((k) => k.name), REQUIRED_KEYS);
  });

  it("is not ok when a cli or key is missing", () => {
    const which = () => null;
    const r = preflightAll({ env: {}, which });
    assert.equal(r.ok, false);
  });
});
