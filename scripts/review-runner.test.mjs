import { describe, it, afterEach, before } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { review, RunnerError, TimeoutError, setSpawn, reviewFile, SourceTamperedError } from "./review-runner.mjs";
import { AuthError, extractJson, DEFAULT_TIMEOUT, frameCode, resolveReviewCwd, chunkCode, offsetFindings, withRetry, setRetryBackoffMs, isAuthError, isNLArtifact } from "./review-tools.mjs";
import { VERIFY_PROMPT, REVIEW_PROMPT, CRITIC_PROMPT, SELF_CHECK_PROMPT } from "./review-prompts.mjs";
import { collectProjectRules, buildRulesSection, collectImportContext, collectStackContext, collectWorkerLessons, buildLessonsSection, stripMarkdownComments } from "./review-context.mjs";
import { validateFilePath, collectSourceFiles, DEFAULT_EXTS, getDiff, setGitSpawn, snapshotSourceHashes, hashesDiffer } from "./review-source.mjs";
import { buildCriticPrompt, criticize, parseCriticArgs, mapCriticVerdicts, buildMissedFindings, buildSelfCheckPrompt, selfCheck, applySelfCheck } from "./review-critic.mjs";
import { MOCK_OUTPUT_VALID, createMockProcess, makeRulesReader } from "./review-test-helpers.mjs";

describe("frameCode", () => {
  it("fences plain code with three backticks", () => {
    assert.equal(frameCode("const x = 1;"), "```\nconst x = 1;\n```");
  });

  it("handles empty code with three-backtick fence", () => {
    assert.equal(frameCode(""), "```\n\n```");
  });

  it("keeps a three-backtick fence for single backticks (template literals)", () => {
    const out = frameCode("let s = `hi`;");
    assert.ok(out.startsWith("```\n"));
    assert.ok(out.endsWith("\n```"));
    assert.ok(out.includes("let s = `hi`;"));
  });

  it("upgrades fence to four backticks when code contains three", () => {
    const code = "hello\n```\nevil\n```";
    assert.equal(frameCode(code), "````\nhello\n```\nevil\n```\n````");
  });

  it("upgrades fence to five backticks when code contains four", () => {
    const out = frameCode("a````b");
    assert.ok(out.startsWith("`````\n"));
    assert.ok(out.endsWith("\n`````"));
    assert.ok(out.includes("a````b"));
  });

  it("never base64-encodes the code", () => {
    const code = "const x = 1;\n```\ncode fence inside\n```";
    const out = frameCode(code);
    assert.ok(out.includes(code), "original code should be embedded verbatim");
    assert.ok(!/^[A-Za-z0-9+/=]+$/m.test(out.split("\n")[1]), "second line should not look like base64");
  });
});

