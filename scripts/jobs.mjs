import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { openSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawn as nodeSpawn } from "node:child_process";
import { FIND_BUG_WORKERS } from "./models.mjs";

const JOBS_SCRIPT = fileURLToPath(import.meta.url);

function makeId() {
  return `job-${Date.now()}-${randomBytes(4).toString("hex")}`;
}

export function createJobStore({ dir }) {
  function jobFile(id) {
    return join(dir, `${id}.json`);
  }

  async function ensureDir() {
    await mkdir(dir, { recursive: true });
  }

  async function get(id) {
    try {
      const raw = await readFile(jobFile(id), "utf-8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async function create(meta) {
    await ensureDir();
    const job = {
      id: makeId(),
      ...meta,
      status: "running",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      result: null,
      error: null,
    };
    await writeFile(jobFile(job.id), JSON.stringify(job, null, 2));
    return job;
  }

  async function update(id, patch) {
    const job = await get(id);
    if (!job) return null;
    const updated = { ...job, ...patch };
    await writeFile(jobFile(id), JSON.stringify(updated, null, 2));
    return updated;
  }

  async function list() {
    await ensureDir();
    const files = await readdir(dir);
    const jobs = [];
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const raw = await readFile(join(dir, f), "utf-8");
        jobs.push(JSON.parse(raw));
      } catch {}
    }
    return jobs.sort((a, b) => (b.startedAt || "").localeCompare(a.startedAt || ""));
  }

  async function cancel(id) {
    return update(id, { status: "cancelled", finishedAt: new Date().toISOString() });
  }

  return { create, get, update, list, cancel };
}

export async function updateJobWithResult(store, id, fn) {
  try {
    const result = await fn();
    await store.update(id, { status: "completed", finishedAt: new Date().toISOString(), result });
  } catch (err) {
    await store.update(id, { status: "failed", finishedAt: new Date().toISOString(), error: err.message });
  }
}

export async function runJob(store, meta, fn) {
  const job = await store.create(meta);
  await updateJobWithResult(store, job.id, fn);
  return job.id;
}

export function spawnWorker(spec, { spawn = nodeSpawn, logPath = null, openLog = openSync } = {}) {
  const args = [JOBS_SCRIPT, `--${spec.action}`, "--job-id", spec.jobId];
  for (const [flag, val] of [
    ["--model", spec.model],
    ["--file", spec.file],
    ["--backend", spec.backend],
    ["--dir", spec.dir],
    ["--exts", spec.exts],
    ["--ms", spec.ms],
  ]) {
    if (val) args.push(flag, String(val));
  }
  if (spec.diff) args.push("--diff");
  const stdio = logPath ? ["ignore", openLog(logPath, "a"), openLog(logPath, "a")] : "ignore";
  const child = spawn("node", args, { detached: true, stdio });
  child.unref();
  return child;
}

export async function runJobBackground(store, meta, workerSpec, { spawn = nodeSpawn, logDir = null, openLog = openSync } = {}) {
  const job = await store.create(meta);
  const logPath = logDir ? join(logDir, `${job.id}.log`) : null;
  const child = spawnWorker({ ...workerSpec, jobId: job.id }, { spawn, logPath, openLog });
  await store.update(job.id, { pid: child.pid });
  return job.id;
}

export async function cancelJob(store, id, kill = (pid) => process.kill(pid, "SIGTERM")) {
  const job = await store.get(id);
  if (!job) return null;
  if (job.status === "running" && job.pid != null) {
    try {
      kill(job.pid);
    } catch {}
  }
  return store.cancel(id);
}

export const DEFAULT_JOBS_DIR = ".cc-suite-pe/jobs";

export function defaultStore() {
  return createJobStore({ dir: DEFAULT_JOBS_DIR });
}

export function parseArgs(args) {
  if (!args || args.length === 0) return { action: "help" };
  const action = args[0];
  const rest = args.slice(1);
  const flag = (name) => {
    const i = rest.indexOf(`--${name}`);
    return i !== -1 ? rest[i + 1] : undefined;
  };
  const hasBackground = rest.includes("--background");
  switch (action) {
    case "--list":
      return { action: "list" };
    case "--get":
      return { action: "get", id: rest[0] };
    case "--cancel":
      return { action: "cancel", id: rest[0] };
    case "--run-review": {
      const r = { action: "run-review" };
      const model = flag("model");
      const file = flag("file");
      const backend = flag("backend");
      if (model) r.model = model;
      if (file) r.file = file;
      if (backend) r.backend = backend;
      if (hasBackground) r.background = true;
      return r;
    }
    case "--run-audit": {
      const r = { action: "run-audit" };
      const file = flag("file");
      const dir = flag("dir");
      const exts = flag("exts");
      if (file) r.file = file;
      if (dir) r.dir = dir;
      if (exts) r.exts = exts.split(",").map((e) => e.trim());
      if (rest.includes("--diff")) r.diff = true;
      if (hasBackground) r.background = true;
      return r;
    }
    case "--worker-audit": {
      const r = { action: "worker-audit" };
      const jobId = flag("job-id");
      const file = flag("file");
      const dir = flag("dir");
      const exts = flag("exts");
      if (jobId) r.jobId = jobId;
      if (file) r.file = file;
      if (dir) r.dir = dir;
      if (exts) r.exts = exts.split(",").map((e) => e.trim());
      if (rest.includes("--diff")) r.diff = true;
      return r;
    }
    case "--worker-review": {
      const r = { action: "worker-review" };
      const jobId = flag("job-id");
      const model = flag("model");
      const file = flag("file");
      const backend = flag("backend");
      if (jobId) r.jobId = jobId;
      if (model) r.model = model;
      if (file) r.file = file;
      if (backend) r.backend = backend;
      return r;
    }
    case "--worker-sleep": {
      const r = { action: "worker-sleep" };
      const jobId = flag("job-id");
      const ms = flag("ms");
      if (jobId) r.jobId = jobId;
      if (ms) r.ms = parseInt(ms, 10);
      return r;
    }
    default:
      return { action: "help" };
  }
}

