import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

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

export async function runJob(store, meta, fn) {
  const job = await store.create(meta);
  try {
    const result = await fn();
    await store.update(job.id, { status: "completed", finishedAt: new Date().toISOString(), result });
  } catch (err) {
    await store.update(job.id, { status: "failed", finishedAt: new Date().toISOString(), error: err.message });
  }
  return job.id;
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
  switch (action) {
    case "--list":
      return { action: "list" };
    case "--get":
      return { action: "get", id: rest[0] };
    case "--cancel":
      return { action: "cancel", id: rest[0] };
    case "--run-review":
      return { action: "run-review", model: flag("model"), file: flag("file") };
    case "--run-implement":
      return { action: "run-implement", model: flag("model"), task: flag("task") };
    default:
      return { action: "help" };
  }
}

export function buildMeta(parsed) {
  if (parsed.action === "run-review") {
    return { type: "review", model: parsed.model, task: parsed.file };
  }
  if (parsed.action === "run-implement") {
    return { type: "implement", model: parsed.model, task: parsed.task };
  }
  return null;
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
    const job = await store.cancel(parsed.id);
    console.log(job ? `已取消 ${job.id}` : `(未找到 ${parsed.id})`);
  } else if (parsed.action === "run-review") {
    const { review } = await import("./review-runner.mjs");
    const id = await runJob(store, buildMeta(parsed), () => review({ model: parsed.model, file: parsed.file, backend: parsed.backend || "codebuddy" }));
    const job = await store.get(id);
    console.log(`${id}  [${job.status}]`);
  } else if (parsed.action === "run-implement") {
    const { implement } = await import("./implement-runner.mjs");
    const id = await runJob(store, buildMeta(parsed), () => implement({ model: parsed.model, task: parsed.task }));
    const job = await store.get(id);
    console.log(`${id}  [${job.status}]`);
  } else {
    console.log("Usage: node jobs.mjs --list | --get <id> | --cancel <id> | --run-review --model <m> --file <f> | --run-implement --model <m> --task <t>");
  }
}
