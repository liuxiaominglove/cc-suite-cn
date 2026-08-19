import { EventEmitter } from "node:events";

export const MOCK_OUTPUT_VALID = JSON.stringify({
  severity: "medium",
  issues: [
    { file: "test.js", line: 3, finding: "Missing semicolon", fix: "Add ;" },
    { file: "test.js", line: 5, finding: "Unused variable", fix: "Remove it" },
  ],
  summary: "Found 2 issues.",
});

export function createMockProcess({ stdout = "", stderr = "", exitCode = 0, signal = null, delayMs = 0, resistSigterm = false } = {}) {
  const stdoutStream = new EventEmitter();
  const stderrStream = new EventEmitter();
  const events = new EventEmitter();

  const killSignals = [];
  let removeAllListenersCalled = false;
  const removedListenerEvents = [];
  let killed = false;

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
    kill: (signal) => {
      killed = true;
      killSignals.push(signal);
      if (resistSigterm && signal === "SIGTERM") {
        return;
      }
      close(null, signal);
    },
    removeAllListeners: () => {
      removeAllListenersCalled = true;
    },
    removeListener: (event) => {
      removedListenerEvents.push(event);
      events.removeListener(event, () => {});
      return proc;
    },
    stdin: {
      write: () => {},
      end: () => {},
    },
    killSignals,
    get removeAllListenersCalled() { return removeAllListenersCalled; },
    get removedListenerEvents() { return removedListenerEvents; },
    pid: 12345,
  };

  if (delayMs > 0) {
    setTimeout(() => { if (!killed) close(exitCode, signal); }, delayMs);
  } else if (!resistSigterm) {
    setImmediate(() => { if (!killed) close(exitCode, signal); });
  }

  return proc;
}

export function makeRulesReader({ agents, claude } = {}) {
  return async (p) => {
    if (p.endsWith("AGENTS.md")) {
      if (agents !== undefined) return agents;
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    }
    if (p.endsWith("CLAUDE.md")) {
      if (claude !== undefined) return claude;
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    }
    throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  };
}
