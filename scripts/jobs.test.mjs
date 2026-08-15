import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJobStore, runJob, parseArgs, defaultStore, buildMeta, DEFAULT_JOBS_DIR, updateJobWithResult, spawnWorker, runJobBackground, cancelJob, runAudit, summarizeWorkers, acquireSlot, AUDIT_WORKERS, isValidJobId } from "./jobs.mjs";

const cleanups = [];
afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop();
    await fn();
  }
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
  it("returns immediately when running < max", async () => {
    let sleepCalls = 0;
    await acquireSlot({ max: 4, getRunningCount: async () => 2, sleep: async () => { sleepCalls += 1; } });
    assert.equal(sleepCalls, 0);
  });

  it("polls until a slot frees", async () => {
    let running = 4;
    let sleepCalls = 0;
    await acquireSlot({ max: 4, getRunningCount: async () => running, sleep: async () => { sleepCalls += 1; running = 3; } });
    assert.equal(sleepCalls, 1);
  });

  it("skips gating when max <= 0", async () => {
    let getCalls = 0;
    await acquireSlot({ max: 0, getRunningCount: async () => { getCalls += 1; return 99; }, sleep: async () => {} });
    assert.equal(getCalls, 0);
  });
});

describe("runJobBackground concurrency", () => {
  it("waits for a slot when maxConcurrent is reached", async () => {
    const { store } = await makeStore();
    const blocker = await store.create({ type: "audit", task: "blocker.js" });
    let spawned = false;
    const spawn = () => { spawned = true; return { unref() {}, pid: 999 }; };
    let slept = 0;
    const sleep = async () => { slept += 1; await store.update(blocker.id, { status: "completed" }); };
    await runJobBackground(
      store,
      { type: "review", model: "glm-5.2" },
      { action: "worker-review", file: "x.js" },
      { spawn, maxConcurrent: 1, sleep, pollMs: 1 }
    );
    assert.equal(slept, 1, "should wait once until the blocker completes");
    assert.equal(spawned, true);
  });
});
