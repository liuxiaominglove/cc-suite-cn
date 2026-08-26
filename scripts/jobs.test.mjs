import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJobStore, runJob, parseArgs, defaultStore, buildMeta, DEFAULT_JOBS_DIR, updateJobWithResult, spawnWorker, runJobBackground, cancelJob, runAudit, summarizeWorkers, acquireSlot, __resetSlotsForTest, AUDIT_WORKERS, isValidJobId, buildFindingEntries, persistFindings, backgroundHint } from "./jobs.mjs";
import { AuthError } from "./review-runner.mjs";
import { readFileSync } from "node:fs";

const cleanups = [];
afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop();
    await fn();
  }
  __resetSlotsForTest();
});

async function makeStore() {
  const dir = await mkdtemp(join(tmpdir(), "jobs-test-"));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return { store: createJobStore({ dir }), dir };
}

describe("createJobStore", () => {
  it("create generates a running job with id and startedAt", async () => {
    const { store } = await makeStore();
    const job = await store.create({ type: "review", model: "glm-5.2" });
    assert.ok(job.id);
    assert.equal(job.status, "running");
    assert.ok(job.startedAt);
    assert.equal(job.finishedAt, null);
  });

  it("create generates unique ids", async () => {
    const { store } = await makeStore();
    const a = await store.create({ type: "review" });
    const b = await store.create({ type: "review" });
    assert.notEqual(a.id, b.id);
  });

  it("get returns an existing job", async () => {
    const { store } = await makeStore();
    const created = await store.create({ type: "review", model: "x" });
    const got = await store.get(created.id);
    assert.equal(got.id, created.id);
    assert.equal(got.model, "x");
  });

  it("get returns null for a missing id", async () => {
    const { store } = await makeStore();
    const got = await store.get("does-not-exist");
    assert.equal(got, null);
  });

  it("update patches status and result", async () => {
    const { store } = await makeStore();
    const created = await store.create({ type: "implement" });
    const updated = await store.update(created.id, { status: "completed", result: { ok: true } });
    assert.equal(updated.status, "completed");
    assert.equal(updated.result.ok, true);
  });

  it("update returns null for a missing id", async () => {
    const { store } = await makeStore();
    const updated = await store.update("nope", { status: "completed" });
    assert.equal(updated, null);
  });

  it("update 原子写不残留临时文件", async () => {
    const { store, dir } = await makeStore();
    const job = await store.create({ type: "review" });
    for (let i = 0; i < 5; i++) {
      await store.update(job.id, { status: "completed", n: i });
    }
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(dir);
    assert.ok(!files.some((f) => f.endsWith(".tmp")), "目录不得残留 .tmp 临时文件");
    const got = await store.get(job.id);
    assert.equal(got.n, 4, "最终写入应完整");
  });

  it("list returns jobs newest-first", async () => {
    const { store } = await makeStore();
    const first = await store.create({ type: "review" });
    await new Promise((r) => setTimeout(r, 5));
    const second = await store.create({ type: "implement" });
    const jobs = await store.list();
    const ids = jobs.map((j) => j.id);
    assert.deepEqual(ids, [second.id, first.id]);
  });

  it("cancel marks the job cancelled with finishedAt", async () => {
    const { store } = await makeStore();
    const created = await store.create({ type: "review" });
    const cancelled = await store.cancel(created.id);
    assert.equal(cancelled.status, "cancelled");
    assert.ok(cancelled.finishedAt);
  });

  it("cancel 不覆盖已终态 job（completed 保持原状）", async () => {
    const { store } = await makeStore();
    const created = await store.create({ type: "review" });
    await store.update(created.id, { status: "completed", result: { ok: true } });
    const after = await store.cancel(created.id);
    assert.equal(after.status, "completed", "completed 是终态，cancel 不得覆盖");
    assert.deepEqual(after.result, { ok: true });
  });

  it("并发 update 都生效（锁串行化，不丢 patch）", async () => {
    const { store } = await makeStore();
    const created = await store.create({ type: "review" });
    await Promise.all([
      store.update(created.id, { result: "A" }),
      store.update(created.id, { error: "B" }),
    ]);
    const final = await store.get(created.id);
    assert.equal(final.result, "A", "第一个 patch 不丢");
    assert.equal(final.error, "B", "第二个 patch 不丢");
  });

  it("persists across store instances on the same dir", async () => {
    const { store, dir } = await makeStore();
    const created = await store.create({ type: "review", model: "kimi" });
    const store2 = createJobStore({ dir });
    const got = await store2.get(created.id);
    assert.equal(got.id, created.id);
    assert.equal(got.model, "kimi");
  });

  it("rejects path-traversal ids (no read/write outside the jobs dir)", async () => {
    const { store, dir } = await makeStore();
    const outside = join(dir, "..", "pwned.json");
    const got = await store.get("../../pwned");
    assert.equal(got, null);
    assert.equal(await store.update("../../pwned", { status: "completed" }), null);
    assert.equal(await store.cancel("../pwned"), null);
    const { existsSync } = await import("node:fs");
    assert.equal(existsSync(outside), false, "must not create a file outside the jobs dir");
  });

  it("路径穿越 id 不得读取/改写已存在的外部文件", async () => {
    const { store, dir } = await makeStore();
    const name = `pwned-${Date.now()}.json`;
    const outside = join(dir, "..", name);
    const { writeFile, readFile, rm } = await import("node:fs/promises");
    try {
      await writeFile(outside, JSON.stringify({ marker: "untouched" }));
      const got = await store.get(`../../${name}`);
      assert.equal(got, null, "不得读取 jobs 目录外的文件");
      assert.equal(await store.update(`../../${name}`, { status: "completed" }), null);
      const after = JSON.parse(await readFile(outside, "utf8"));
      assert.equal(after.marker, "untouched", "外部文件不得被改写");
    } finally {
      await rm(outside, { force: true });
    }
  });

  it("isValidJobId 拒绝路径遍历向量", () => {
    assert.equal(isValidJobId("../../pwned"), false);
    assert.equal(isValidJobId("../pwned"), false);
    assert.equal(isValidJobId("job-1234-abcd/../evil"), false);
    assert.equal(isValidJobId("job-1234-abcd/evil"), false);
    assert.equal(isValidJobId("job-1234-abcd"), true);
  });
});

