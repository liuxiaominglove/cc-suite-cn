import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { setSpawn, TimeoutError, RunnerError } from "./runner-core.mjs";
import { createMockProcess, MOCK_OUTPUT_VALID } from "./review-test-helpers.mjs";
import { runModel, setRetryBackoffMs, AuthError } from "./review-tools.mjs";

describe("runModel", () => {
  afterEach(() => setSpawn(null));

  it("returns stdout on success", async () => {
    setSpawn(() => createMockProcess({ stdout: MOCK_OUTPUT_VALID }));
    const out = await runModel({ command: "c", args: [], stdin: null, timeout: 1000, backend: "codebuddy", retries: 0 });
    assert.equal(out, MOCK_OUTPUT_VALID);
  });

  it("throws TimeoutError when process times out", async () => {
    setSpawn(() => createMockProcess({ stdout: "", delayMs: 5000 }));
    await assert.rejects(
      () => runModel({ command: "c", args: [], stdin: null, timeout: 10, backend: "codebuddy", retries: 0 }),
      TimeoutError
    );
  });

  it("throws RunnerError on non-zero exit", async () => {
    setSpawn(() => createMockProcess({ exitCode: 1, stderr: "boom" }));
    await assert.rejects(
      () => runModel({ command: "c", args: [], stdin: null, timeout: 1000, backend: "codebuddy", retries: 0 }),
      RunnerError
    );
  });

  it("throws AuthError on auth failure and does NOT retry", async () => {
    let calls = 0;
    setSpawn(() => { calls++; return createMockProcess({ exitCode: 1, stderr: "401 Unauthorized" }); });
    setRetryBackoffMs([0, 0]);
    await assert.rejects(
      () => runModel({ command: "c", args: [], stdin: null, timeout: 1000, backend: "codebuddy", retries: 2 }),
      AuthError
    );
    assert.equal(calls, 1);
    setRetryBackoffMs(null);
  });

  it("throws RunnerError when killed by signal", async () => {
    setSpawn(() => createMockProcess({ stdout: "", exitCode: null, signal: "SIGSEGV" }));
    await assert.rejects(
      () => runModel({ command: "c", args: [], stdin: null, timeout: 1000, backend: "codebuddy", retries: 0 }),
      RunnerError
    );
  });

  it("retries empty output then succeeds", async () => {
    setRetryBackoffMs([0, 0]);
    let calls = 0;
    setSpawn(() => { calls++; if (calls === 1) return createMockProcess({ stdout: "" }); return createMockProcess({ stdout: MOCK_OUTPUT_VALID }); });
    const out = await runModel({ command: "c", args: [], stdin: null, timeout: 1000, backend: "codebuddy", retries: 2 });
    assert.equal(out, MOCK_OUTPUT_VALID);
    assert.equal(calls, 2);
    setRetryBackoffMs(null);
  });

  it("throws RunnerError after empty output exhausts retries", async () => {
    setRetryBackoffMs([0, 0]);
    let calls = 0;
    setSpawn(() => { calls++; return createMockProcess({ stdout: "" }); });
    await assert.rejects(
      () => runModel({ command: "c", args: [], stdin: null, timeout: 1000, backend: "codebuddy", retries: 2 }),
      RunnerError
    );
    assert.equal(calls, 3);
    setRetryBackoffMs(null);
  });
});