export function buildMeta(parsed) {
  if (parsed.action === "run-review") {
    return { type: "review", model: parsed.model, task: parsed.file };
  }
  if (parsed.action === "run-audit") {
    return { type: "audit", task: parsed.file ?? parsed.dir };
  }
  return null;
}

export const AUDIT_WORKERS = FIND_BUG_WORKERS;

export async function runAudit({ file, dir, exts, diff = false, review, timeout = 900000 }) {
  if (!review) {
    ({ review } = await import("./review-runner.mjs"));
  }
  const workers = await Promise.all(
    AUDIT_WORKERS.map(async ({ backend, model }) => {
      try {
        const r = await review({ model, backend, file, dir, exts, diff, timeout });
        return { backend, model, success: r.success, severity: r.severity, issues: r.issues, summary: r.summary };
      } catch (err) {
        return { backend, model, success: false, error: err.message };
      }
    })
  );
  return { workers };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const parsed = parseArgs(process.argv.slice(2));
  const store = defaultStore();

  if (parsed.action === "list") {
    const jobs = await store.list();
    if (jobs.length === 0) {
      console.log("(无任务)");
    } else {
      for (const j of jobs) {
        console.log(`${j.id}  [${j.status}]  ${j.type || ""}  ${j.model || ""}  ${j.task || ""}`);
      }
    }
  } else if (parsed.action === "get") {
    const job = await store.get(parsed.id);
    console.log(job ? JSON.stringify(job, null, 2) : `(未找到 ${parsed.id})`);
  } else if (parsed.action === "cancel") {
    const job = await cancelJob(store, parsed.id);
    console.log(job ? `已取消 ${job.id}` : `(未找到 ${parsed.id})`);
  } else if (parsed.action === "run-review") {
    const meta = buildMeta(parsed);
    if (parsed.background) {
      const id = await runJobBackground(store, meta, { action: "worker-review", model: parsed.model, file: parsed.file, backend: parsed.backend }, { logDir: DEFAULT_JOBS_DIR });
      console.log(`${id}  [running]  (后台运行，用 /status 查、/result <id> 看结果)`);
    } else {
      const { review } = await import("./review-runner.mjs");
      const id = await runJob(store, meta, () => review({ model: parsed.model, file: parsed.file, backend: parsed.backend || "codebuddy" }));
      const job = await store.get(id);
      console.log(`${id}  [${job.status}]`);
    }
  } else if (parsed.action === "run-audit") {
    const meta = buildMeta(parsed);
    if (parsed.background) {
      const id = await runJobBackground(store, meta, { action: "worker-audit", file: parsed.file, dir: parsed.dir, exts: parsed.exts, diff: parsed.diff }, { logDir: DEFAULT_JOBS_DIR });
      console.log(`${id}  [running]  (后台运行，用 /status 查、/result <id> 看结果)`);
    } else {
      const id = await runJob(store, meta, () => runAudit({ file: parsed.file, dir: parsed.dir, exts: parsed.exts, diff: parsed.diff }));
      const job = await store.get(id);
      console.log(`${id}  [${job.status}]`);
    }
  } else if (parsed.action === "worker-review") {
    const { review } = await import("./review-runner.mjs");
    await updateJobWithResult(store, parsed.jobId, () => review({ model: parsed.model, file: parsed.file, backend: parsed.backend || "codebuddy" }));
  } else if (parsed.action === "worker-audit") {
    await updateJobWithResult(store, parsed.jobId, () => runAudit({ file: parsed.file, dir: parsed.dir, exts: parsed.exts, diff: parsed.diff }));
  } else if (parsed.action === "worker-sleep") {
    await updateJobWithResult(store, parsed.jobId, () => new Promise((resolve) => setTimeout(resolve, parsed.ms ?? 1000)));
  } else {
    console.log("Usage: node jobs.mjs --list | --get <id> | --cancel <id> | --run-review --model <m> --file <f> [--background] | --run-audit --file <f>|--dir <d> [--background]");
  }
}