describe("runJob", () => {
  it("marks completed with result when fn succeeds", async () => {
    const { store } = await makeStore();
    const id = await runJob(store, { type: "review", model: "x" }, async () => ({ ok: true }));
    const job = await store.get(id);
    assert.equal(job.status, "completed");
    assert.deepEqual(job.result, { ok: true });
  });

  it("marks failed with error when fn throws", async () => {
    const { store } = await makeStore();
    const id = await runJob(store, { type: "implement" }, async () => {
      throw new Error("boom");
    });
    const job = await store.get(id);
    assert.equal(job.status, "failed");
    assert.equal(job.error, "boom");
  });

  it("returns the job id", async () => {
    const { store } = await makeStore();
    const id = await runJob(store, { type: "review" }, async () => ({ ok: true }));
    const job = await store.get(id);
    assert.equal(job.id, id);
  });
});

describe("parseArgs", () => {
  it("parses --list", () => {
    assert.deepEqual(parseArgs(["--list"]), { action: "list" });
  });

  it("parses --get with id", () => {
    assert.deepEqual(parseArgs(["--get", "abc"]), { action: "get", id: "abc" });
  });

  it("parses --cancel with id", () => {
    assert.deepEqual(parseArgs(["--cancel", "abc"]), { action: "cancel", id: "abc" });
  });

  it("parses --run-review with model and file", () => {
    assert.deepEqual(parseArgs(["--run-review", "--model", "glm-5.2", "--file", "x.js"]), {
      action: "run-review",
      model: "glm-5.2",
      file: "x.js",
    });
  });

  it("parses --worker-sleep with job-id and ms", () => {
    assert.deepEqual(parseArgs(["--worker-sleep", "--job-id", "j1", "--ms", "60000"]), {
      action: "worker-sleep",
      jobId: "j1",
      ms: 60000,
    });
  });

  it("returns help on empty args", () => {
    assert.deepEqual(parseArgs([]), { action: "help" });
  });

  it("returns help on unknown flag", () => {
    assert.deepEqual(parseArgs(["--wat"]), { action: "help" });
  });

  it("parses --run-audit with file", () => {
    assert.deepEqual(parseArgs(["--run-audit", "--file", "x.js"]), { action: "run-audit", file: "x.js" });
  });

  it("parses --allow-external and --prompt on run-audit", () => {
    const r = parseArgs(["--run-audit", "--file", "x.md", "--allow-external", "--prompt", "评审NL工件"]);
    assert.equal(r.allowExternal, true);
    assert.equal(r.prompt, "评审NL工件");
  });

  it("parses --allow-external and --prompt on run-review", () => {
    const r = parseArgs(["--run-review", "--model", "glm-5.2", "--file", "x.md", "--allow-external", "--prompt", "评审"]);
    assert.equal(r.allowExternal, true);
    assert.equal(r.prompt, "评审");
  });

  it("parses --project-dir on run-audit", () => {
    assert.equal(parseArgs(["--run-audit", "--file", "x.js", "--project-dir", "/p"]).projectDir, "/p");
  });

  it("omits projectDir when --project-dir not given", () => {
    assert.equal(parseArgs(["--run-audit", "--file", "x.js"]).projectDir, undefined);
  });

  it("parses --project-dir on worker-audit", () => {
    assert.equal(parseArgs(["--worker-audit", "--job-id", "j1", "--file", "x.js", "--project-dir", "/p"]).projectDir, "/p");
  });
});

describe("defaultStore", () => {
  it("points at the default jobs dir", () => {
    assert.equal(DEFAULT_JOBS_DIR, ".cc-suite-cn/jobs");
  });

  it("returns a working store", async () => {
    const store = defaultStore();
    assert.equal(typeof store.create, "function");
    assert.equal(typeof store.get, "function");
  });
});

