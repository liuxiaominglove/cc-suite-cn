import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { implement, RunnerError, TimeoutError, setSpawn, buildImplementArgs, BOUNDARY_PROMPT, shouldWarnCallbackCount, resolveTimeout } from "./implement-runner.mjs";

function createMockProc({ stdout = "", stderr = "", exitCode = 0, signal = null, delayMs = 0 } = {}) {
  const stdoutStream = new EventEmitter();
  const stderrStream = new EventEmitter();
  const events = new EventEmitter();
  let killed = false;
  let stdinWritten = null;
  let stdinEnded = false;

  const close = (code, sig) => {
    if (stdout) stdoutStream.emit("data", Buffer.from(stdout));
    stdoutStream.emit("end");
    if (stderr) stderrStream.emit("data", Buffer.from(stderr));
    stderrStream.emit("end");
    events.emit("close", code, sig);
  };

  const proc = {
    stdout: stdoutStream,
    stderr: stderrStream,
    on: (event, cb) => {
      events.on(event, cb);
      return proc;
    },
    kill: (sig) => {
      killed = true;
      close(null, sig);
    },
    removeListener: () => proc,
    stdin: {
      write: (data) => {
        stdinWritten = data;
      },
      end: () => {
        stdinEnded = true;
      },
    },
    get stdinWritten() {
      return stdinWritten;
    },
    get stdinEnded() {
      return stdinEnded;
    },
  };

  if (delayMs > 0) {
    setTimeout(() => {
      if (!killed) close(exitCode, signal);
    }, delayMs);
  } else {
    setImmediate(() => {
      if (!killed) close(exitCode, signal);
    });
  }

  return proc;
}

describe("implement", () => {
  afterEach(() => setSpawn(null));

  it("builds the correct codebuddy command", async () => {
    let captured = null;
    setSpawn((cmd, args) => {
      captured = { cmd, args };
      return createMockProc({ stdout: "done" });
    });
    await implement({ model: "glm-5.2", task: "add a login function" });
    assert.equal(captured.cmd, "codebuddy");
    assert.deepEqual(captured.args, ["--model", "glm-5.2", "--permission-mode", "acceptEdits", "--print"]);
  });

  it("writes task to stdin", async () => {
    let proc;
    setSpawn(() => {
      proc = createMockProc({ stdout: "done" });
      return proc;
    });
    await implement({ model: "glm-5.2", task: "add a login function" });
    assert.ok(proc.stdinWritten.includes("add a login function"));
    assert.equal(proc.stdinEnded, true);
  });

  it("returns output on success", async () => {
    setSpawn(() => createMockProc({ stdout: "implemented" }));
    const r = await implement({ model: "glm-5.2", task: "x" });
    assert.equal(r.success, true);
    assert.equal(r.output, "implemented");
  });

  it("throws on empty task", async () => {
    await assert.rejects(implement({ model: "glm-5.2", task: "" }), RunnerError);
  });

  it("throws on non-zero exit", async () => {
    setSpawn(() => createMockProc({ exitCode: 1, stderr: "boom" }));
    await assert.rejects(implement({ model: "glm-5.2", task: "x" }), RunnerError);
  });

  it("throws on timeout", async () => {
    setSpawn(() => createMockProc({ delayMs: 5000 }));
    await assert.rejects(implement({ model: "glm-5.2", task: "x", timeout: 10 }), TimeoutError);
  });

  it("defaults permission mode to acceptEdits", async () => {
    let capturedArgs = null;
    setSpawn((cmd, args) => {
      capturedArgs = args;
      return createMockProc({ stdout: "done" });
    });
    await implement({ model: "glm-5.2", task: "x" });
    assert.ok(capturedArgs.includes("acceptEdits"));
  });
});

describe("buildImplementArgs", () => {
  it("uses bypassPermissions and puts disallowedTools Bash last", () => {
    const args = buildImplementArgs({ model: "glm-5.2", bridgeConfig: "/tmp/bridge.json" });
    assert.ok(args.includes("--permission-mode"));
    assert.ok(args.includes("bypassPermissions"));
    assert.ok(args.includes("--mcp-config"));
    assert.ok(args.includes("/tmp/bridge.json"));
    assert.equal(args[args.length - 2], "--disallowedTools");
    assert.equal(args[args.length - 1], "Bash");
  });

  it("omits --mcp-config when no bridgeConfig", () => {
    const args = buildImplementArgs({ model: "glm-5.2" });
    assert.ok(!args.includes("--mcp-config"));
  });
});

