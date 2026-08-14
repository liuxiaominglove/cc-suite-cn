import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { runProcess, collectStream, setSpawn, RunnerError, TimeoutError } from "./runner-core.mjs";

function createMockProc({ stdout = "", stderr = "", exitCode = 0, signal = null, autoClose = true } = {}) {
  const stdoutStream = new EventEmitter();
  const stderrStream = new EventEmitter();
  const events = new EventEmitter();
  const killSignals = [];
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
      killSignals.push(sig);
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
    get killSignals() {
      return killSignals;
    },
  };

  if (autoClose) setImmediate(() => close(exitCode, signal));

  return proc;
}

afterEach(() => setSpawn(null));

describe("runProcess", () => {
  it("returns stdout and exitCode 0 on success", async () => {
    setSpawn((cmd, args, opts) => createMockProc({ stdout: "ok" }));
    const r = await runProcess({ command: "foo", args: [], timeout: 1000 });
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "ok");
    assert.equal(r.timedOut, false);
  });

  it("returns non-zero exitCode with stderr (caller decides to throw)", async () => {
    setSpawn(() => createMockProc({ exitCode: 1, stderr: "boom" }));
    const r = await runProcess({ command: "foo", args: [], timeout: 1000 });
    assert.equal(r.exitCode, 1);
    assert.equal(r.stderr, "boom");
  });

  it("marks timedOut and sends SIGTERM when process does not exit", async () => {
    let proc;
    setSpawn(() => {
      proc = createMockProc({ autoClose: false });
      return proc;
    });
    const r = await runProcess({ command: "foo", args: [], timeout: 10 });
    assert.equal(r.timedOut, true);
    assert.ok(proc.killSignals.includes("SIGTERM"));
  });

  it("does not arm timer when timeout is undefined (no premature SIGTERM)", async () => {
    let proc;
    setSpawn(() => {
      proc = createMockProc({ stdout: "ok", autoClose: false });
      return proc;
    });
    const pending = runProcess({ command: "foo", args: [] });
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.deepEqual(proc.killSignals, [], "should not SIGTERM when timeout is omitted");
    proc.kill("SIGKILL");
    await pending;
  });

  it("throws RunnerError when command not found", async () => {
    const err = new Error("spawn foo ENOENT");
    err.code = "ENOENT";
    setSpawn(() => {
      throw err;
    });
    await assert.rejects(runProcess({ command: "foo", args: [], timeout: 1000 }), RunnerError);
  });

  it("writes stdin and ends it", async () => {
    let proc;
    setSpawn(() => {
      proc = createMockProc({ stdout: "ok" });
      return proc;
    });
    await runProcess({ command: "foo", args: [], stdin: "hello", timeout: 1000 });
    assert.equal(proc.stdinWritten, "hello");
    assert.equal(proc.stdinEnded, true);
  });

  it("does not write stdin when null", async () => {
    let proc;
    setSpawn(() => {
      proc = createMockProc({ stdout: "ok" });
      return proc;
    });
    await runProcess({ command: "foo", args: [], stdin: null, timeout: 1000 });
    assert.equal(proc.stdinWritten, null);
  });

  it("passes cwd through to spawn options", async () => {
    let capturedOpts = null;
    setSpawn((cmd, args, opts) => {
      capturedOpts = opts;
      return createMockProc({ stdout: "ok" });
    });
    await runProcess({ command: "foo", args: [], timeout: 1000, cwd: "/tmp/xyz" });
    assert.equal(capturedOpts.cwd, "/tmp/xyz");
  });
});

describe("collectStream", () => {
  it("joins chunks into a string", async () => {
    const s = new EventEmitter();
    const p = collectStream(s);
    s.emit("data", Buffer.from("ab"));
    s.emit("data", Buffer.from("cd"));
    s.emit("end");
    assert.equal(await p, "abcd");
  });
});