describe("buildMeta", () => {
  it("builds review meta from run-review", () => {
    assert.deepEqual(buildMeta({ action: "run-review", model: "glm-5.2", file: "x.js" }), {
      type: "review",
      model: "glm-5.2",
      task: "x.js",
    });
  });
});

describe("updateJobWithResult", () => {
  it("marks completed with result when fn succeeds", async () => {
    const { store } = await makeStore();
    const job = await store.create({ type: "review" });
    await updateJobWithResult(store, job.id, async () => ({ ok: true }));
    const got = await store.get(job.id);
    assert.equal(got.status, "completed");
    assert.deepEqual(got.result, { ok: true });
  });

  it("marks failed with error when fn throws", async () => {
    const { store } = await makeStore();
    const job = await store.create({ type: "implement" });
    await updateJobWithResult(store, job.id, async () => {
      throw new Error("boom");
    });
    const got = await store.get(job.id);
    assert.equal(got.status, "failed");
    assert.equal(got.error, "boom");
  });

  it("runJob still works after refactor (regression)", async () => {
    const { store } = await makeStore();
    const id = await runJob(store, { type: "review" }, async () => ({ ok: true }));
    const got = await store.get(id);
    assert.equal(got.status, "completed");
  });

  it("已取消的 job 不被完成结果覆盖", async () => {
    const { store } = await makeStore();
    const job = await store.create({ type: "review" });
    await store.cancel(job.id);
    await updateJobWithResult(store, job.id, async () => ({ ok: true }));
    const got = await store.get(job.id);
    assert.equal(got.status, "cancelled", "cancelled 是终态，不得被 completed 覆盖");
  });

  it("已取消的 job 不被失败结果覆盖", async () => {
    const { store } = await makeStore();
    const job = await store.create({ type: "review" });
    await store.cancel(job.id);
    await updateJobWithResult(store, job.id, async () => {
      throw new Error("boom");
    });
    const got = await store.get(job.id);
    assert.equal(got.status, "cancelled", "cancelled 是终态，不得被 failed 覆盖");
  });
});

describe("spawnWorker", () => {
  it("spawns a detached node worker with correct args and unref", () => {
    let captured = null;
    let unrefCalled = false;
    const spawn = (cmd, args, opts) => {
      captured = { cmd, args, opts };
      return { unref: () => { unrefCalled = true; }, pid: 123 };
    };
    spawnWorker({ action: "worker-review", jobId: "job-1", model: "glm-5.2", file: "x.js" }, { spawn });
    assert.equal(captured.cmd, process.execPath);
    assert.ok(captured.args.includes("--worker-review"));
    assert.ok(captured.args.includes("--job-id"));
    assert.ok(captured.args.includes("job-1"));
    assert.ok(captured.args.includes("glm-5.2"));
    assert.equal(captured.opts.detached, true);
    assert.equal(captured.opts.stdio, "ignore");
    assert.equal(unrefCalled, true);
  });

  it("opens a log fd when logPath is provided", () => {
    let openCalls = 0;
    const openLog = () => { openCalls += 1; return 7; };
    const closeLog = () => {};
    let captured = null;
    spawnWorker(
      { action: "worker-review", jobId: "j" },
      { spawn: (c, a, o) => { captured = o; return { unref() {}, pid: 1 }; }, logPath: "/tmp/x.log", openLog, closeLog }
    );
    assert.equal(openCalls, 2);
    assert.deepEqual(captured.stdio, ["ignore", 7, 7]);
  });

  it("spawn 后关闭父进程的日志 fd 副本（防泄漏）", () => {
    const closed = [];
    const openLog = () => 7;
    const closeLog = (fd) => closed.push(fd);
    spawnWorker(
      { action: "worker-review", jobId: "j" },
      { spawn: (c, a, o) => ({ unref() {}, pid: 1 }), logPath: "/tmp/x.log", openLog, closeLog }
    );
    assert.deepEqual(closed, [7, 7], "父进程的两个 fd 副本都应在 spawn 后关闭");
  });

  it("passes --ms through for worker-sleep", () => {
    let captured = null;
    spawnWorker(
      { action: "worker-sleep", jobId: "j", ms: 60000 },
      { spawn: (c, a) => { captured = a; return { unref() {}, pid: 1 }; } }
    );
    assert.ok(captured.includes("--worker-sleep"));
    assert.ok(captured.includes("--ms"));
    assert.ok(captured.includes("60000"));
  });

  it("passes --dir and --diff through for worker-audit", () => {
    let captured = null;
    spawnWorker(
      { action: "worker-audit", jobId: "j", dir: "src", diff: true },
      { spawn: (c, a) => { captured = a; return { unref() {}, pid: 1 }; } }
    );
    assert.ok(captured.includes("--dir"));
    assert.ok(captured.includes("src"));
    assert.ok(captured.includes("--diff"));
  });
});