describe("BOUNDARY_PROMPT", () => {
  it("contains callback, no-hand-back, and 5-limit constraints", () => {
    assert.ok(BOUNDARY_PROMPT.includes("回调"));
    assert.ok(BOUNDARY_PROMPT.includes("踢回"));
    assert.ok(BOUNDARY_PROMPT.includes("5 次"));
  });
});

describe("shouldWarnCallbackCount", () => {
  it("warns at 3 (inclusive)", () => {
    assert.equal(shouldWarnCallbackCount(2, 3), false);
    assert.equal(shouldWarnCallbackCount(3, 3), true);
    assert.equal(shouldWarnCallbackCount(5, 3), true);
  });
});

describe("resolveTimeout", () => {
  it("defaults to 300000 when no timeout and bridge on", () => {
    assert.equal(resolveTimeout(undefined, true), 300000);
    assert.equal(resolveTimeout(null, true), 300000);
  });

  it("defaults to 120000 when no timeout and bridge off", () => {
    assert.equal(resolveTimeout(undefined, false), 120000);
    assert.equal(resolveTimeout(null, false), 120000);
  });

  it("respects explicit timeout even in bridge mode", () => {
    assert.equal(resolveTimeout(5000, true), 5000);
  });

  it("falls back on non-positive values", () => {
    assert.equal(resolveTimeout(0, false), 120000);
    assert.equal(resolveTimeout(-1, true), 300000);
  });

  it("falls back on NaN", () => {
    assert.equal(resolveTimeout(NaN, false), 120000);
  });
});

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("implement with bridge", () => {
  it("returns callback stats and warns at 3", async () => {
    const dir = await mkdtemp(join(tmpdir(), "impl-test-"));
    const log = join(dir, "cb.jsonl");
    await writeFile(log, '{"timestamp":"t1","task":"a"}\n{"timestamp":"t2","task":"b"}\n{"timestamp":"t3","task":"c"}\n');
    setSpawn(() => createMockProc({ stdout: "done" }));
    const r = await implement({ model: "glm-5.2", task: "x", bridge: true, bridgeConfig: "/tmp/b.json", callbackLog: log });
    assert.equal(r.success, true);
    assert.equal(r.callbackCount, 3);
    assert.equal(r.callbacks.length, 3);
    assert.equal(r.warnCallbacks, true);
    await rm(dir, { recursive: true, force: true });
  });

  it("returns empty callbacks when no callbackLog", async () => {
    setSpawn(() => createMockProc({ stdout: "done" }));
    const r = await implement({ model: "glm-5.2", task: "x", bridge: true });
    assert.equal(r.callbackCount, 0);
    assert.deepEqual(r.callbacks, []);
    assert.equal(r.warnCallbacks, false);
  });

  it("uses bypassPermissions + bridge config + Bash last when bridge on", async () => {
    let captured = null;
    setSpawn((cmd, args) => {
      captured = { cmd, args };
      return createMockProc({ stdout: "done" });
    });
    await implement({ model: "glm-5.2", task: "x", bridge: true, bridgeConfig: "/tmp/b.json" });
    assert.equal(captured.cmd, "codebuddy");
    assert.ok(captured.args.includes("--mcp-config"));
    assert.ok(captured.args.includes("bypassPermissions"));
    assert.equal(captured.args[captured.args.length - 1], "Bash");
  });

  it("prepends boundary prompt when bridge on", async () => {
    let proc;
    setSpawn(() => {
      proc = createMockProc({ stdout: "done" });
      return proc;
    });
    await implement({ model: "glm-5.2", task: "做X", bridge: true, bridgeConfig: "/tmp/b.json" });
    assert.ok(proc.stdinWritten.includes("踢回"));
    assert.ok(proc.stdinWritten.includes("做X"));
  });
});
