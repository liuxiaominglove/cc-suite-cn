import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJobStore, runJob, parseArgs, defaultStore, buildMeta, DEFAULT_JOBS_DIR, updateJobWithResult, spawnWorker, runJobBackground, cancelJob } from "./jobs.mjs";

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

  it("parses --run-implement with model and task", () => {
    assert.deepEqual(parseArgs(["--run-implement", "--model", "glm-5.2", "--task", "做X"]), {
      action: "run-implement",
      model: "glm-5.2",
      task: "做X",
    });
  });

  it("returns help on empty args", () => {
    assert.deepEqual(parseArgs([]), { action: "help" });
  });

  it("returns help on unknown flag", () => {
    assert.deepEqual(parseArgs(["--wat"]), { action: "help" });
  });
});

describe("defaultStore", () => {
  it("points at the default jobs dir", () => {
    assert.equal(DEFAULT_JOBS_DIR, ".cc-suite-pe/jobs");
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

  it("builds implement meta from run-implement", () => {
    assert.deepEqual(buildMeta({ action: "run-implement", model: "glm-5.2", task: "做X" }), {
      type: "implement",
      model: "glm-5.2",
      task: "做X",
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
    assert.equal(captured.cmd, "node");
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
    let captured = null;
    spawnWorker(
      { action: "worker-review", jobId: "j" },
      { spawn: (c, a, o) => { captured = o; return { unref() {}, pid: 1 }; }, logPath: "/tmp/x.log", openLog }
    );
    assert.equal(openCalls, 2);
    assert.deepEqual(captured.stdio, ["ignore", 7, 7]);
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
});

describe("cancelJob", () => {
  it("kills the worker pid and marks cancelled", async () => {
    const { store } = await makeStore();
    const job = await store.create({ type: "review" });
    await store.update(job.id, { pid: 555 });
    let killed = null;
    const result = await cancelJob(store, job.id, (pid) => { killed = pid; });
    assert.equal(killed, 555);
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
});