describe("runJobBackground", () => {
  it("creates a running job, spawns worker, records pid, returns id", async () => {
    const { store } = await makeStore();
    let spawned = false;
    const spawn = () => { spawned = true; return { unref() {}, pid: 999 }; };
    const id = await runJobBackground(
      store,
      { type: "review", model: "glm-5.2" },
      { action: "worker-review", file: "x.js" },
      { spawn }
    );
    const job = await store.get(id);
    assert.equal(job.status, "running");
    assert.equal(job.pid, 999);
    assert.equal(spawned, true);
  });

  it("日志打开失败时 job 标记 failed 而非残留 running", async () => {
    const { store } = await makeStore();
    const openLog = () => { throw new Error("cannot open log"); };
    await assert.rejects(
      () => runJobBackground(
        store,
        { type: "review", model: "glm-5.2" },
        { action: "worker-review", file: "x.js" },
        { spawn: () => ({ unref() {}, pid: 1 }), logDir: "/nonexistent", openLog }
      ),
      /cannot open log/
    );
    const jobs = await store.list();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].status, "failed", "日志打开失败不应残留 running 状态");
  });

  it("worker 退出但未写结果时 job 标记 failed（不堵 acquireSlot）", async () => {
    const { store } = await makeStore();
    const child = new EventEmitter();
    child.unref = () => {};
    child.pid = 999;
    const spawn = () => child;
    const id = await runJobBackground(
      store,
      { type: "review", model: "glm-5.2" },
      { action: "worker-review", file: "x.js" },
      { spawn }
    );
    child.emit("exit");
    await new Promise((r) => setTimeout(r, 300));
    const job = await store.get(id);
    assert.equal(job.status, "failed", "worker 崩溃未写结果时应标记 failed 而非残留 running");
  });
});

describe("parseArgs background and worker", () => {
  it("parses --background on run-review", () => {
    assert.equal(parseArgs(["--run-review", "--background", "--model", "glm-5.2"]).background, true);
  });

  it("parses worker-review action with job-id", () => {
    assert.deepEqual(parseArgs(["--worker-review", "--job-id", "job-1", "--model", "glm-5.2"]), {
      action: "worker-review",
      jobId: "job-1",
      model: "glm-5.2",
    });
  });

  it("parses --max-concurrent on run-audit", () => {
    const r = parseArgs(["--run-audit", "--file", "x.js", "--background", "--max-concurrent", "3"]);
    assert.equal(r.maxConcurrent, 3);
  });

  it("--max-concurrent 非数字不产生 NaN", () => {
    const r = parseArgs(["--run-audit", "--file", "x.js", "--background", "--max-concurrent", "abc"]);
    assert.equal(r.maxConcurrent, undefined, "非数字应回退默认而非 NaN");
  });

  it("--ms 非数字不产生 NaN", () => {
    const r = parseArgs(["--worker-sleep", "--job-id", "j1", "--ms", "abc"]);
    assert.equal(r.ms, undefined, "非数字应回退默认而非 NaN");
  });
});

