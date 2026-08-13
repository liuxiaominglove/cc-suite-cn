import { createJobStore, runJobBackground, cancelJob, DEFAULT_JOBS_DIR } from "../jobs.mjs";

let pass = 0;
let fail = 0;
const check = (name, cond) => {
  if (cond) {
    console.log(`PASS ${name}`);
    pass += 1;
  } else {
    console.log(`FAIL ${name}`);
    fail += 1;
  }
};

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function pollStatus(store, id, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const job = await store.get(id);
    if (!job || job.status !== "running") return job;
    await new Promise((r) => setTimeout(r, 250));
  }
  return store.get(id);
}

const store = createJobStore({ dir: DEFAULT_JOBS_DIR });

// Part A: 真后台 detach + pid 记录 + 日志 + 完成
const idA = await runJobBackground(
  store,
  { type: "sleep" },
  { action: "worker-sleep", ms: 2000 },
  { logDir: DEFAULT_JOBS_DIR }
);
const jobA = await store.get(idA);
check("background job created with running status", jobA && jobA.status === "running");
check("background job records pid", jobA && jobA.pid != null);

let logExists = true;
try {
  await import("node:fs/promises").then((m) => m.access(`${DEFAULT_JOBS_DIR}/${idA}.log`));
} catch {
  logExists = false;
}
check("worker log file created", logExists);

const doneA = await pollStatus(store, idA, 15000);
check("background worker completes", doneA && doneA.status === "completed");

// Part B: cancel 真 kill
const idB = await runJobBackground(
  store,
  { type: "sleep" },
  { action: "worker-sleep", ms: 60000 },
  { logDir: DEFAULT_JOBS_DIR }
);
const jobB = await store.get(idB);
const pidB = jobB.pid;

const cancelled = await cancelJob(store, idB);
check("cancel marks job cancelled", cancelled && cancelled.status === "cancelled");

await new Promise((r) => setTimeout(r, 800));
check("cancel really kills the worker process", !isAlive(pidB));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
