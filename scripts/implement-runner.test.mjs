import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { implement, RunnerError, TimeoutError, setSpawn } from "./implement-runner.mjs";

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