describe("runAudit", () => {
  it("runs only find-bug workers (glm + kimi) and aggregates results", async () => {
    const calls = [];
    const review = async ({ model, backend }) => {
      calls.push({ model, backend });
      return { success: true, severity: "low", issues: [], summary: `ok ${model}` };
    };
    const result = await runAudit({ file: "x.js", review });
    assert.equal(calls.length, 2);
    assert.equal(result.workers.length, 2);
    assert.deepEqual(
      result.workers.map((w) => w.model),
      AUDIT_WORKERS.map((w) => w.model)
    );
  });

  it("diff 模式（复审）用 qwen+kimi，非 diff 找 bug 用 glm+kimi", async () => {
    const calls = [];
    const review = async ({ model, backend }) => {
      calls.push({ model, backend });
      return { success: true, severity: "low", issues: [], summary: `ok ${model}` };
    };
    const result = await runAudit({ diff: true, review, persistAuditLog: false, persistFindingsFn: () => [] });
    assert.equal(calls.length, 2);
    assert.deepEqual(
      result.workers.map((w) => w.model).sort(),
      ["qwen3-coder-plus", "kimi-k2.7-code"].sort()
    );
    assert.deepEqual(
      result.workers.map((w) => w.backend).sort(),
      ["qwen", "kimi"].sort()
    );
  });

  it("verdict 消费已知低风险：result.workers 降级 + verdict clean + 落库保持原始", async () => {
    const review = async ({ model }) => {
      if (model === "qwen3-coder-plus") {
        return { success: true, severity: "medium", issues: [{ file: "scripts/evaluate-models.mjs", line: 1, finding: "lessons not sanitized for prompt injection" }], summary: "x" };
      }
      return { success: true, severity: "low", issues: [], summary: "x" };
    };
    let persistedWorkers = null;
    const result = await runAudit({ diff: true, review, persistAuditLog: false, persistFindingsFn: (workers) => { persistedWorkers = workers; return []; } });
    assert.equal(result.verdict, "clean");
    const qwenResult = result.workers.find((w) => w.model === "qwen3-coder-plus");
    assert.equal(qwenResult.severity, "low", "result.workers 应降级");
    assert.equal(qwenResult.downgraded, true, "result.workers 应带 downgraded 标记");
    const qwenPersisted = persistedWorkers.find((w) => w.model === "qwen3-coder-plus");
    assert.equal(qwenPersisted.severity, "medium", "落库应保持原始 severity");
    assert.ok(!("downgraded" in qwenPersisted), "落库不应带 downgraded 标记");
  });

  it("混报不降：qwen 报真 bug 时 verdict 保持 medium", async () => {
    const review = async ({ model }) => {
      if (model === "qwen3-coder-plus") {
        return {
          success: true, severity: "medium",
          issues: [
            { file: "scripts/evaluate-models.mjs", line: 1, finding: "lessons not sanitized for prompt injection" },
            { file: "a.js", line: 2, finding: "null deref crash" },
          ],
          summary: "x",
        };
      }
      return { success: true, severity: "low", issues: [], summary: "x" };
    };
    const result = await runAudit({ diff: true, review, persistAuditLog: false, persistFindingsFn: () => [] });
    assert.equal(result.verdict, "medium");
  });

  it("captures a failing worker without rejecting", async () => {
    const review = async ({ model }) => {
      if (model === "kimi-k2.7-code") throw new Error("kimi down");
      return { success: true, severity: "low", issues: [], summary: "ok" };
    };
    const result = await runAudit({ file: "x.js", review });
    const kimi = result.workers.find((w) => w.model === "kimi-k2.7-code");
    assert.equal(kimi.success, false);
    assert.ok(kimi.error.includes("kimi down"));
    assert.equal(result.workers.filter((w) => w.success).length, 1);
  });

  it("认证失败 fail-fast：AuthError 上抛不吞成 success:false", async () => {
    const review = async ({ model }) => {
      if (model === "kimi-k2.7-code") throw new AuthError();
      return { success: true, severity: "low", issues: [], summary: "ok" };
    };
    await assert.rejects(
      () => runAudit({ file: "x.js", review, persistAuditLog: false }),
      AuthError
    );
  });

  it("完成后落账：worker 带 chainAnalysis 且 persistFindingsFn 被调", async () => {
    const review = async ({ model }) => ({
      success: true, severity: "low",
      issues: [{ file: "x.js", line: 1, finding: "f", fix: "fx" }],
      summary: "ok", chainAnalysis: "ca",
    });
    let captured = null;
    const result = await runAudit({ file: "x.js", review, persistAuditLog: false, persistFindingsFn: (workers) => { captured = workers; return [{ file: "x.js", line: 1, finding: "f" }]; } });
    assert.ok(captured, "应调用 persistFindingsFn");
    assert.equal(captured.length, 2);
    assert.ok(captured.every((w) => w.chainAnalysis === "ca"), "worker 应带 chainAnalysis");
    assert.equal(result.entries.length, 1, "runAudit 应透传 entries（去重后 findings）");
    assert.equal(result.entries[0].finding, "f");
  });

  it("worker reject null/undefined 时标记失败而非整体崩溃", async () => {
    const review = async ({ model }) => {
      if (model === "kimi-k2.7-code") return Promise.reject(null);
      return { success: true, severity: "low", issues: [], summary: "ok" };
    };
    const result = await runAudit({ file: "x.js", review, persistAuditLog: false });
    const kimi = result.workers.find((w) => w.model === "kimi-k2.7-code");
    assert.equal(kimi.success, false, "null 拒绝不得让整个审计崩溃");
    assert.equal(result.workers.filter((w) => w.success).length, 1);
  });

  it("passes a default 900000ms timeout to review", async () => {
    let captured = null;
    const review = async (opts) => {
      captured = opts.timeout;
      return { success: true, severity: "low", issues: [], summary: "ok" };
    };
    await runAudit({ file: "x.js", review });
    assert.equal(captured, 900000);
  });

  it("passes allowExternal and customPrompt through to review", async () => {
    const captured = [];
    const review = async (opts) => {
      captured.push({ allowExternal: opts.allowExternal, customPrompt: opts.customPrompt });
      return { success: true, severity: "low", issues: [], summary: "ok" };
    };
    await runAudit({ file: "x.js", review, allowExternal: true, customPrompt: "评审NL工件" });
    assert.equal(captured.length, 2);
    for (const c of captured) {
      assert.equal(c.allowExternal, true);
      assert.equal(c.customPrompt, "评审NL工件");
    }
  });

  it("passes per-model feedbackPreamble from getFeedback to review", async () => {
    const captured = {};
    const review = async (opts) => {
      captured[opts.model] = opts.feedbackPreamble;
      return { success: true, severity: "low", issues: [], summary: "ok" };
    };
    const getFeedback = async (model) => (model === "glm-5.2" ? "[你的历史误报]" : "");
    await runAudit({ file: "x.js", review, getFeedback, persistAuditLog: false });
    assert.equal(captured["glm-5.2"], "[你的历史误报]");
    assert.equal(captured["kimi-k2.7-code"], "");
  });

  it("omits feedback when getFeedback is null (default)", async () => {
    const captured = [];
    const review = async (opts) => {
      captured.push(opts.feedbackPreamble ?? null);
      return { success: true, severity: "low", issues: [], summary: "ok" };
    };
    await runAudit({ file: "x.js", review, persistAuditLog: false });
    assert.deepEqual(captured, [null, null]);
  });

  it("透传 projectDir 给 persistFindingsFn", async () => {
    const review = async () => ({ success: true, severity: "low", issues: [], summary: "ok" });
    let captured = null;
    await runAudit({ file: "x.js", review, persistAuditLog: false, projectDir: "/p", persistFindingsFn: (workers, opts) => { captured = opts?.projectDir; return []; } });
    assert.equal(captured, "/p");
  });

  it("不传 projectDir 时透传 process.cwd()", async () => {
    const review = async () => ({ success: true, severity: "low", issues: [], summary: "ok" });
    let captured = "sentinel";
    await runAudit({ file: "x.js", review, persistAuditLog: false, persistFindingsFn: (workers, opts) => { captured = opts?.projectDir; return []; } });
    assert.equal(captured, process.cwd());
  });

  it("无 projectDir 时从 file 的 git 根推导（外部项目不误归）", async () => {
    const review = async () => ({ success: true, severity: "low", issues: [], summary: "ok" });
    let captured = null;
    await runAudit({ file: "/ext/proj/src/x.js", review, persistAuditLog: false, findRoot: () => "/ext/proj", persistFindingsFn: (workers, opts) => { captured = opts?.projectDir; return []; } });
    assert.equal(captured, "/ext/proj");
  });

  it("显式 projectDir 优先于 git 根推导", async () => {
    const review = async () => ({ success: true, severity: "low", issues: [], summary: "ok" });
    let captured = null;
    await runAudit({ file: "/ext/proj/src/x.js", review, persistAuditLog: false, projectDir: "/explicit", findRoot: () => "/ext/proj", persistFindingsFn: (workers, opts) => { captured = opts?.projectDir; return []; } });
    assert.equal(captured, "/explicit");
  });

  it("注入 upsert 时不写真实账本（测试/调用方隔离）", async () => {
    const review = async () => ({ success: true, severity: "low", issues: [{ file: "x.js", line: 1, finding: "f", fix: "fx" }], summary: "ok" });
    let upserted = null;
    const result = await runAudit({ file: "x.js", review, persistAuditLog: false, upsert: async (es) => { upserted = es; } });
    assert.deepEqual((upserted ?? []).map((e) => e.finding), ["f"], "应走注入的 upsert 而非真实账本");
    assert.equal(result.entries.length, 1);
  });
});

