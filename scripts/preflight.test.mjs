import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { checkCodebuddy, setSpawn } from "./preflight.mjs";

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
