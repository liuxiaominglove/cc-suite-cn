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