describe("cancelJob", () => {
  it("kills the worker pid and marks cancelled", async () => {
    const { store } = await makeStore();
    const job = await store.create({ type: "review" });
    await store.update(job.id, { pid: 555 });
    let killed = null;
    const result = await cancelJob(store, job.id, (pid) => { killed = pid; });
    assert.equal(killed, -555, "应杀进程组（-pid）而非仅 worker 进程");
    assert.equal(result.status, "cancelled");
  });

  it("does not kill when job has no pid", async () => {
    const { store } = await makeStore();
    const job = await store.create({ type: "review" });
    let killed = null;
    const result = await cancelJob(store, job.id, (pid) => { killed = pid; });
    assert.equal(killed, null);
    assert.equal(result.status, "cancelled");
  });

  it("不取消已完成的 job", async () => {
    const { store } = await makeStore();
    const job = await store.create({ type: "review" });
    await store.update(job.id, { status: "completed", finishedAt: "2020-01-01T00:00:00.000Z" });
    const result = await cancelJob(store, job.id, () => {});
    assert.equal(result.status, "completed", "已完成 job 不得被误改为 cancelled");
    assert.equal(result.finishedAt, "2020-01-01T00:00:00.000Z");
  });
});

describe("runAudit persist audit log", () => {
  it("calls appendAudit with workers and target after completion", async () => {
    const review = async () => ({ success: true, severity: "low", issues: [], summary: "ok" });
    let appended = null;
    const appendAudit = async (workers, target) => { appended = { workers, target }; };
    await runAudit({ file: "x.js", review, appendAudit });
    assert.ok(appended, "should call appendAudit");
    assert.equal(appended.workers.length, 2);
    assert.equal(appended.target, "x.js");
  });

  it("skips appendAudit when persistAuditLog is false", async () => {
    const review = async () => ({ success: true, severity: "low", issues: [], summary: "ok" });
    let called = false;
    const appendAudit = async () => { called = true; };
    await runAudit({ file: "x.js", review, appendAudit, persistAuditLog: false });
    assert.equal(called, false);
  });
});

