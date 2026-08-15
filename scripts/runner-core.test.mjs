import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { runProcess, collectStream, setSpawn, RunnerError, TimeoutError, isMainModule } from "./runner-core.mjs";

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
    stdin: Object.assign(new EventEmitter(), {
      write: (data) => {
        stdinWritten = data;
      },
      end: () => {
        stdinEnded = true;
      },
    }),
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

  it("attaches an error handler to stdin (no uncaught EPIPE)", async () => {
    const stdin = new EventEmitter();
    stdin.write = () => {};
    stdin.end = () => {};
    setSpawn(() => {
      const proc = createMockProc({ stdout: "ok" });
      proc.stdin = stdin;
      return proc;
    });
    await runProcess({ command: "foo", args: [], stdin: "hello", timeout: 1000 });
    assert.ok(stdin.listenerCount("error") > 0, "应给 stdin 挂 error 监听，防 EPIPE 未捕获异常");
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

  it("stream 被销毁（无 end）时 close 事件也能 settle", async () => {
    const s = new EventEmitter();
    const p = collectStream(s);
    s.emit("data", Buffer.from("partial"));
    s.emit("close");
    await assert.rejects(p, /closed before end/, "close 未跟随 end 时应 reject 而非永不 settle");
  });
});

describe("isMainModule", () => {
  it("匹配含空格/URL 特殊字符的绝对路径", () => {
    assert.equal(isMainModule("file:///Users/me/My%20Project/scripts/guard.mjs", "/Users/me/My Project/scripts/guard.mjs"), true);
  });

  it("匹配普通绝对路径", () => {
    assert.equal(isMainModule("file:///Users/me/proj/guard.mjs", "/Users/me/proj/guard.mjs"), true);
  });

  it("匹配含 # 号的路径（URL 编码）", () => {
    assert.equal(isMainModule("file:///a/b%23c/x.mjs", "/a/b#c/x.mjs"), true);
  });

  it("不同路径返回 false", () => {
    assert.equal(isMainModule("file:///a/b.mjs", "/a/c.mjs"), false);
  });

  it("argv 为空/非字符串返回 false", () => {
    assert.equal(isMainModule("file:///a/b.mjs", undefined), false);
    assert.equal(isMainModule("file:///a/b.mjs", null), false);
  });
});
