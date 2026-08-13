import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { review, RunnerError, TimeoutError, AuthError, setSpawn, validateFilePath, extractJson, collectSourceFiles, DEFAULT_EXTS, getDiff, setGitSpawn, VERIFY_PROMPT } from "./review-runner.mjs";

const MOCK_OUTPUT_VALID = JSON.stringify({
  severity: "medium",
  issues: [
    { file: "test.js", line: 3, finding: "Missing semicolon", fix: "Add ;" },
    { file: "test.js", line: 5, finding: "Unused variable", fix: "Remove it" },
  ],
  summary: "Found 2 issues.",
});

function createMockProcess({ stdout = "", stderr = "", exitCode = 0, signal = null, delayMs = 0, resistSigterm = false } = {}) {
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

describe("extractJson", () => {
  it("should parse JSON inside code fence with trailing text", () => {
    const text = '```json\n{"a":1}\n```\n\nSome trailing note.';
    const result = extractJson(text);
    assert.ok(result, "should parse successfully");
    assert.equal(result.a, 1);
  });

  it("should parse JSON containing triple backticks in value", () => {
    const json = JSON.stringify({ fix: "Use ``` here" });
    const text = '```json\n' + json + '\n```';
    const result = extractJson(text);
    assert.ok(result, "should parse despite inner backticks");
    assert.equal(result.fix, "Use ``` here");
  });

  it("should parse raw JSON without fence", () => {
    const result = extractJson('{"severity":"low","issues":[]}');
    assert.ok(result);
    assert.equal(result.severity, "low");
  });

  it("should parse generic fenced code block with trailing text", () => {
    const text = '```\n{"x":1}\n```\nExtra text.';
    const result = extractJson(text);
    assert.ok(result);
    assert.equal(result.x, 1);
  });
});

describe("review-runner", () => {
  afterEach(() => {
    setSpawn(null);
  });

  it("should parse valid CodeBuddy output into structured result", async () => {
    setSpawn(() => createMockProcess({ stdout: MOCK_OUTPUT_VALID }));

    const result = await review({
      model: "deepseek-v4-pro",
      code: "function hello() { return 1 }",
    });

    assert.equal(result.model, "deepseek-v4-pro");
    assert.equal(result.issues.length, 2);
    assert.equal(result.issues[0].finding, "Missing semicolon");
    assert.equal(result.summary, "Found 2 issues.");
    assert.equal(result.success, true);
  });

  it("should pass custom prompt to codebuddy", async () => {
    let stdinWritten = null;
    setSpawn((cmd, args) => {
      const p = createMockProcess({ stdout: MOCK_OUTPUT_VALID });
      p.stdin = { write: (d) => { stdinWritten = d; }, end: () => {} };
      return p;
    });

    await review({
      model: "qwen-coder-plus",
      code: "const x = 1",
      customPrompt: "Find security issues only",
    });

    assert.ok(stdinWritten, "should write to stdin");
    assert.ok(stdinWritten.includes("Find security issues only"),
      "custom prompt should appear in stdin content");
  });

  it("should throw TimeoutError when process exceeds timeout", async () => {
    setSpawn(() => createMockProcess({ stdout: "", delayMs: 5000 }));

    await assert.rejects(
      () =>
        review({
          model: "deepseek-v4-pro",
          code: "test",
          timeout: 10,
        }),
      TimeoutError
    );
  });

  it("should throw RunnerError on non-zero exit code", async () => {
    setSpawn(() => createMockProcess({ exitCode: 1, stderr: "ENOMEM" }));

    await assert.rejects(
      () =>
        review({
          model: "deepseek-v4-pro",
          code: "test",
        }),
      RunnerError
    );
  });

  it("should return empty result on empty stdout", async () => {
    setSpawn(() => createMockProcess({ stdout: "" }));

    const result = await review({
      model: "qwen-coder-plus",
      code: "test",
    });

    assert.equal(result.success, false);
    assert.ok(result.summary.includes("No output"));
    assert.equal(result.issues.length, 0);
  });

  it("should throw RunnerError when codebuddy is not found", async () => {
    const err = new Error("spawn codebuddy ENOENT");
    err.code = "ENOENT";
    setSpawn(() => {
      throw err;
    });

    await assert.rejects(
      () =>
        review({
          model: "deepseek-v4-pro",
          code: "test",
        }),
      (e) => e instanceof RunnerError && e.message.includes("codebuddy")
    );
  });

  it("should handle large code input without truncation", async () => {
    const largeCode = "a".repeat(512 * 1024);
    setSpawn(() => createMockProcess({ stdout: MOCK_OUTPUT_VALID }));

    const result = await review({
      model: "deepseek-v4-pro",
      code: largeCode,
    });

    assert.equal(result.success, true);
    assert.ok(result.issues.length > 0);
  });

  it("should NOT throw AuthError when stdout mentions 401 from code review", async () => {
    setSpawn(() => createMockProcess({ stdout: "issue at line 15: 401 check needed", exitCode: 0 }));

    const result = await review({
      model: "deepseek-v4-pro",
      code: "test",
    });

    assert.equal(result.success, true);
  });

  it("should throw AuthError when stderr contains auth failure", async () => {
    setSpawn(() => createMockProcess({ stderr: "401 Unauthorized", exitCode: 0 }));

    await assert.rejects(
      () =>
        review({
          model: "qwen-coder-plus",
          code: "test",
        }),
      AuthError
    );
  });

  it("should treat NaN timeout as default timeout", async () => {
    setSpawn(() => createMockProcess({ stdout: MOCK_OUTPUT_VALID }));

    const result = await review({
      model: "deepseek-v4-pro",
      code: "test",
      timeout: NaN,
    });

    assert.equal(result.success, true);
  });

  it("should treat negative timeout as default timeout", async () => {
    setSpawn(() => createMockProcess({ stdout: MOCK_OUTPUT_VALID }));

    const result = await review({
      model: "deepseek-v4-pro",
      code: "test",
      timeout: -1,
    });

    assert.equal(result.success, true);
  });

  it("should use valid timeout value as-is", async () => {
    setSpawn(() => createMockProcess({ stdout: MOCK_OUTPUT_VALID }));

    const result = await review({
      model: "deepseek-v4-pro",
      code: "test",
      timeout: 3000,
    });

    assert.equal(result.success, true);
  });

  it("should throw RunnerError when model is empty string", async () => {
    setSpawn(() => createMockProcess({ stdout: MOCK_OUTPUT_VALID }));

    await assert.rejects(
      () => review({ model: "", code: "test" }),
      RunnerError
    );
  });

  it("should throw RunnerError when model is undefined", async () => {
    setSpawn(() => createMockProcess({ stdout: MOCK_OUTPUT_VALID }));

    await assert.rejects(
      () => review({ model: undefined, code: "test" }),
      RunnerError
    );
  });

  it("should reject path traversal outside base directory", () => {
    assert.throws(
      () => validateFilePath("../../etc/passwd", "/project/sub"),
      RunnerError
    );
  });

  it("should reject absolute path outside base directory", () => {
    assert.throws(
      () => validateFilePath("/etc/passwd", "/project"),
      RunnerError
    );
  });

  it("should accept valid relative path within base directory", () => {
    const result = validateFilePath("scripts/test.js", "/project");
    assert.ok(result.startsWith("/project"));
    assert.ok(result.includes("scripts/test.js"));
  });

  it("should accept path equal to base directory", () => {
    assert.doesNotThrow(() => validateFilePath(".", "/project"));
  });

  it("should allow external path when allowExternal is true", () => {
    assert.doesNotThrow(() => validateFilePath("/etc/passwd", "/project", { allowExternal: true }));
  });

  it("should still reject external path when allowExternal is false", () => {
    assert.throws(
      () => validateFilePath("/etc/passwd", "/project", { allowExternal: false }),
      RunnerError
    );
  });

  it("should escape triple backticks in code to prevent prompt injection", async () => {
    let stdinWritten = null;
    setSpawn((cmd, args) => {
      const p = createMockProcess({ stdout: MOCK_OUTPUT_VALID });
      p.stdin = { write: (d) => { stdinWritten = d; }, end: () => {} };
      return p;
    });

    await review({
      model: "deepseek-v4-pro",
      code: "hello\n```\nevil code\n```",
    });

    assert.ok(stdinWritten, "should write to stdin");
    assert.ok(!stdinWritten.includes("```\nevil code\n```"));
    assert.ok(stdinWritten.includes("BASE64"), "should wrap code with backticks in Base64");
  });

  it("should not escape code without triple backticks", async () => {
    let stdinWritten = null;
    setSpawn((cmd, args) => {
      const p = createMockProcess({ stdout: MOCK_OUTPUT_VALID });
      p.stdin = { write: (d) => { stdinWritten = d; }, end: () => {} };
      return p;
    });

    await review({
      model: "deepseek-v4-pro",
      code: "const x = 1;",
    });

    assert.ok(stdinWritten.includes("const x = 1;"));
  });

  it("should escalate to SIGKILL when SIGTERM does not kill process", async () => {
    let procRef;
    setSpawn(() => {
      const p = createMockProcess({ stdout: MOCK_OUTPUT_VALID, resistSigterm: true });
      procRef = p;
      return p;
    });

    await assert.rejects(
      () => review({ model: "test", code: "test", timeout: 10 }),
      TimeoutError
    );

    assert.ok(procRef.killSignals.includes("SIGTERM"), "SIGTERM should be sent first");
    assert.ok(procRef.killSignals.includes("SIGKILL"), "SIGKILL should follow SIGTERM");
  });

  it("should include parse error reason when JSON extraction fails", async () => {
    setSpawn(() => createMockProcess({ stdout: "This is not valid JSON at all" }));

    const result = await review({
      model: "deepseek-v4-pro",
      code: "test",
    });

    assert.equal(result.success, true);
    assert.equal(result.parseError, true, "should flag parse failure");
  });

  it("should clean up event listeners after process completes", async () => {
    let procRef;
    setSpawn(() => {
      const p = createMockProcess({ stdout: MOCK_OUTPUT_VALID });
      procRef = p;
      return p;
    });

    await review({ model: "test", code: "test" });

    assert.equal(procRef.removedListenerEvents.length, 2, "should remove two listeners (close + error)");
  });

  it("should throw RunnerError when no code and no file provided", async () => {
    await assert.rejects(
      () => review({ model: "test" }),
      RunnerError
    );
  });

  it("should use named handlers for close and error events so they can be cleaned up individually", async () => {
    let procRef;
    setSpawn(() => {
      const p = createMockProcess({ stdout: MOCK_OUTPUT_VALID });
      procRef = p;
      return p;
    });

    await review({ model: "test", code: "test" });

    const removed = procRef.removedListenerEvents;
    assert.ok(removed.includes("close"), "close listener should be removed");
    assert.ok(removed.includes("error"), "error listener should be removed");
  });

  it("should parse JSON output even when issue descriptions contain triple backticks", async () => {
    const trickyOutput = '```json\n' + JSON.stringify({
      severity: "high",
      issues: [{ file: "test.js", line: 1, finding: "bad", fix: "Use ``` to close fences" }],
      summary: "Done",
    }) + '\n```';

    setSpawn(() => createMockProcess({ stdout: trickyOutput }));

    const result = await review({
      model: "deepseek-v4-pro",
      code: "test",
    });

    assert.equal(result.success, true);
    assert.equal(result.issues.length, 1);
    assert.equal(result.issues[0].fix, "Use ``` to close fences");
  });

  it("should spawn codebuddy with stdin ignored to prevent hanging", async () => {
    let capturedOpts = null;
    setSpawn((cmd, args, opts) => {
      capturedOpts = opts;
      return createMockProcess({ stdout: MOCK_OUTPUT_VALID });
    });

    await review({ model: "deepseek-v4-pro", code: "test" });

    assert.ok(capturedOpts, "spawn should receive options argument");
    assert.deepEqual(capturedOpts.stdio, ["pipe", "pipe", "pipe"], "all stdio should be pipe");
  });

  it("should throw RunnerError when process is killed by a signal", async () => {
    setSpawn(() => createMockProcess({ stdout: MOCK_OUTPUT_VALID, exitCode: null, signal: "SIGSEGV" }));

    await assert.rejects(
      () => review({ model: "deepseek-v4-pro", code: "test" }),
      RunnerError
    );
  });

  it("should throw RunnerError when model starts with a dash", async () => {
    setSpawn(() => createMockProcess({ stdout: MOCK_OUTPUT_VALID }));

    await assert.rejects(
      () => review({ model: "--print", code: "test" }),
      RunnerError
    );
  });

  it("should throw RunnerError when code is not a string", async () => {
    setSpawn(() => createMockProcess({ stdout: MOCK_OUTPUT_VALID }));

    await assert.rejects(
      () => review({ model: "test", code: 123 }),
      RunnerError
    );
  });

  it("should throw RunnerError when customPrompt is not a string", async () => {
    setSpawn(() => createMockProcess({ stdout: MOCK_OUTPUT_VALID }));

    await assert.rejects(
      () => review({ model: "test", code: "test", customPrompt: { obj: 1 } }),
      RunnerError
    );
  });

  it("should base64-encode code containing triple backticks to prevent fence breakout", async () => {
    let stdinWritten = null;
    setSpawn((cmd, args) => {
      const p = createMockProcess({ stdout: MOCK_OUTPUT_VALID });
      p.stdin = { write: (d) => { stdinWritten = d; }, end: () => {} };
      return p;
    });

    await review({
      model: "deepseek-v4-pro",
      code: "hello\n```\nevil\n```",
    });

    assert.ok(stdinWritten, "should write to stdin");
    assert.ok(stdinWritten.includes("BASE64"), "should use Base64 wrapper");
    assert.ok(!stdinWritten.includes("evil code"), "original code text should not be in plain text");
  });

  it("should throw RunnerError when file parameter is not a string", async () => {
    await assert.rejects(
      () => review({ model: "test", code: "test", file: 123 }),
      RunnerError
    );
  });

  it("should pass prompt via stdin instead of argv to prevent ps leakage", async () => {
    let capturedArgs = null;
    let stdinWritten = null;
    let stdinEnded = false;

    setSpawn((cmd, args, opts) => {
      capturedArgs = args;
      const p = createMockProcess({ stdout: MOCK_OUTPUT_VALID });
      p.stdin = {
        write: (data) => { stdinWritten = data; },
        end: () => { stdinEnded = true; },
      };
      return p;
    });

    await review({ model: "deepseek-v4-pro", code: "const x = 1;" });

    assert.ok(capturedArgs, "should have spawn args");
    assert.ok(!capturedArgs.includes("-p"), "should not use -p flag");
    assert.ok(stdinWritten, "should write prompt to stdin");
    assert.ok(stdinEnded, "should end stdin");
    assert.ok(stdinWritten.includes("CODE:"), "stdin should contain code");
  });

  it("should allow concurrent reviews without interference", async () => {
    let callSeq = [];
    setSpawn((cmd, args) => {
      const modelArg = args.find((a) => a.startsWith("--model")) || "";
      callSeq.push(modelArg);
      return createMockProcess({ stdout: MOCK_OUTPUT_VALID });
    });

    const [r1, r2] = await Promise.all([
      review({ model: "deepseek-v4-pro", code: "test" }),
      review({ model: "qwen-coder-plus", code: "test" }),
    ]);

    assert.equal(r1.success, true);
    assert.equal(r2.success, true);
    assert.equal(r1.model, "deepseek-v4-pro");
    assert.equal(r2.model, "qwen-coder-plus");
  });
});

const FIXTURES = "/var/folders/77/4qgc39t17kn1jhl7wrw62dkr0000gn/T/opencode/test-fixtures";

describe("collectSourceFiles", () => {
  it("should find Swift files in a directory tree", async () => {
    const files = await collectSourceFiles(`${FIXTURES}/swift-project`, [".swift"]);
    assert.equal(files.length, 2, "should find 2 swift files");
    assert.ok(files.some((f) => f.endsWith("main.swift")), "should include main.swift");
    assert.ok(files.some((f) => f.endsWith("utils.swift")), "should include utils.swift");
  });

  it("should return empty array for directories without matching files", async () => {
    const files = await collectSourceFiles(`${FIXTURES}/empty`, [".swift"]);
    assert.equal(files.length, 0);
  });

  it("should skip .git, node_modules, and non-source files", async () => {
    const files = await collectSourceFiles(`${FIXTURES}/mixed`, [".swift"]);
    assert.equal(files.length, 1, "should only find src/app.swift");
    assert.ok(files[0].endsWith("src/app.swift"), "should be the swift file");
  });

  it("should return sorted file paths", async () => {
    const files = await collectSourceFiles(`${FIXTURES}/swift-project`, [".swift"]);
    assert.ok(files[0].endsWith("main.swift"), "main.swift should come first alphabetically");
    assert.ok(files[1].endsWith("utils.swift"), "utils.swift should come second");
  });

  it("should use DEFAULT_EXTS when no exts argument is provided", async () => {
    const files = await collectSourceFiles(`${FIXTURES}/swift-project`);
    assert.equal(files.length, 2, "DEFAULT_EXTS should include .swift");
  });
});

describe("review --dir", () => {
  afterEach(() => {
    setSpawn(null);
  });

  it("should merge multiple files with file markers in dir mode", async () => {
    let stdinWritten = null;
    setSpawn((cmd, args) => {
      const stdoutStream = new EventEmitter();
      const stderrStream = new EventEmitter();
      const events = new EventEmitter();

      const proc = {
        stdout: stdoutStream,
        stderr: stderrStream,
        on: (event, cb) => { events.on(event, cb); return proc; },
        kill: () => {
          const buf = Buffer.from(JSON.stringify({ severity: "low", issues: [], summary: "ok" }));
          stdoutStream.emit("data", buf);
          stdoutStream.emit("end");
          stderrStream.emit("end");
          events.emit("close", 0, null);
        },
        removeListener: () => proc,
        stdin: { write: (d) => { stdinWritten = d; }, end: () => {} },
        pid: 1,
      };

      setImmediate(() => {
        const buf = Buffer.from(JSON.stringify({ severity: "low", issues: [], summary: "ok" }));
        stdoutStream.emit("data", buf);
        stdoutStream.emit("end");
        stderrStream.emit("end");
        events.emit("close", 0, null);
      });

      return proc;
    });

    const result = await review({
      model: "test",
      dir: `${FIXTURES}/swift-project`,
      exts: [".swift"],
      allowExternal: true,
    });

    assert.equal(result.success, true);
    assert.ok(stdinWritten, "stdin should be written");
    assert.ok(stdinWritten.includes("// === File: main.swift ==="), "should include file marker for main.swift");
    assert.ok(stdinWritten.includes("// === File: subdir/utils.swift ==="), "should include file marker for utils.swift");
    assert.ok(stdinWritten.includes("func hello()"), "should include main.swift content");
    assert.ok(stdinWritten.includes("let x = 1"), "should include utils.swift content");
  });

  it("should return empty result for directory with no matching files", async () => {
    setSpawn(() => {
      throw new Error("should not spawn codebuddy for empty dir");
    });

    const result = await review({
      model: "test",
      dir: `${FIXTURES}/empty`,
      exts: [".swift"],
      allowExternal: true,
    });

    assert.equal(result.success, false);
    assert.equal(result.fileCount, 0);
    assert.ok(result.summary.includes("No source files found"));
  });

  it("should throw RunnerError when dir and file are both provided", async () => {
    await assert.rejects(
      () => review({ model: "test", dir: `${FIXTURES}/swift-project`, exts: [".swift"], file: "test.swift" }),
      RunnerError
    );
  });
});

describe("getDiff", () => {
  afterEach(() => setGitSpawn(null));

  it("returns git diff output verbatim", async () => {
    const diffText = "diff --git a/x b/x\n@@ -1 +1 @@\n-old\n+new\n";
    setGitSpawn(() => createMockProcess({ stdout: diffText }));
    const diff = await getDiff();
    assert.equal(diff, diffText);
  });

  it("returns empty string when no diff", async () => {
    setGitSpawn(() => createMockProcess({ stdout: "" }));
    const diff = await getDiff();
    assert.equal(diff, "");
  });

  it("throws RunnerError on non-zero git exit", async () => {
    setGitSpawn(() => createMockProcess({ exitCode: 1, stderr: "not a git repository" }));
    await assert.rejects(() => getDiff(), RunnerError);
  });

  it("throws RunnerError when git not found", async () => {
    setGitSpawn(() => {
      const e = new Error("spawn git ENOENT");
      e.code = "ENOENT";
      throw e;
    });
    await assert.rejects(() => getDiff(), RunnerError);
  });

  it("throws RunnerError on async ENOENT (real spawn path)", async () => {
    setGitSpawn(() => {
      const err = new Error("spawn git ENOENT");
      err.code = "ENOENT";
      return {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        on: (event, cb) => {
          if (event === "error") cb(err);
        },
      };
    });
    await assert.rejects(() => getDiff(), RunnerError);
  });
});

describe("review diff mode", () => {
  afterEach(() => {
    setSpawn(null);
    setGitSpawn(null);
  });

  it("returns no-changes result without spawning reviewer when diff empty", async () => {
    setGitSpawn(() => createMockProcess({ stdout: "" }));
    let reviewerSpawned = false;
    setSpawn(() => {
      reviewerSpawned = true;
      return createMockProcess({ stdout: MOCK_OUTPUT_VALID });
    });
    const r = await review({ model: "glm-5.2", diff: true });
    assert.equal(r.success, false);
    assert.ok(r.summary.includes("no changes"));
    assert.equal(reviewerSpawned, false);
  });

  it("sends diff text as code to reviewer", async () => {
    const diffText = "diff --git a/x b/x\n@@ -1 +1 @@\n-old\n+new\n";
    setGitSpawn(() => createMockProcess({ stdout: diffText }));
    let stdinWritten = null;
    setSpawn((cmd, args) => {
      const p = createMockProcess({ stdout: MOCK_OUTPUT_VALID });
      p.stdin = {
        write: (d) => {
          stdinWritten = d;
        },
        end: () => {},
      };
      return p;
    });
    await review({ model: "glm-5.2", diff: true });
    assert.ok(stdinWritten.includes("@@ -1 +1 @@"), "stdin should contain the diff hunk");
    assert.ok(stdinWritten.includes("+new"), "stdin should contain the added line");
  });

  it("uses verify prompt by default in diff mode", async () => {
    setGitSpawn(() => createMockProcess({ stdout: "diff --git a/x b/x\n" }));
    let stdinWritten = null;
    setSpawn((cmd, args) => {
      const p = createMockProcess({ stdout: MOCK_OUTPUT_VALID });
      p.stdin = {
        write: (d) => {
          stdinWritten = d;
        },
        end: () => {},
      };
      return p;
    });
    await review({ model: "glm-5.2", diff: true });
    assert.ok(stdinWritten.includes("回归"), "verify prompt should mention regression");
  });

  it("throws RunnerError when diff and file both provided", async () => {
    await assert.rejects(() => review({ model: "glm-5.2", diff: true, file: "x.js" }), RunnerError);
  });

  it("throws RunnerError when diff and code both provided", async () => {
    await assert.rejects(() => review({ model: "glm-5.2", diff: true, code: "const x = 1;" }), RunnerError);
  });

  it("throws RunnerError when diff and dir both provided", async () => {
    await assert.rejects(
      () => review({ model: "glm-5.2", diff: true, dir: `${FIXTURES}/swift-project`, exts: [".swift"] }),
      RunnerError
    );
  });
});

describe("VERIFY_PROMPT", () => {
  it("contains key verification constraints", () => {
    assert.ok(VERIFY_PROMPT.includes("回归"));
    assert.ok(VERIFY_PROMPT.includes("逐处"));
    assert.ok(VERIFY_PROMPT.includes("遗漏"));
  });
});