describe("summarizeWorkers", () => {
  it("shows OK with issue count for success", () => {
    const s = summarizeWorkers([
      { model: "glm-5.2", success: true, issues: [{}, {}, {}] },
    ]);
    assert.ok(s.includes("glm-5.2: OK(3)"), s);
  });

  it("shows FAIL with error for failure", () => {
    const s = summarizeWorkers([
      { model: "kimi-k2.7-code", success: false, error: "kimi exited with code 1" },
    ]);
    assert.ok(s.includes("kimi-k2.7-code: FAIL"), s);
    assert.ok(s.includes("exited with code 1"), s);
  });
});

describe("runAudit retries", () => {
  it("passes retries=2 to review workers", async () => {
    let captured = null;
    const review = async (opts) => {
      captured = opts.retries;
      return { success: true, severity: "low", issues: [], summary: "ok" };
    };
    await runAudit({ file: "x.js", review, appendAudit: async () => {}, persistAuditLog: false });
    assert.equal(captured, 2);
  });
});

describe("acquireSlot", () => {
  it("max <= 0 直接放行并返回空 release", async () => {
    const release = await acquireSlot({ max: 0, _state: { count: 0 }, sleep: async () => { throw new Error("不应 sleep"); } });
    assert.equal(typeof release, "function");
    release();
  });

  it("有空位时立即占位并返回 release", async () => {
    const state = { count: 0 };
    const release = await acquireSlot({ max: 2, _state: state, sleep: async () => { throw new Error("不应 sleep"); } });
    assert.equal(state.count, 1, "放行后应立即占位（同步自增）");
    release();
    assert.equal(state.count, 0);
  });

  it("占满后 sleep 轮询，直到释放才放行", async () => {
    const state = { count: 1 };
    let sleepCalls = 0;
    const release = await acquireSlot({ max: 1, _state: state, pollMs: 1, sleep: async () => { sleepCalls += 1; state.count = 0; } });
    assert.equal(sleepCalls, 1);
    assert.equal(state.count, 1, "放行后重新占位");
    release();
  });

  it("release 幂等（重复释放计数不为负）", async () => {
    const state = { count: 0 };
    const release = await acquireSlot({ max: 1, _state: state });
    release();
    release();
    assert.equal(state.count, 0);
  });
});

describe("runJobBackground concurrency", () => {
  it("maxConcurrent 下第一个未释放时第二个等待，exit 后放行", async () => {
    const { store } = await makeStore();
    const child1 = new EventEmitter();
    child1.unref = () => {};
    child1.pid = 999;
    const id1 = await runJobBackground(
      store,
      { type: "review", model: "glm-5.2" },
      { action: "worker-review", file: "x.js" },
      { spawn: () => child1, maxConcurrent: 1 }
    );
    assert.ok(id1);

    let secondSpawned = false;
    const child2 = new EventEmitter();
    child2.unref = () => {};
    child2.pid = 1000;
    const p2 = runJobBackground(
      store,
      { type: "review", model: "glm-5.2" },
      { action: "worker-review", file: "y.js" },
      { spawn: () => { secondSpawned = true; return child2; }, maxConcurrent: 1, pollMs: 1 }
    );

    await new Promise((r) => setTimeout(r, 30));
    assert.equal(secondSpawned, false, "第一个未释放 slot 时，第二个不应启动");

    child1.emit("exit"); // 释放第一个 slot
    const id2 = await p2;
    assert.equal(secondSpawned, true, "释放后第二个应启动");
    assert.ok(id2);
  });
});