describe("resolveReviewCwd", () => {
  it("isolates kimi to temp dir", () => {
    assert.equal(resolveReviewCwd("kimi"), tmpdir());
  });

  it("isolates qwen to temp dir", () => {
    assert.equal(resolveReviewCwd("qwen"), tmpdir());
  });

  it("isolates codebuddy to temp dir", () => {
    assert.equal(resolveReviewCwd("codebuddy"), tmpdir());
  });

  it("isolates unknown backend to temp dir (fail-safe)", () => {
    assert.equal(resolveReviewCwd("glm"), tmpdir());
  });

  it("review() passes temp cwd to kimi spawn", async () => {
    let capturedOpts = null;
    setSpawn((cmd, args, opts) => {
      capturedOpts = opts;
      return createMockProcess({ stdout: MOCK_OUTPUT_VALID });
    });
    await review({ model: "kimi-k2.7-code", backend: "kimi", code: "const x = 1;" });
    assert.equal(capturedOpts.cwd, tmpdir());
  });

  it("review() passes temp cwd to codebuddy spawn", async () => {
    let capturedOpts = null;
    setSpawn((cmd, args, opts) => {
      capturedOpts = opts;
      return createMockProcess({ stdout: MOCK_OUTPUT_VALID });
    });
    await review({ model: "glm-5.2", backend: "codebuddy", code: "const x = 1;" });
    assert.equal(capturedOpts.cwd, tmpdir());
  });
});

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

  it("should recover fenced JSON with single-quoted strings", () => {
    const text = "```json\n{'severity':'low','issues':[]}\n```";
    const result = extractJson(text);
    assert.ok(result, "should parse single-quoted JSON");
    assert.equal(result.severity, "low");
  });

  it("should recover JSON with a trailing comma", () => {
    const text = '```json\n{"severity":"low","issues":[],}\n```';
    const result = extractJson(text);
    assert.ok(result, "should parse despite trailing comma");
    assert.equal(result.severity, "low");
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

  it("includes read-only declaration for codebuddy backend", async () => {
    let stdinWritten = null;
    setSpawn((cmd, args) => {
      const p = createMockProcess({ stdout: MOCK_OUTPUT_VALID });
      p.stdin = { write: (d) => { stdinWritten = d; }, end: () => {} };
      return p;
    });

    await review({ model: "glm-5.2", backend: "codebuddy", code: "const x = 1" });

    assert.ok(stdinWritten.includes("只读代码评审员"), "codebuddy should get the read-only declaration");
  });

  it("injects feedbackPreamble into the prompt when provided", async () => {
    let stdinWritten = null;
    setSpawn((cmd, args) => {
      const p = createMockProcess({ stdout: MOCK_OUTPUT_VALID });
      p.stdin = { write: (d) => { stdinWritten = d; }, end: () => {} };
      return p;
    });

    await review({ model: "glm-5.2", backend: "codebuddy", code: "const x = 1", feedbackPreamble: "[你的历史误报——这次别重犯]\n- a.js:1 — null deref" });

    assert.ok(stdinWritten.includes("[你的历史误报"), "feedback preamble should be injected");
    assert.ok(stdinWritten.includes("null deref"), "feedback content should be in the prompt");
  });

  it("omits feedback section when feedbackPreamble not provided", async () => {
    let stdinWritten = null;
    setSpawn((cmd, args) => {
      const p = createMockProcess({ stdout: MOCK_OUTPUT_VALID });
      p.stdin = { write: (d) => { stdinWritten = d; }, end: () => {} };
      return p;
    });

    await review({ model: "glm-5.2", backend: "codebuddy", code: "const x = 1" });

    assert.ok(!stdinWritten.includes("[你的历史误报"), "no feedback section by default");
  });

  it("labels FILE in prompt when fileName is provided", async () => {
    let stdinWritten = null;
    setSpawn((cmd, args) => {
      const p = createMockProcess({ stdout: MOCK_OUTPUT_VALID });
      p.stdin = { write: (d) => { stdinWritten = d; }, end: () => {} };
      return p;
    });

    await review({ model: "glm-5.2", backend: "codebuddy", code: "const x = 1", fileName: "commands/tdd.md" });

    assert.ok(stdinWritten.includes("FILE: commands/tdd.md"), "prompt should label the file name");
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

  it("should throw RunnerError on empty stdout (no retries)", async () => {
    setSpawn(() => createMockProcess({ stdout: "" }));

    await assert.rejects(
      () =>
        review({
          model: "qwen-coder-plus",
          code: "test",
        }),
      RunnerError
    );
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

  it("should throw AuthError when process fails with auth error in stderr", async () => {
    setSpawn(() => createMockProcess({ stderr: "401 Unauthorized", exitCode: 1 }));

    await assert.rejects(
      () =>
        review({
          model: "qwen-coder-plus",
          code: "test",
        }),
      AuthError
    );
  });

  it("should NOT throw AuthError when stderr mentions 401 but process exits 0", async () => {
    setSpawn(() => createMockProcess({ stdout: MOCK_OUTPUT_VALID, stderr: "note: 401 check needed", exitCode: 0 }));

    const result = await review({
      model: "deepseek-v4-pro",
      code: "test",
    });

    assert.equal(result.success, true);
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

  it("baseDir 为文件系统根时放行子路径（不因 // 前缀误判）", () => {
    assert.doesNotThrow(() => validateFilePath("/etc/passwd", "/"));
    assert.equal(validateFilePath("/etc/passwd", "/"), "/etc/passwd");
  });

  it("should fence code containing triple backticks without base64", async () => {
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
    assert.ok(!stdinWritten.includes("BASE64"), "should not base64-encode");
    assert.ok(stdinWritten.includes("evil code"), "original code text should be embedded verbatim");
    assert.ok(stdinWritten.includes("````"), "should use a four-backtick fence");
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

  it("should embed triple-backtick code verbatim (no base64)", async () => {
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
    assert.ok(!stdinWritten.includes("BASE64"), "should not use Base64");
    assert.ok(stdinWritten.includes("evil"), "original code text should be present");
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

let FIXTURES;
before(async () => {
  FIXTURES = await mkdtemp(join(tmpdir(), "cc-fixtures-"));
  await mkdir(join(FIXTURES, "swift-project", "subdir"), { recursive: true });
  await writeFile(join(FIXTURES, "swift-project", "main.swift"), "func hello() {}\n");
  await writeFile(join(FIXTURES, "swift-project", "subdir", "utils.swift"), "let x = 1\n");
  await mkdir(join(FIXTURES, "empty"), { recursive: true });
  await mkdir(join(FIXTURES, "mixed", "src"), { recursive: true });
  await writeFile(join(FIXTURES, "mixed", "src", "app.swift"), "// app\n");
  await mkdir(join(FIXTURES, "mixed", ".git"), { recursive: true });
  await mkdir(join(FIXTURES, "mixed", "node_modules"), { recursive: true });
  await writeFile(join(FIXTURES, "mixed", "readme.md"), "# readme\n");
});

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

  it("diff 模式把 cwd 转发给 getDiff", async () => {
    let capturedCwd = null;
    setGitSpawn((cmd, args, opts) => {
      capturedCwd = opts.cwd;
      return createMockProcess({ stdout: "diff --git a/x b/x\n" });
    });
    setSpawn(() => createMockProcess({ stdout: MOCK_OUTPUT_VALID }));
    await review({ model: "m", backend: "codebuddy", diff: true, cwd: "/custom/dir" });
    assert.equal(capturedCwd, "/custom/dir", "getDiff 应收到 review 的 cwd");
  });
});

describe("VERIFY_PROMPT", () => {
  it("contains key verification constraints", () => {
    assert.ok(VERIFY_PROMPT.includes("回归"));
    assert.ok(VERIFY_PROMPT.includes("逐处"));
    assert.ok(VERIFY_PROMPT.includes("遗漏"));
    assert.ok(VERIFY_PROMPT.includes("chain_analysis"), "复审应要求 chain_analysis 依据字段");
  });
});

describe("chunkCode", () => {
  it("returns a single chunk for small code", () => {
    const chunks = chunkCode("a\nb\nc");
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].startLine, 1);
    assert.equal(chunks[0].code, "a\nb\nc");
  });

  it("does not split when code equals chunkSize", () => {
    const lines = Array(800).fill("x").join("\n");
    const chunks = chunkCode(lines, { chunkSize: 800 });
    assert.equal(chunks.length, 1);
  });

  it("splits code larger than chunkSize into multiple chunks", () => {
    const lines = Array(1600).fill("x").join("\n");
    const chunks = chunkCode(lines, { chunkSize: 800, overlap: 10 });
    assert.ok(chunks.length >= 2, "should split");
    for (const c of chunks) {
      assert.ok(c.code.split("\n").length <= 800, "each chunk <= chunkSize");
    }
  });

  it("overlaps consecutive chunks", () => {
    const lines = Array(1600).fill("x").join("\n");
    const chunks = chunkCode(lines, { chunkSize: 800, overlap: 10 });
    const c1 = chunks[0].code.split("\n");
    const c2 = chunks[1].code.split("\n");
    assert.deepEqual(c1.slice(-10), c2.slice(0, 10), "last 10 lines of chunk1 == first 10 lines of chunk2");
  });

  it("tracks correct startLine per chunk", () => {
    const lines = Array(1600).fill("x").join("\n");
    const chunks = chunkCode(lines, { chunkSize: 800, overlap: 10 });
    assert.equal(chunks[0].startLine, 1);
    assert.equal(chunks[1].startLine, 791);
  });

  it("handles empty and non-string input without crashing", () => {
    assert.equal(chunkCode("").length, 1);
    assert.equal(chunkCode(null).length, 1);
  });

  it("throws when overlap >= chunkSize (would infinite-loop)", () => {
    assert.throws(() => chunkCode("a\nb\nc", { chunkSize: 3, overlap: 3 }), /overlap/);
    assert.throws(() => chunkCode("a\nb\nc", { chunkSize: 3, overlap: 5 }), /overlap/);
  });
});

describe("offsetFindings", () => {
  it("offsets line numbers by chunk startLine", () => {
    const results = [
      { startLine: 1, result: { issues: [{ file: "x", line: 15, finding: "a" }] } },
      { startLine: 791, result: { issues: [{ file: "x", line: 15, finding: "b" }] } },
    ];
    const issues = offsetFindings(results);
    assert.equal(issues[0].line, 15);
    assert.equal(issues[1].line, 805);
  });

  it("ignores non-numeric line numbers", () => {
    const results = [{ startLine: 791, result: { issues: [{ finding: "no line" }] } }];
    const issues = offsetFindings(results);
    assert.equal(issues[0].line, undefined);
  });

  it("skips failed chunk results", () => {
    const results = [
      { startLine: 1, result: { success: false, error: "boom" } },
      { startLine: 791, result: { success: true, issues: [{ line: 1, finding: "x" }] } },
    ];
    const issues = offsetFindings(results);
    assert.equal(issues.length, 1);
  });
});

describe("reviewFile", () => {
  it("reviews a small file in a single call", async () => {
    const calls = [];
    const reviewFn = async ({ code }) => {
      calls.push(code);
      return { success: true, severity: "low", issues: [], summary: "ok" };
    };
    const readFn = async () => "const x = 1;\nconst y = 2;";
    const r = await reviewFile({ model: "glm-5.2", backend: "codebuddy", file: "small.js", readFn, reviewFn });
    assert.equal(calls.length, 1);
    assert.equal(r.success, true);
  });

  it("reviews a large file in multiple chunks with offset lines", async () => {
    const calls = [];
    const reviewFn = async ({ code }) => {
      const n = code.split("\n").length;
      calls.push(n);
      return { success: true, severity: "low", issues: [{ file: "big.js", line: 5, finding: "f" }], summary: "ok" };
    };
    const readFn = async () => Array(1600).fill("const x = 1;").join("\n");
    const r = await reviewFile({ model: "glm-5.2", backend: "codebuddy", file: "big.js", readFn, reviewFn, chunkSize: 800, overlap: 10 });
    assert.equal(calls.length, 3);
    assert.equal(r.chunkCount, 3);
    // each chunk reported line 5; offset per chunk startLine
    const lines = r.issues.map(i => i.line).sort((a, b) => a - b);
    assert.deepEqual(lines, [5, 795, 1585]);
  });

  it("keeps other chunks' results when one chunk fails", async () => {
    const reviewFn = async ({ code }) => {
      if (code.includes("chunk-fail")) throw new Error("chunk down");
      return { success: true, severity: "low", issues: [{ line: 1, finding: "ok" }], summary: "ok" };
    };
    const readFn = async () => "chunk-fail\n" + Array(800).fill("x").join("\n");
    const r = await reviewFile({ model: "glm-5.2", backend: "codebuddy", file: "big.js", readFn, reviewFn, chunkSize: 800 });
    // 801 lines → 2 chunks (800 + 1, with overlap 10 it's 2 chunks)
    assert.equal(r.chunkCount, 2);
    assert.equal(r.success, false, "有分块失败时 success 应为 false");
    assert.equal(r.chunkErrors.length, 1, "应暴露失败的分块");
    assert.equal(r.issues.length, 1, "仍保留成功分块的 issues");
  });

  it("单块路径把 allowExternal 传给 reviewFn", async () => {
    let captured = null;
    const reviewFn = async (opts) => {
      captured = opts;
      return { success: true, severity: "low", issues: [], summary: "ok" };
    };
    const readFn = async () => "const x = 1;";
    await reviewFile({ model: "m", backend: "b", file: "f.js", readFn, reviewFn, allowExternal: true });
    assert.equal(captured.allowExternal, true, "单块路径必须透传 allowExternal");
  });

  it("多块评审每块都传 file（保留 import 上下文）", async () => {
    const captured = [];
    const reviewFn = async (opts) => {
      captured.push(opts);
      return { success: true, severity: "low", issues: [], summary: "ok" };
    };
    const readFn = async () => Array(1600).fill("x").join("\n");
    await reviewFile({ model: "m", backend: "b", file: "big.js", readFn, reviewFn, chunkSize: 800, overlap: 0 });
    assert.equal(captured.length, 2);
    assert.ok(captured.every((c) => c.file === "big.js"), "每个 chunk 都应收到 file（否则丢 [项目上下文]）");
  });

  it("passes fileName to reviewFn on single-chunk review", async () => {
    let captured = null;
    const reviewFn = async (opts) => {
      captured = opts.fileName;
      return { success: true, severity: "low", issues: [], summary: "ok" };
    };
    const readFn = async () => "const x = 1;";
    await reviewFile({ model: "m", backend: "b", file: "f.js", readFn, reviewFn });
    assert.equal(captured, "f.js");
  });

  it("passes fileName to reviewFn on every chunk of a large file", async () => {
    const names = [];
    const reviewFn = async (opts) => {
      names.push(opts.fileName);
      return { success: true, severity: "low", issues: [], summary: "ok" };
    };
    const readFn = async () => Array(1600).fill("const x = 1;").join("\n");
    await reviewFile({ model: "m", backend: "b", file: "big.js", readFn, reviewFn, chunkSize: 800 });
    assert.equal(names.length, 3);
    assert.ok(names.every((n) => n === "big.js"), "every chunk should carry the file name");
  });

  it("takes the highest severity across chunks, not the first", async () => {
    const sevs = ["low", "high", "medium"];
    let i = 0;
    const reviewFn = async () => ({ success: true, severity: sevs[i++], issues: [], summary: "ok" });
    const readFn = async () => Array(1600).fill("const x = 1;").join("\n");
    const r = await reviewFile({ model: "m", backend: "b", file: "big.js", readFn, reviewFn, chunkSize: 800, overlap: 0 });
    assert.equal(r.severity, "high");
  });

  it("聚合多块 chainAnalysis 为单个字符串（过滤空块）", async () => {
    let i = 0;
    const reviewFn = async () => {
      i += 1;
      const analysis = i === 2 ? "" : `chunk${i} analysis`;
      return { success: true, severity: "low", issues: [], summary: "ok", chainAnalysis: analysis };
    };
    const readFn = async () => Array(1600).fill("const x = 1;").join("\n");
    const r = await reviewFile({ model: "m", backend: "b", file: "big.js", readFn, reviewFn, chunkSize: 800, overlap: 10 });
    assert.equal(r.chainAnalysis, "chunk1 analysis\nchunk3 analysis");
  });
});

describe("review NL prompt selection", () => {
  it("uses NL_REVIEW_PROMPT when fileName is an NL artifact", async () => {
    let stdinWritten = null;
    setSpawn((cmd, args) => {
      const p = createMockProcess({ stdout: MOCK_OUTPUT_VALID });
      p.stdin = { write: (d) => { stdinWritten = d; }, end: () => {} };
      return p;
    });
    await review({ model: "m", backend: "codebuddy", code: "# 一个命令定义", fileName: ".opencode/skills/x/SKILL.md" });
    assert.ok(stdinWritten.includes("natural-language prompt artifact"), "should use NL review prompt for .md skill path");
  });

  it("uses REVIEW_PROMPT for a normal code file name", async () => {
    let stdinWritten = null;
    setSpawn((cmd, args) => {
      const p = createMockProcess({ stdout: MOCK_OUTPUT_VALID });
      p.stdin = { write: (d) => { stdinWritten = d; }, end: () => {} };
      return p;
    });
    await review({ model: "m", backend: "codebuddy", code: "const x = 1;", fileName: "src/foo.js" });
    assert.ok(stdinWritten.includes("Review the following code and report"), "should use code review prompt for .js");
  });
});

describe("prompt language requirement", () => {
  it("REVIEW_PROMPT requires English finding/fix", () => {
    assert.ok(REVIEW_PROMPT.toLowerCase().includes("english"), "REVIEW_PROMPT should require English output");
  });

  it("REVIEW_PROMPT 只报具体 bug 并要求触发条件+影响", () => {
    assert.match(REVIEW_PROMPT, /trigger condition/i, "应要求触发条件");
    assert.match(REVIEW_PROMPT, /impact/i, "应要求实际影响");
    assert.match(REVIEW_PROMPT, /Do NOT report/i, "应明确不报风格/性能/防御性建议");
    assert.ok(!REVIEW_PROMPT.includes("code quality problems"), "不应再要宽泛的 code quality problems");
  });

  it("REVIEW_PROMPT 强制调用链核查（两段式）", () => {
    assert.match(REVIEW_PROMPT, /trace its call chain/i, "应要求先追踪调用链");
    assert.match(REVIEW_PROMPT, /chain_analysis/i, "应要求输出 chain_analysis 字段");
    assert.match(REVIEW_PROMPT, /tilde expansion/i, "应点名 ~ 展开这类已处理的 case");
  });

  it("VERIFY_PROMPT requires English finding/fix", () => {
    assert.ok(VERIFY_PROMPT.includes("英文"), "VERIFY_PROMPT should require English output");
  });
});

describe("timeout defaults", () => {
  it("review default timeout is 900000ms", () => {
    assert.equal(DEFAULT_TIMEOUT, 900000);
  });
});

describe("reviewFile options", () => {
  it("passes customPrompt through to review", async () => {
    let captured = null;
    const reviewFn = async (opts) => {
      captured = opts.customPrompt;
      return { success: true, severity: "low", issues: [], summary: "ok" };
    };
    const readFn = async () => "const x = 1;";
    await reviewFile({ model: "m", backend: "b", file: "f", readFn, reviewFn, customPrompt: "提示" });
    assert.equal(captured, "提示");
  });
});

describe("withRetry", () => {
  it("retries a transient RunnerError then succeeds", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      if (calls === 1) throw new RunnerError("rate limited", { exitCode: 1 });
      return "ok";
    };
    const result = await withRetry(fn, { maxRetries: 2, backoffMs: [0, 0] });
    assert.equal(result, "ok");
    assert.equal(calls, 2);
  });

  it("retries TimeoutError then succeeds", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      if (calls < 3) throw new TimeoutError();
      return "done";
    };
    const result = await withRetry(fn, { maxRetries: 2, backoffMs: [0, 0] });
    assert.equal(result, "done");
    assert.equal(calls, 3);
  });

  it("does not retry AuthError", async () => {
    let calls = 0;
    const fn = async () => { calls++; throw new AuthError(); };
    await assert.rejects(() => withRetry(fn, { maxRetries: 2, backoffMs: [0, 0] }), AuthError);
    assert.equal(calls, 1);
  });

  it("gives up after maxRetries", async () => {
    let calls = 0;
    const fn = async () => { calls++; throw new RunnerError("boom", { exitCode: 1 }); };
    await assert.rejects(() => withRetry(fn, { maxRetries: 2, backoffMs: [0, 0] }), RunnerError);
    assert.equal(calls, 3);
  });

  it("clamps negative maxRetries to zero (never throws undefined)", async () => {
    let calls = 0;
    const fn = async () => { calls++; throw new RunnerError("boom", { exitCode: 1 }); };
    await assert.rejects(() => withRetry(fn, { maxRetries: -5, backoffMs: [0] }), RunnerError);
    assert.equal(calls, 1);
  });
});

describe("review retry integration", () => {
  it("retries the model call when retries > 0", async () => {
    setRetryBackoffMs([0, 0]);
    let calls = 0;
    setSpawn(() => {
      calls++;
      if (calls === 1) return createMockProcess({ exitCode: 1, stderr: "rate limited" });
      return createMockProcess({ stdout: MOCK_OUTPUT_VALID });
    });
    const result = await review({ model: "kimi-k2.7-code", backend: "kimi", code: "test", retries: 1 });
    assert.equal(result.success, true);
    assert.equal(calls, 2);
    setRetryBackoffMs(null);
  });

  it("does not retry when retries is not set", async () => {
    let calls = 0;
    setSpawn(() => {
      calls++;
      return createMockProcess({ exitCode: 1, stderr: "boom" });
    });
    await assert.rejects(
      () => review({ model: "m", backend: "codebuddy", code: "test" }),
      RunnerError
    );
    assert.equal(calls, 1);
  });

  it("retries empty output then succeeds", async () => {
    setRetryBackoffMs([0, 0]);
    let calls = 0;
    setSpawn(() => {
      calls++;
      if (calls === 1) return createMockProcess({ stdout: "" });
      return createMockProcess({ stdout: MOCK_OUTPUT_VALID });
    });
    const result = await review({ model: "kimi-k2.7-code", backend: "kimi", code: "test", retries: 2 });
    assert.equal(result.success, true);
    assert.equal(calls, 2);
    setRetryBackoffMs(null);
  });

  it("throws RunnerError after empty output exhausts retries", async () => {
    setRetryBackoffMs([0, 0]);
    let calls = 0;
    setSpawn(() => {
      calls++;
      return createMockProcess({ stdout: "" });
    });
    await assert.rejects(
      () => review({ model: "kimi-k2.7-code", backend: "kimi", code: "test", retries: 2 }),
      RunnerError
    );
    assert.equal(calls, 3);
    setRetryBackoffMs(null);
  });
});

describe("collectProjectRules", () => {
  it("returns AGENTS.md content with a header", async () => {
    const rules = await collectProjectRules({ cwd: "/p", readFile: makeRulesReader({ agents: "禁止 X" }) });
    assert.ok(rules.includes("=== AGENTS.md ==="), rules);
    assert.ok(rules.includes("禁止 X"), rules);
  });

  it("returns empty for empty input", async () => {
    const rules = await collectProjectRules({ cwd: "/p", readFile: makeRulesReader({}) });
    assert.equal(rules, "");
  });

  it("walks up to find AGENTS.md in an ancestor directory", async () => {
    const reader = async (p) => {
      if (p.endsWith("/repo/AGENTS.md")) return "根规则 ROOT";
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    };
    const rules = await collectProjectRules({ cwd: "/repo/sub/dir", readFile: reader });
    assert.ok(rules.includes("根规则 ROOT"), rules);
  });

  it("includes both AGENTS.md and CLAUDE.md when present", async () => {
    const rules = await collectProjectRules({ cwd: "/p", readFile: makeRulesReader({ agents: "规则A", claude: "规则B" }) });
    assert.ok(rules.includes("=== AGENTS.md ==="), rules);
    assert.ok(rules.includes("规则A"), rules);
    assert.ok(rules.includes("=== CLAUDE.md ==="), rules);
    assert.ok(rules.includes("规则B"), rules);
  });

  it("truncates to 400 lines when longer", async () => {
    const lines = [];
    for (let i = 1; i <= 500; i++) lines.push(`line${i}`);
    const rules = await collectProjectRules({ cwd: "/p", readFile: makeRulesReader({ agents: lines.join("\n") }) });
    assert.ok(rules.includes("line400"), "should keep line 400");
    assert.ok(!rules.includes("line401"), "should drop line 401");
  });

  it("swallows read errors and returns empty", async () => {
    const reader = async () => { throw Object.assign(new Error("EACCES"), { code: "EACCES" }); };
    const rules = await collectProjectRules({ cwd: "/p", readFile: reader });
    assert.equal(rules, "");
  });
});

describe("buildRulesSection", () => {
  it("wraps rules with a header", () => {
    const s = buildRulesSection("禁止 X");
    assert.ok(s.includes("[项目规则]"), s);
    assert.ok(s.includes("禁止 X"), s);
  });

  it("returns empty for blank rules", () => {
    assert.equal(buildRulesSection(""), "");
    assert.equal(buildRulesSection("   \n  "), "");
    assert.equal(buildRulesSection(null), "");
  });
});

describe("stripMarkdownComments", () => {
  it("去除 HTML 注释保留正文", () => {
    assert.equal(stripMarkdownComments("<!-- 说明 -->\n正文"), "\n正文");
  });

  it("多行注释一次性去除", () => {
    assert.equal(stripMarkdownComments("a<!-- x\ny\nz -->b"), "ab");
  });

  it("非字符串输入安全返回", () => {
    assert.equal(stripMarkdownComments(null), "");
  });
});

describe("collectWorkerLessons", () => {
  it("读取教训书并去除注释", async () => {
    const reader = async () => "<!-- 元信息 -->\n- 规则：先 trace 再报\n- 实例：x";
    const lessons = await collectWorkerLessons({ readFile: reader, filePath: "/tmp/lessons.md" });
    assert.ok(lessons.includes("- 规则：先 trace 再报"), lessons);
    assert.ok(!lessons.includes("元信息"), lessons);
  });

  it("文件不存在返回空", async () => {
    const reader = async () => { throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); };
    assert.equal(await collectWorkerLessons({ readFile: reader, filePath: "/nonexistent.md" }), "");
  });

  it("纯注释文件返回空（无教训不注入）", async () => {
    const reader = async () => "<!-- 只有注释 -->";
    assert.equal(await collectWorkerLessons({ readFile: reader, filePath: "/x.md" }), "");
  });
});

describe("buildLessonsSection", () => {
  it("wraps lessons with [评审教训] header", () => {
    const s = buildLessonsSection("- 规则：先 trace");
    assert.ok(s.includes("[评审教训]"), s);
    assert.ok(s.includes("- 规则：先 trace"), s);
  });

  it("returns empty for blank lessons", () => {
    assert.equal(buildLessonsSection(""), "");
    assert.equal(buildLessonsSection(null), "");
  });
});

describe("review lessons injection", () => {
  it("injects workerLessons into the prompt when provided", async () => {
    let stdinWritten = null;
    setSpawn((cmd, args) => {
      const p = createMockProcess({ stdout: MOCK_OUTPUT_VALID });
      p.stdin = { write: (d) => { stdinWritten = d; }, end: () => {} };
      return p;
    });

    await review({ model: "m", backend: "codebuddy", code: "const x = 1", workerLessons: "- 规则：先 trace 再报" });

    assert.ok(stdinWritten.includes("[评审教训]"), "should include lessons header");
    assert.ok(stdinWritten.includes("先 trace 再报"), "should include lessons content");
  });
});

describe("review project rules injection", () => {
  it("injects projectRules into the prompt", async () => {
    let stdinWritten = null;
    setSpawn((cmd, args) => {
      const p = createMockProcess({ stdout: MOCK_OUTPUT_VALID });
      p.stdin = { write: (d) => { stdinWritten = d; }, end: () => {} };
      return p;
    });

    await review({ model: "m", backend: "codebuddy", code: "const x = 1", projectRules: "禁止 CFTypeRef 强转" });

    assert.ok(stdinWritten, "should write to stdin");
    assert.ok(stdinWritten.includes("[项目规则]"), "should include rules header");
    assert.ok(stdinWritten.includes("禁止 CFTypeRef 强转"), "should include rules content");
  });

  it("omits rules section when no projectRules and cwd has no rule file", async () => {
    let stdinWritten = null;
    setSpawn((cmd, args) => {
      const p = createMockProcess({ stdout: MOCK_OUTPUT_VALID });
      p.stdin = { write: (d) => { stdinWritten = d; }, end: () => {} };
      return p;
    });

    await review({ model: "m", backend: "codebuddy", code: "const x = 1", cwd: "/nonexistent-dir-xyz" });

    assert.ok(stdinWritten, "should write to stdin");
    assert.ok(!stdinWritten.includes("[项目规则]"), "should not include rules section when none found");
  });

  it("collects rules from the reviewed file's directory when reviewing an external file", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "cc-rule-"));
    try {
      await writeFile(join(tmp, "AGENTS.md"), "外部项目规则 XYZ");
      const target = join(tmp, "target.md");
      await writeFile(target, "# 目标文件");

      let stdinWritten = null;
      setSpawn((cmd, args) => {
        const p = createMockProcess({ stdout: MOCK_OUTPUT_VALID });
        p.stdin = { write: (d) => { stdinWritten = d; }, end: () => {} };
        return p;
      });

      await review({ model: "m", backend: "codebuddy", file: target, allowExternal: true });

      assert.ok(stdinWritten.includes("外部项目规则 XYZ"), "rules should come from the reviewed file's directory, not cwd");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("injects import context (被依赖模块导出) into the prompt", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "cc-ctx-"));
    try {
      await writeFile(join(tmp, "db.js"), "export function resolveDbPath(p) { return p; }");
      const target = join(tmp, "main.js");
      await writeFile(target, 'import { resolveDbPath } from "./db.js";\nresolveDbPath("~/.local");');

      let stdinWritten = null;
      setSpawn((cmd, args) => {
        const p = createMockProcess({ stdout: MOCK_OUTPUT_VALID });
        p.stdin = { write: (d) => { stdinWritten = d; }, end: () => {} };
        return p;
      });

      await review({ model: "m", backend: "codebuddy", file: target, allowExternal: true });

      assert.ok(stdinWritten.includes("[项目上下文]"), "应含项目上下文段");
      assert.ok(stdinWritten.includes("resolveDbPath"), "应含被依赖模块的导出");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("NL artifact review prompt", () => {
  afterEach(() => {
    setSpawn(null);
  });

  const capturePrompt = async (opts) => {
    let stdinWritten = null;
    setSpawn((cmd, args) => {
      const p = createMockProcess({ stdout: MOCK_OUTPUT_VALID });
      p.stdin = { write: (d) => { stdinWritten = d; }, end: () => {} };
      return p;
    });
    await review(opts);
    return stdinWritten;
  };

  it("uses NL review prompt for command files", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "cc-nl-"));
    try {
      await mkdir(join(tmp, "commands"), { recursive: true });
      await writeFile(join(tmp, "commands", "tdd.md"), "# command");
      const stdin = await capturePrompt({ model: "m", backend: "codebuddy", file: join(tmp, "commands", "tdd.md"), allowExternal: true });
      assert.ok(stdin.includes("natural-language prompt artifact"), "should use NL prompt for command files");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("keeps code review prompt for source files", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "cc-nl-"));
    try {
      await mkdir(join(tmp, "src"), { recursive: true });
      await writeFile(join(tmp, "src", "foo.ts"), "const x = 1;");
      const stdin = await capturePrompt({ model: "m", backend: "codebuddy", file: join(tmp, "src", "foo.ts"), allowExternal: true });
      assert.ok(!stdin.includes("natural-language prompt artifact"), "should not use NL prompt for source files");
      assert.ok(stdin.includes("bugs"), "should use code review prompt for source files");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("customPrompt overrides NL detection", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "cc-nl-"));
    try {
      await mkdir(join(tmp, "commands"), { recursive: true });
      await writeFile(join(tmp, "commands", "tdd.md"), "# command");
      const stdin = await capturePrompt({ model: "m", backend: "codebuddy", file: join(tmp, "commands", "tdd.md"), allowExternal: true, customPrompt: "只找安全问题" });
      assert.ok(stdin.includes("只找安全问题"), "should use custom prompt");
      assert.ok(!stdin.includes("natural-language prompt artifact"), "should not auto-switch when customPrompt given");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("collectImportContext", () => {
  async function makeProject(files) {
    const dir = await mkdtemp(join(tmpdir(), "cc-import-"));
    for (const [rel, content] of Object.entries(files)) {
      const p = join(dir, rel);
      await mkdir(join(p, ".."), { recursive: true });
      await writeFile(p, content);
    }
    return dir;
  }

  it("提取本地 import 并生成导出摘要", async () => {
    const dir = await makeProject({
      "db.js": "export function resolveDbPath(p) { return p; }\nexport function openDb(p) { return p; }",
      "main.js": 'import { resolveDbPath, openDb } from "./db.js";\nresolveDbPath("~/.local");',
    });
    const ctx = await collectImportContext(join(dir, "main.js"));
    assert.match(ctx, /db\.js/, "应列出 db.js");
    assert.match(ctx, /resolveDbPath/, "应含 resolveDbPath 导出");
    assert.match(ctx, /openDb/, "应含 openDb 导出");
  });

  it("过滤非本地 import（node 内置/包名）", async () => {
    const dir = await makeProject({
      "main.js": 'import os from "node:os";\nimport { x } from "some-package";\nimport "./db.js";',
      "db.js": "export const helper = 1;",
    });
    const ctx = await collectImportContext(join(dir, "main.js"));
    assert.ok(!ctx.includes("node:os"), "不应含 node 内置模块");
    assert.ok(!ctx.includes("some-package"), "不应含包名");
    assert.match(ctx, /db\.js/, "应含本地模块");
  });

  it("本地模块读失败时跳过不报错", async () => {
    const dir = await makeProject({
      "main.js": 'import { missing } from "./does-not-exist.js";\nimport "./db.js";',
      "db.js": "export const ok = 1;",
    });
    const ctx = await collectImportContext(join(dir, "main.js"));
    assert.match(ctx, /db\.js/, "存在的模块应列出");
    assert.ok(!ctx.includes("does-not-exist"), "不存在的模块应跳过");
  });

  it("无本地 import 时返回空字符串", async () => {
    const dir = await makeProject({ "main.js": "const x = 1;\n" });
    const ctx = await collectImportContext(join(dir, "main.js"));
    assert.equal(ctx, "");
  });

  it("无扩展名的 import 不读裸路径（防密钥外泄）", async () => {
    const dir = await makeProject({
      "main.js": 'import cfg from "./secret";\n',
      "secret": "PRIVATE_KEY=supersecretvalue",
    });
    const ctx = await collectImportContext(join(dir, "main.js"));
    assert.ok(!ctx.includes("PRIVATE_KEY"), "不得内联无扩展名文件内容");
  });

  it("逃逸到项目外的无扩展名 import 不读取", async () => {
    const parent = await mkdtemp(join(tmpdir(), "cc-escape-"));
    const dir = join(parent, "proj");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "main.js"), 'import cfg from "../topsecret";\n');
    await writeFile(join(parent, "topsecret"), "API_TOKEN=leaked");
    const ctx = await collectImportContext(join(dir, "main.js"));
    assert.ok(!ctx.includes("API_TOKEN"), "不得读取项目外的无扩展名文件");
  });
});

describe("review parses chain_analysis", () => {
  afterEach(() => setSpawn(null));

  it("能解析含 chain_analysis 字段的评审输出", async () => {
    const out = JSON.stringify({
      chain_analysis: "issue1 involves openDb; openDb internally calls resolveDbPath which expands ~",
      severity: "low",
      issues: [{ file: "a.js", line: 1, finding: "real bug", fix: "fix it" }],
      summary: "1 issue",
    });
    setSpawn(() => createMockProcess({ stdout: out }));
    const r = await review({ model: "m", backend: "codebuddy", code: "const x = 1;" });
    assert.equal(r.success, true);
    assert.equal(r.severity, "low");
    assert.equal(r.issues.length, 1);
    assert.equal(r.issues[0].finding, "real bug");
    assert.equal(r.chainAnalysis, "issue1 involves openDb; openDb internally calls resolveDbPath which expands ~");
  });
});

describe("review cwd 参数", () => {
  afterEach(() => setSpawn(null));

  it("file 模式用 cwd 解析相对路径", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "cc-cwd-"));
    try {
      await writeFile(join(tmp, "a.js"), "export const x = 1;");
      let stdinWritten = null;
      setSpawn((cmd, args) => {
        const p = createMockProcess({ stdout: MOCK_OUTPUT_VALID });
        p.stdin = { write: (d) => { stdinWritten = d; }, end: () => {} };
        return p;
      });
      const r = await review({ model: "m", backend: "codebuddy", file: "a.js", cwd: tmp });
      assert.equal(r.success, true, "相对 file 应以 cwd 为基目录解析");
      assert.ok(stdinWritten.includes("export const x = 1;"), "应读到 cwd 下的文件内容");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("isAuthError", () => {
  it("识别真实 401 Unauthorized", () => {
    assert.equal(isAuthError("error: 401 Unauthorized"), true);
    assert.equal(isAuthError("HTTP 401 Unauthorized"), true);
  });

  it("识别 invalid api key", () => {
    assert.equal(isAuthError("Error: invalid api key"), true);
  });

  it("不误判栈帧行号 at file.ts:401:5", () => {
    assert.equal(isAuthError("TypeError at foo.js:401:5"), false);
  });

  it("不误判端口号 40123", () => {
    assert.equal(isAuthError("EADDRINUSE port 40123"), false);
  });

  it("不误判字节数 14012", () => {
    assert.equal(isAuthError("wrote 14012 bytes"), false);
  });
});

describe("isNLArtifact 精确匹配", () => {
  it("fooskill.md 不是 NL 工件", () => {
    assert.equal(isNLArtifact("fooskill.md"), false);
  });

  it("myagents.md 不是 NL 工件", () => {
    assert.equal(isNLArtifact("myagents.md"), false);
  });

  it("真正的 SKILL.md 是 NL 工件", () => {
    assert.equal(isNLArtifact(".opencode/skills/cc-review/SKILL.md"), true);
  });
});

describe("review 不重复读盘", () => {
  afterEach(() => setSpawn(null));

  it("code 已提供时不再读 file（不覆盖 code）", async () => {
    let stdinWritten = null;
    setSpawn((cmd, args) => {
      const p = createMockProcess({ stdout: MOCK_OUTPUT_VALID });
      p.stdin = { write: (d) => { stdinWritten = d; }, end: () => {} };
      return p;
    });
    const missingFile = join(tmpdir(), "definitely-not-exist-xyz.js");
    const r = await review({ model: "m", backend: "codebuddy", code: "const provided = 1;", file: missingFile, allowExternal: true });
    assert.equal(r.success, true, "code 已提供时不应因 file 不存在而失败");
    assert.ok(stdinWritten.includes("const provided = 1;"), "prompt 应使用传入的 code");
  });
});

describe("criticize", () => {
  afterEach(() => setSpawn(null));

  it("CRITIC_PROMPT 是批判角色（同意/反对/补漏）", () => {
    assert.match(CRITIC_PROMPT, /批判/, "应含批判");
    assert.match(CRITIC_PROMPT, /同意/, "应含同意");
    assert.match(CRITIC_PROMPT, /反对/, "应含反对");
    assert.match(CRITIC_PROMPT, /遗漏/, "应含补漏");
    assert.match(CRITIC_PROMPT, /为什么是漏报/, "missed 应要求 reason 依据");
  });

  it("buildCriticPrompt 含 findings 清单 + code", () => {
    const p = buildCriticPrompt(
      [{ file: "a.js", line: 3, finding: "bug one" }],
      "const x = 1;"
    );
    assert.ok(p.includes("bug one"), "应含 finding");
    assert.ok(p.includes("a.js:3"), "应含位置");
    assert.ok(p.includes("const x = 1;"), "应含 code");
  });

  it("criticize 转发 spawn 参数（不回落全局 spawn）", async () => {
    let globalCalled = false;
    setSpawn(() => { globalCalled = true; return createMockProcess({ stdout: MOCK_OUTPUT_VALID }); });
    let localCalled = false;
    const localSpawn = () => { localCalled = true; return createMockProcess({ stdout: MOCK_OUTPUT_VALID }); };
    await criticize({ findings: [], code: "x", spawn: localSpawn });
    assert.equal(localCalled, true, "应使用传入的 spawn");
    assert.equal(globalCalled, false, "不应回落全局 spawn");
  });

  it("criticize 解析 verdicts 和 missed", async () => {
    const out = JSON.stringify({
      verdicts: [{ index: 0, agree: false, reason: "openDb 内部已展开 ~" }],
      missed: [{ file: "a.js", line: 9, finding: "real missed bug" }],
    });
    setSpawn(() => createMockProcess({ stdout: out }));
    const r = await criticize({ findings: [{ file: "a.js", line: 3, finding: "~ not expanded" }], code: "x" });
    assert.equal(r.verdicts.length, 1);
    assert.equal(r.verdicts[0].agree, false);
    assert.equal(r.missed.length, 1);
    assert.equal(r.missed[0].finding, "real missed bug");
  });

  it("criticize 容错：非 JSON 输出返回空", async () => {
    setSpawn(() => createMockProcess({ stdout: "not json" }));
    const r = await criticize({ findings: [], code: "x" });
    assert.deepEqual(r, { verdicts: [], missed: [] });
  });

  it("mapCriticVerdicts 按 index 映射回 findings（越界跳过）", () => {
    const verdicts = [
      { index: 0, agree: false, reason: "r0" },
      { index: 2, agree: true, reason: "r2" },
      { index: 99, agree: true, reason: "越界" },
    ];
    const findings = [
      { file: "a.js", line: 1, finding: "f0" },
      { file: "b.js", line: 2, finding: "f1" },
      { file: "c.js", line: 3, finding: "f2" },
    ];
    const mapped = mapCriticVerdicts(verdicts, findings);
    assert.equal(mapped.length, 2, "越界 index 应跳过");
    assert.equal(mapped[0].file, "a.js");
    assert.equal(mapped[0].agree, false);
    assert.equal(mapped[1].file, "c.js");
    assert.equal(mapped[1].agree, true);
  });

  it("buildMissedFindings 映射为 qwen-critic 条目（reason 存 chainAnalysis）", () => {
    const missed = [{ file: "d.js", line: 4, finding: "漏报", reason: "为什么漏" }];
    const entries = buildMissedFindings(missed, "fallback.js");
    assert.equal(entries.length, 1);
    assert.equal(entries[0].file, "d.js");
    assert.equal(entries[0].source, "qwen-critic");
    assert.equal(entries[0].chainAnalysis, "为什么漏");
    assert.deepEqual(entries[0].models, ["qwen3-coder-plus"]);
  });

  it("buildMissedFindings 模型参数化（不硬编码）", () => {
    const entries = buildMissedFindings([{ finding: "f" }], "fb.js", { model: "custom-critic" });
    assert.deepEqual(entries[0].models, ["custom-critic"]);
  });

  it("criticize 空输出重试后成功", async () => {
    setRetryBackoffMs([0, 0]);
    let calls = 0;
    setSpawn(() => {
      calls++;
      if (calls === 1) return createMockProcess({ stdout: "" });
      return createMockProcess({ stdout: JSON.stringify({ verdicts: [{ index: 0, agree: true, reason: "ok" }], missed: [] }) });
    });
    const r = await criticize({ findings: [{ file: "a.js", line: 1, finding: "x" }], code: "x", retries: 2 });
    assert.equal(calls, 2);
    assert.equal(r.verdicts.length, 1);
    setRetryBackoffMs(null);
  });

  it("criticize 空输出耗尽重试抛 RunnerError", async () => {
    setRetryBackoffMs([0, 0]);
    let calls = 0;
    setSpawn(() => { calls++; return createMockProcess({ stdout: "" }); });
    await assert.rejects(
      () => criticize({ findings: [], code: "x", retries: 2 }),
      RunnerError
    );
    assert.equal(calls, 3);
    setRetryBackoffMs(null);
  });
});

describe("parseCriticArgs", () => {
  it("解析 --critic 的 file 和 findings-file", () => {
    const r = parseCriticArgs(["--critic", "--file", "a.js", "--findings-file", "f.json"]);
    assert.equal(r.file, "a.js");
    assert.equal(r.findingsFile, "f.json");
  });

  it("缺 --file/--findings-file 返回 null（不越界到 args[0]）", () => {
    const r = parseCriticArgs(["--critic"]);
    assert.equal(r.file, null);
    assert.equal(r.findingsFile, null);
  });
});

describe("selfCheck", () => {
  afterEach(() => setSpawn(null));

  it("SELF_CHECK_PROMPT 是自检角色", () => {
    assert.match(SELF_CHECK_PROMPT, /自检/, "应含自检");
    assert.match(SELF_CHECK_PROMPT, /keep/, "应含 keep 字段");
  });

  it("buildSelfCheckPrompt 含 findings 清单 + code", () => {
    const p = buildSelfCheckPrompt([{ file: "a.js", line: 3, finding: "bug one" }], "const x = 1;");
    assert.ok(p.includes("bug one"), "应含 finding");
    assert.ok(p.includes("a.js:3"), "应含位置");
    assert.ok(p.includes("const x = 1;"), "应含 code");
  });

  it("selfCheck 解析 survivors", async () => {
    const out = JSON.stringify({ survivors: [{ index: 0, keep: false, reason: "已展开 ~" }] });
    setSpawn(() => createMockProcess({ stdout: out }));
    const r = await selfCheck({ findings: [{ file: "a.js", line: 3, finding: "~ not expanded" }], code: "x", model: "glm-5.2", backend: "codebuddy" });
    assert.equal(r.survivors.length, 1);
    assert.equal(r.survivors[0].keep, false);
  });

  it("selfCheck 容错：非 JSON 返回空 survivors", async () => {
    setSpawn(() => createMockProcess({ stdout: "not json" }));
    const r = await selfCheck({ findings: [], code: "x", model: "glm-5.2", backend: "codebuddy" });
    assert.deepEqual(r, { survivors: [] });
  });

  it("selfCheck 空输出重试后成功", async () => {
    setRetryBackoffMs([0, 0]);
    let calls = 0;
    setSpawn(() => {
      calls++;
      if (calls === 1) return createMockProcess({ stdout: "" });
      return createMockProcess({ stdout: JSON.stringify({ survivors: [{ index: 0, keep: true, reason: "ok" }] }) });
    });
    const r = await selfCheck({ findings: [{ file: "a.js", line: 1, finding: "x" }], code: "x", model: "glm-5.2", backend: "codebuddy", retries: 2 });
    assert.equal(calls, 2);
    assert.equal(r.survivors.length, 1);
    setRetryBackoffMs(null);
  });

  it("selfCheck 空输出耗尽重试抛 RunnerError", async () => {
    setRetryBackoffMs([0, 0]);
    let calls = 0;
    setSpawn(() => { calls++; return createMockProcess({ stdout: "" }); });
    await assert.rejects(
      () => selfCheck({ findings: [], code: "x", model: "glm-5.2", backend: "codebuddy", retries: 2 }),
      RunnerError
    );
    assert.equal(calls, 3);
    setRetryBackoffMs(null);
  });

  it("applySelfCheck 只保留 keep=true 的 finding", () => {
    const findings = [{ finding: "a" }, { finding: "b" }, { finding: "c" }];
    const survivors = [
      { index: 0, keep: true },
      { index: 1, keep: false },
      { index: 2, keep: true },
    ];
    const out = applySelfCheck(findings, survivors);
    assert.deepEqual(out, [{ finding: "a" }, { finding: "c" }]);
  });

  it("applySelfCheck 非法 index 忽略", () => {
    const findings = [{ finding: "a" }];
    const survivors = [{ index: "x", keep: true }, { index: 99, keep: true }];
    assert.deepEqual(applySelfCheck(findings, survivors), []);
  });

  it("applySelfCheck 空 survivors 返回空", () => {
    assert.deepEqual(applySelfCheck([{ finding: "a" }], []), []);
    assert.deepEqual(applySelfCheck([], null), []);
  });
});

describe("reviewFile 空文件", () => {
  it("空文件单块路径也传 file 给 review", async () => {
    let captured = null;
    const reviewFn = async (opts) => {
      captured = opts;
      return { success: true, issues: [] };
    };
    const readFn = async () => "";
    const r = await reviewFile({ model: "m", backend: "b", file: "empty.js", readFn, reviewFn });
    assert.ok(captured.file, "空文件单块路径应传 file（否则 review 抛 'code or file required'）");
    assert.equal(r.success, true);
  });
});

describe("collectStackContext", () => {
  async function makeProj(files) {
    const dir = await mkdtemp(join(tmpdir(), "cc-stack-"));
    for (const [rel, content] of Object.entries(files)) {
      const p = join(dir, rel);
      await mkdir(join(p, ".."), { recursive: true });
      await writeFile(p, content);
    }
    return dir;
  }

  it("读 package.json 提取技术栈摘要", async () => {
    const dir = await makeProj({
      "package.json": JSON.stringify({
        name: "x",
        engines: { node: ">=22" },
        dependencies: { react: "^18" },
        devDependencies: { vitest: "^2" },
        scripts: { test: "node --test" },
      }),
    });
    const s = await collectStackContext(dir);
    assert.match(s, /Node\.js/, "应含 Node.js");
    assert.match(s, /node >=22/, "应含 node 版本");
    assert.match(s, /react/, "应含依赖 react");
    assert.match(s, /node --test/, "应含 test 脚本");
  });

  it("子目录向上查找根 package.json", async () => {
    const dir = await makeProj({ "package.json": JSON.stringify({ engines: { node: ">=22" } }) });
    const s = await collectStackContext(join(dir, "src", "sub"));
    assert.match(s, /Node\.js/, "应向上找到根 package.json");
  });

  it("无技术栈文件返回空串", async () => {
    const dir = await makeProj({ "README.md": "x" });
    assert.equal(await collectStackContext(dir), "");
  });

  it("损坏 package.json 不抛错", async () => {
    const dir = await makeProj({ "package.json": "{ bad" });
    assert.equal(await collectStackContext(dir), "");
  });

  it("requirements.txt 识别 Python + 依赖", async () => {
    const dir = await makeProj({ "requirements.txt": "fastapi\npytest\n" });
    const s = await collectStackContext(dir);
    assert.match(s, /Python/);
    assert.match(s, /fastapi/);
  });

  it("go.mod 识别 Go", async () => {
    const dir = await makeProj({ "go.mod": "module x\n\ngo 1.21\n" });
    assert.match(await collectStackContext(dir), /Go/);
  });

  it("Cargo.toml 识别 Rust", async () => {
    const dir = await makeProj({ "Cargo.toml": "[package]\nname = \"x\"\n" });
    assert.match(await collectStackContext(dir), /Rust/);
  });
});

describe("review 注入技术栈", () => {
  afterEach(() => setSpawn(null));

  it("file 模式注入 [技术栈] 段", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "cc-stk-"));
    try {
      await writeFile(join(tmp, "package.json"), JSON.stringify({ engines: { node: ">=22" }, dependencies: { react: "^18" } }));
      const target = join(tmp, "a.js");
      await writeFile(target, "export const x = 1;");

      let stdinWritten = null;
      setSpawn((cmd, args) => {
        const p = createMockProcess({ stdout: MOCK_OUTPUT_VALID });
        p.stdin = { write: (d) => { stdinWritten = d; }, end: () => {} };
        return p;
      });

      await review({ model: "m", backend: "codebuddy", file: target, allowExternal: true });

      assert.ok(stdinWritten.includes("[技术栈]"), "应含技术栈段");
      assert.ok(stdinWritten.includes("react"), "应含依赖 react");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("无技术栈文件不注入 [技术栈]", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "cc-stk-"));
    try {
      const target = join(tmp, "a.js");
      await writeFile(target, "export const x = 1;");

      let stdinWritten = null;
      setSpawn((cmd, args) => {
        const p = createMockProcess({ stdout: MOCK_OUTPUT_VALID });
        p.stdin = { write: (d) => { stdinWritten = d; }, end: () => {} };
        return p;
      });

      await review({ model: "m", backend: "codebuddy", file: target, allowExternal: true });

      assert.ok(!stdinWritten.includes("[技术栈]"), "无技术栈文件不应注入");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("review dir 模式注入技术栈", () => {
  afterEach(() => setSpawn(null));

  it("dir 模式采集技术栈", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "cc-stk-"));
    try {
      await writeFile(join(tmp, "package.json"), JSON.stringify({ engines: { node: ">=22" }, dependencies: { react: "^18" } }));
      await writeFile(join(tmp, "a.js"), "export const x = 1;");

      let stdinWritten = null;
      setSpawn((cmd, args) => {
        const p = createMockProcess({ stdout: MOCK_OUTPUT_VALID });
        p.stdin = { write: (d) => { stdinWritten = d; }, end: () => {} };
        return p;
      });

      await review({ model: "m", backend: "codebuddy", dir: tmp, allowExternal: true });

      assert.ok(stdinWritten.includes("[技术栈]"), "dir 模式应含技术栈段");
      assert.ok(stdinWritten.includes("react"), "应含依赖 react");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("dir 模式无技术栈文件不注入", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "cc-stk-"));
    try {
      await writeFile(join(tmp, "a.js"), "export const x = 1;");

      let stdinWritten = null;
      setSpawn((cmd, args) => {
        const p = createMockProcess({ stdout: MOCK_OUTPUT_VALID });
        p.stdin = { write: (d) => { stdinWritten = d; }, end: () => {} };
        return p;
      });

      await review({ model: "m", backend: "codebuddy", dir: tmp, allowExternal: true });

      assert.ok(!stdinWritten.includes("[技术栈]"), "无技术栈文件不应注入");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("source tamper protection (hash verification)", () => {
  afterEach(() => setSpawn(null));

  it("snapshotSourceHashes + hashesDiffer 检测到文件被改", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cc-hash-"));
    try {
      const target = join(dir, "t.js");
      await writeFile(target, "const original = 1;\n");
      const before = await snapshotSourceHashes([target]);
      await writeFile(target, "const tampered = 1;\n");
      const after = await snapshotSourceHashes([target]);
      assert.ok(hashesDiffer(before, after), "应检测到 hash 变化");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("hashesDiffer 对不变文件返回 false（不误报）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cc-hash-"));
    try {
      const target = join(dir, "t.js");
      await writeFile(target, "const original = 1;\n");
      const before = await snapshotSourceHashes([target]);
      const after = await snapshotSourceHashes([target]);
      assert.ok(!hashesDiffer(before, after), "未变不应误报");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("snapshotSourceHashes 跳过读不到的文件（容错）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cc-hash-"));
    try {
      const hashes = await snapshotSourceHashes([join(dir, "nope.js")]);
      assert.deepEqual(Object.keys(hashes), []);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("file 模式评审期间文件被改 → 抛 SourceTamperedError", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cc-hash-"));
    try {
      const target = join(dir, "t.js");
      await writeFile(target, "const original = 1;\n");
      setSpawn(() => {
        writeFileSync(target, "const tampered = 1;\n");
        return createMockProcess({ stdout: MOCK_OUTPUT_VALID });
      });
      await assert.rejects(
        () => review({ model: "glm-5.2", backend: "codebuddy", file: target, allowExternal: true }),
        SourceTamperedError
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("file 模式正常评审 → 不抛 SourceTamperedError（不误报）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cc-hash-"));
    try {
      const target = join(dir, "t.js");
      await writeFile(target, "const original = 1;\n");
      setSpawn(() => createMockProcess({ stdout: MOCK_OUTPUT_VALID }));
      const r = await review({ model: "glm-5.2", backend: "codebuddy", file: target, allowExternal: true });
      assert.equal(r.success, true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("file 不存在时容错跳过 hash（保持向后兼容）", async () => {
    const missing = join(tmpdir(), "definitely-not-exist-abc.js");
    setSpawn(() => createMockProcess({ stdout: MOCK_OUTPUT_VALID }));
    const r = await review({ model: "m", backend: "codebuddy", code: "const x = 1;", file: missing, allowExternal: true });
    assert.equal(r.success, true, "file 不存在不应因 hash 校验崩溃");
  });

  it("dir 模式评审期间目录内文件被改 → 抛 SourceTamperedError", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cc-hashdir-"));
    try {
      const f = join(dir, "a.js");
      await writeFile(f, "const a = 1;\n");
      setSpawn(() => {
        writeFileSync(f, "const tampered = 1;\n");
        return createMockProcess({ stdout: MOCK_OUTPUT_VALID });
      });
      await assert.rejects(
        () => review({ model: "glm-5.2", backend: "codebuddy", dir, exts: [".js"], allowExternal: true }),
        SourceTamperedError
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("dir 模式正常评审 → 不抛 SourceTamperedError（不误报）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cc-hashdir-"));
    try {
      await writeFile(join(dir, "a.js"), "const a = 1;\n");
      setSpawn(() => createMockProcess({ stdout: MOCK_OUTPUT_VALID }));
      const r = await review({ model: "glm-5.2", backend: "codebuddy", dir, exts: [".js"], allowExternal: true });
      assert.equal(r.success, true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