describe("buildFindingEntries", () => {
  it("铺平多 worker issues 并去重，models 合并", () => {
    const workers = [
      { model: "glm-5.2", success: true, chainAnalysis: "ca1", issues: [{ file: "a.js", line: 1, finding: "f1", fix: "fix1" }] },
      { model: "kimi-k2.7-code", success: true, chainAnalysis: "ca2", issues: [{ file: "a.js", line: 1, finding: "f1", fix: "fix1" }] },
    ];
    const dedup = (flat) => [{ ...flat[0], cluster: flat }];
    const entries = buildFindingEntries(workers, dedup);
    assert.equal(entries.length, 1);
    assert.deepEqual(entries[0].models.sort(), ["glm-5.2", "kimi-k2.7-code"].sort());
    assert.equal(entries[0].chainAnalysis, "ca1");
    assert.equal(entries[0].source, "audit");
  });

  it("success=false 的 worker 跳过", () => {
    const workers = [
      { model: "glm-5.2", success: false, issues: [{ file: "a.js", line: 1, finding: "f" }] },
      { model: "kimi-k2.7-code", success: true, chainAnalysis: "", issues: [{ file: "b.js", line: 2, finding: "g", fix: "fx" }] },
    ];
    const dedup = (flat) => flat.map((f) => ({ ...f, cluster: [f] }));
    const entries = buildFindingEntries(workers, dedup);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].finding, "g");
  });

  it("空 workers / 全失败 返回空数组", () => {
    const dedup = (x) => x;
    assert.deepEqual(buildFindingEntries([], dedup), []);
    assert.deepEqual(buildFindingEntries([{ model: "glm", success: false, issues: [] }], dedup), []);
  });

  it("persistFindings 落账失败仍返回内存 entries", async () => {
    const workers = [
      { model: "glm-5.2", success: true, chainAnalysis: "ca", issues: [{ file: "a.js", line: 1, finding: "f", fix: "fx" }] },
    ];
    const dedup = (flat) => flat.map((f) => ({ ...f, cluster: [f] }));
    const upsert = async () => { throw new Error("write failed"); };
    const entries = await persistFindings(workers, { dedup, upsert });
    assert.equal(entries.length, 1, "落账失败仍应返回 entries 供下游使用");
    assert.equal(entries[0].finding, "f");
  });

  it("persistFindings 正常落账返回 entries", async () => {
    const workers = [
      { model: "glm-5.2", success: true, issues: [{ file: "a.js", line: 1, finding: "f" }] },
    ];
    const dedup = (flat) => flat.map((f) => ({ ...f, cluster: [f] }));
    let upserted = null;
    const upsert = async (entries) => { upserted = entries; };
    const entries = await persistFindings(workers, { dedup, upsert });
    assert.equal(entries.length, 1);
    assert.equal(upserted.length, 1, "正常路径应调用 upsert");
  });

  it("buildFindingEntries 传 projectDir 时写入每条 entry", () => {
    const workers = [
      { model: "glm-5.2", success: true, issues: [{ file: "a.js", line: 1, finding: "f" }] },
    ];
    const dedup = (flat) => flat.map((f) => ({ ...f, cluster: [f] }));
    const entries = buildFindingEntries(workers, dedup, { projectDir: "/p" });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].projectDir, "/p");
  });

  it("buildFindingEntries 不传 projectDir 时落 process.cwd()（兼容旧行为）", () => {
    const workers = [
      { model: "glm-5.2", success: true, issues: [{ file: "a.js", line: 1, finding: "f" }] },
    ];
    const dedup = (flat) => flat.map((f) => ({ ...f, cluster: [f] }));
    const entries = buildFindingEntries(workers, dedup);
    assert.equal(entries[0].projectDir, process.cwd());
  });

  it("persistFindings 透传 projectDir 到落账 entries", async () => {
    const workers = [
      { model: "glm-5.2", success: true, issues: [{ file: "a.js", line: 1, finding: "f" }] },
    ];
    const dedup = (flat) => flat.map((f) => ({ ...f, cluster: [f] }));
    let upserted = null;
    const upsert = async (entries) => { upserted = entries; };
    await persistFindings(workers, { dedup, upsert, projectDir: "/p" });
    assert.equal(upserted[0].projectDir, "/p");
  });

  it("persistFindings 不传 projectDir 时落 process.cwd()", async () => {
    const workers = [
      { model: "glm-5.2", success: true, issues: [{ file: "a.js", line: 1, finding: "f" }] },
    ];
    const dedup = (flat) => flat.map((f) => ({ ...f, cluster: [f] }));
    let upserted = null;
    const upsert = async (entries) => { upserted = entries; };
    await persistFindings(workers, { dedup, upsert });
    assert.equal(upserted[0].projectDir, process.cwd());
  });

  it("persistFindings 显式传 null 时落 process.cwd()（null 兜底）", async () => {
    const workers = [
      { model: "glm-5.2", success: true, issues: [{ file: "a.js", line: 1, finding: "f" }] },
    ];
    const dedup = (flat) => flat.map((f) => ({ ...f, cluster: [f] }));
    let upserted = null;
    const upsert = async (entries) => { upserted = entries; };
    await persistFindings(workers, { dedup, upsert, projectDir: null });
    assert.equal(upserted[0].projectDir, process.cwd());
  });
});

describe("backgroundHint（后台任务提示语，F1：/status 悬空命令修复）", () => {
  it("正常：含 job id、/jobs、/result <id>", () => {
    const hint = backgroundHint("abc123");
    assert.ok(hint.includes("abc123"), "提示语应含 job id");
    assert.ok(hint.includes("/jobs"), "应指向 /jobs 查状态");
    assert.ok(hint.includes("/result <id>"), "应指向 /result <id> 看结果");
  });

  it("负向：不再引用不存在的 /status 命令", () => {
    assert.ok(!backgroundHint("abc123").includes("/status"), "提示语不得引用不存在的 /status");
  });

  it("边界：空 id 仍返回完整提示（不抛错）", () => {
    const hint = backgroundHint("");
    assert.equal(typeof hint, "string");
    assert.ok(hint.includes("/jobs"));
  });

  it("调用点核查：jobs.mjs 源码无 /status 残留，两处后台分支都走 backgroundHint", () => {
    const src = readFileSync(new URL("./jobs.mjs", import.meta.url), "utf8");
    assert.ok(!src.includes("/status"), "jobs.mjs 不应再有 /status 悬空引用");
    const callSites = src.match(/backgroundHint\(/g) ?? [];
    assert.ok(callSites.length >= 3, "至少 3 处：1 处定义 + run-review/run-audit 两处后台分支调用");
  });
});
