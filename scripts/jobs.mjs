import { mkdir, readFile, writeFile, readdir, rename, unlink } from "node:fs/promises";
import { openSync, closeSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawn as nodeSpawn } from "node:child_process";
import { FIND_BUG_WORKERS } from "./models.mjs";
import { isMainModule } from "./runner-core.mjs";

const JOBS_SCRIPT = fileURLToPath(import.meta.url);

function makeId() {
  return `job-${Date.now()}-${randomBytes(4).toString("hex")}`;
}

export function isValidJobId(id) {
  return typeof id === "string" && /^job-\d+-[a-f0-9]+$/.test(id);
}

export function createJobStore({ dir }) {
  function jobFile(id) {
    if (!isValidJobId(id)) throw new Error(`invalid job id: ${id}`);
    return join(dir, `${id}.json`);
  }

  async function ensureDir() {
    await mkdir(dir, { recursive: true });
  }

  async function get(id) {
    if (!isValidJobId(id)) return null;
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
    const file = jobFile(id);
    const tmp = `${file}.${Date.now()}-${randomBytes(3).toString("hex")}.tmp`;
    await writeFile(tmp, JSON.stringify(updated, null, 2));
    try {
      await rename(tmp, file);
    } catch (err) {
      await unlink(tmp).catch(() => {});
      throw err;
    }
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
    const current = await store.get(id);
    if (current && current.status === "running") {
      await store.update(id, { status: "completed", finishedAt: new Date().toISOString(), result });
    }
  } catch (err) {
    const current = await store.get(id);
    if (current && current.status === "running") {
      await store.update(id, { status: "failed", finishedAt: new Date().toISOString(), error: err?.message ?? String(err) });
    }
  }
}

export async function runJob(store, meta, fn) {
  const job = await store.create(meta);
  await updateJobWithResult(store, job.id, fn);
  return job.id;
}

export function spawnWorker(spec, { spawn = nodeSpawn, logPath = null, openLog = openSync, closeLog = closeSync } = {}) {
  const args = [JOBS_SCRIPT, `--${spec.action}`, "--job-id", spec.jobId];
  for (const [flag, val] of [
    ["--model", spec.model],
    ["--file", spec.file],
    ["--backend", spec.backend],
    ["--dir", spec.dir],
    ["--exts", spec.exts],
    ["--ms", spec.ms],
    ["--prompt", spec.prompt],
  ]) {
    if (val) args.push(flag, String(val));
  }
  if (spec.diff) args.push("--diff");
  if (spec.allowExternal) args.push("--allow-external");
  if (logPath) {
    const fd1 = openLog(logPath, "a");
    const fd2 = openLog(logPath, "a");
    try {
      const child = spawn(process.execPath, args, { detached: true, stdio: ["ignore", fd1, fd2] });
      child.unref();
      return child;
    } finally {
      try { closeLog(fd1); } catch {}
      try { closeLog(fd2); } catch {}
    }
  }
  const child = spawn(process.execPath, args, { detached: true, stdio: "ignore" });
  child.unref();
  return child;
}

// 进程内并发信号量：acquireSlot 的「检查 + 占位」在同一同步块内完成（单线程 JS 无 await 插入），
// 消除旧实现「检查（读文件系统）→ 创建 job」之间的 TOCTOU 窗口。
const slotState = { count: 0 };

export function __resetSlotsForTest() {
  slotState.count = 0;
}

export async function acquireSlot({ max, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), pollMs = 500, _state = slotState } = {}) {
  if (!max || max <= 0) return () => {};
  while (_state.count >= max) {
    await sleep(pollMs);
  }
  _state.count += 1;
  let released = false;
  return () => {
    if (!released) {
      released = true;
      _state.count -= 1;
    }
  };
}

export async function runJobBackground(store, meta, workerSpec, { spawn = nodeSpawn, logDir = null, openLog = openSync, maxConcurrent = 0, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), pollMs = 500 } = {}) {
  const release = await acquireSlot({ max: maxConcurrent, sleep, pollMs });
  const job = await store.create(meta);
  const logPath = logDir ? join(logDir, `${job.id}.log`) : null;
  let child;
  try {
    child = spawnWorker({ ...workerSpec, jobId: job.id }, { spawn, logPath, openLog });
  } catch (err) {
    release();
    await store.update(job.id, { status: "failed", finishedAt: new Date().toISOString(), error: err?.message ?? String(err) });
    throw err;
  }
  await store.update(job.id, { pid: child.pid });
  if (typeof child.on === "function") {
    child.on("exit", () => {
      release();
      setTimeout(() => {
        (async () => {
          try {
            const current = await store.get(job.id);
            if (current && current.status === "running") {
              await store.update(job.id, { status: "failed", finishedAt: new Date().toISOString(), error: "worker exited without writing result" });
            }
          } catch {
            // 目录可能已被清理，忽略
          }
        })();
      }, 200);
    });
  }
  return job.id;
}

export async function cancelJob(store, id, kill = (pid) => process.kill(pid, "SIGTERM")) {
  const job = await store.get(id);
  if (!job) return null;
  if (job.status !== "running") return job;
  if (job.pid != null) {
    try {
      kill(-job.pid);
    } catch {}
  }
  return store.cancel(id);
}

export const DEFAULT_JOBS_DIR = ".cc-suite-cn/jobs";

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
      const maxConcurrent = flag("max-concurrent");
      const prompt = flag("prompt");
      if (model) r.model = model;
      if (file) r.file = file;
      if (backend) r.backend = backend;
      if (maxConcurrent) {
        const n = parseInt(maxConcurrent, 10);
        if (Number.isFinite(n) && n > 0) r.maxConcurrent = n;
      }
      if (prompt) r.prompt = prompt;
      if (rest.includes("--allow-external")) r.allowExternal = true;
      if (hasBackground) r.background = true;
      return r;
    }
    case "--run-audit": {
      const r = { action: "run-audit" };
      const file = flag("file");
      const dir = flag("dir");
      const exts = flag("exts");
      const maxConcurrent = flag("max-concurrent");
      const prompt = flag("prompt");
      if (file) r.file = file;
      if (dir) r.dir = dir;
      if (exts) r.exts = exts.split(",").map((e) => e.trim());
      if (maxConcurrent) {
        const n = parseInt(maxConcurrent, 10);
        if (Number.isFinite(n) && n > 0) r.maxConcurrent = n;
      }
      if (prompt) r.prompt = prompt;
      if (rest.includes("--diff")) r.diff = true;
      if (rest.includes("--allow-external")) r.allowExternal = true;
      if (hasBackground) r.background = true;
      return r;
    }
    case "--worker-audit": {
      const r = { action: "worker-audit" };
      const jobId = flag("job-id");
      const file = flag("file");
      const dir = flag("dir");
      const exts = flag("exts");
      const prompt = flag("prompt");
      if (jobId) r.jobId = jobId;
      if (file) r.file = file;
      if (dir) r.dir = dir;
      if (exts) r.exts = exts.split(",").map((e) => e.trim());
      if (prompt) r.prompt = prompt;
      if (rest.includes("--diff")) r.diff = true;
      if (rest.includes("--allow-external")) r.allowExternal = true;
      return r;
    }
    case "--worker-review": {
      const r = { action: "worker-review" };
      const jobId = flag("job-id");
      const model = flag("model");
      const file = flag("file");
      const backend = flag("backend");
      const prompt = flag("prompt");
      if (jobId) r.jobId = jobId;
      if (model) r.model = model;
      if (file) r.file = file;
      if (backend) r.backend = backend;
      if (prompt) r.prompt = prompt;
      if (rest.includes("--allow-external")) r.allowExternal = true;
      return r;
    }
    case "--worker-sleep": {
      const r = { action: "worker-sleep" };
      const jobId = flag("job-id");
      const ms = flag("ms");
      if (jobId) r.jobId = jobId;
      if (ms) {
        const n = parseInt(ms, 10);
        if (Number.isFinite(n) && n >= 0) r.ms = n;
      }
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

export async function runAudit({ file, dir, exts, diff = false, review, timeout = 900000, persistAuditLog = true, appendAudit = null, retries = 2, allowExternal = false, customPrompt = null, getFeedback = null, persistFindingsFn = null }) {
  if (!review) {
    ({ review } = await import("./review-runner.mjs"));
  }
  const { reviewFile } = await import("./review-runner.mjs");
  const useChunking = !!(file && !dir && !diff);
  const workers = await Promise.all(
    AUDIT_WORKERS.map(async ({ backend, model }) => {
      try {
        const feedbackPreamble = getFeedback ? await getFeedback(model, file) : null;
        const r = useChunking
          ? await reviewFile({ model, backend, file, timeout, reviewFn: review, retries, allowExternal, customPrompt, feedbackPreamble })
          : await review({ model, backend, file, dir, exts, diff, timeout, retries, allowExternal, customPrompt, feedbackPreamble });
        return { backend, model, success: r.success, severity: r.severity, issues: r.issues, summary: r.summary, chainAnalysis: r.chainAnalysis ?? "" };
      } catch (err) {
        return { backend, model, success: false, error: err?.message ?? String(err) };
      }
    })
  );

  if (persistAuditLog) {
    try {
      const append = appendAudit ?? defaultAppendAudit;
      await append(workers, file ?? dir ?? "diff");
    } catch (e) {
      // persist failure must not break the audit
    }
  }

  let entries = [];
  if (persistFindingsFn) {
    try { entries = await persistFindingsFn(workers) ?? []; } catch {}
  } else {
    entries = await persistFindings(workers);
  }

  return { workers, entries };
}

export function buildFindingEntries(workers, dedupFn, { projectDir = process.cwd() } = {}) {
  const flat = [];
  for (const w of workers ?? []) {
    if (!w || w.success === false) continue;
    for (const issue of w.issues ?? []) {
      flat.push({
        file: issue.file ?? "",
        line: issue.line ?? null,
        finding: issue.finding ?? "",
        fix: issue.fix ?? "",
        chainAnalysis: w.chainAnalysis ?? "",
        model: w.model,
      });
    }
  }
  if (flat.length === 0) return [];
  const clusters = dedupFn(flat);
  return clusters.map((c) => {
    const members = c.cluster ?? [c];
    return {
      file: c.file ?? "",
      line: c.line ?? null,
      finding: c.finding ?? "",
      fix: c.fix ?? "",
      chainAnalysis: c.chainAnalysis ?? "",
      models: [...new Set(members.map((m) => m.model).filter(Boolean))],
      source: "audit",
      projectDir,
    };
  });
}

export async function persistFindings(workers, { dedup = null, upsert = null } = {}) {
  let entries;
  try {
    const dedupFn = dedup ?? (await import("./evaluate-models.mjs")).dedupFindings;
    entries = buildFindingEntries(workers, dedupFn);
  } catch {
    return [];
  }
  if (entries.length === 0) return [];
  try {
    const upsertFn = upsert ?? (await import("./verdict-log.mjs")).upsertFindings;
    await upsertFn(entries);
  } catch {
    // 落账失败不阻断审计，但保留内存 entries 供下游（批判）使用
  }
  return entries;
}

export function summarizeWorkers(workers) {
  return (workers ?? [])
    .map((w) => {
      const status = w.success
        ? `OK(${w.issues?.length ?? 0})`
        : `FAIL(${w.error ?? "unknown error"})`;
      return `${w.model}: ${status}`;
    })
    .join(" | ");
}

async function defaultAppendAudit(workers, target) {
  const { fromReviewResult, persistAuditEntries, AUDIT_LOG_PATH } = await import("../.opencode/skills/cc-review/audit-logger.mjs");
  const entries = workers
    .filter((w) => w.success)
    .map((w) => fromReviewResult(w, target));
  if (entries.length === 0) return;
  await persistAuditEntries(entries, AUDIT_LOG_PATH);
}

if (isMainModule(import.meta.url)) {
  const parsed = parseArgs(process.argv.slice(2));
  const store = defaultStore();

  async function resolveFeedback() {
    try {
      const { createFeedbackResolver } = await import("./feedback.mjs");
      return await createFeedbackResolver();
    } catch {
      return null;
    }
  }

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
      const id = await runJobBackground(store, meta, { action: "worker-review", model: parsed.model, file: parsed.file, backend: parsed.backend, prompt: parsed.prompt, allowExternal: parsed.allowExternal }, { logDir: DEFAULT_JOBS_DIR, maxConcurrent: parsed.maxConcurrent ?? 4 });
      console.log(`${id}  [running]  (后台运行，用 /status 查、/result <id> 看结果)`);
    } else {
      const { review } = await import("./review-runner.mjs");
      const id = await runJob(store, meta, () => review({ model: parsed.model, file: parsed.file, backend: parsed.backend || "codebuddy", allowExternal: parsed.allowExternal, customPrompt: parsed.prompt }));
      const job = await store.get(id);
      console.log(`${id}  [${job.status}]`);
    }
  } else if (parsed.action === "run-audit") {
    const meta = buildMeta(parsed);
    if (parsed.background) {
      const id = await runJobBackground(store, meta, { action: "worker-audit", file: parsed.file, dir: parsed.dir, exts: parsed.exts, diff: parsed.diff, prompt: parsed.prompt, allowExternal: parsed.allowExternal }, { logDir: DEFAULT_JOBS_DIR, maxConcurrent: parsed.maxConcurrent ?? 4 });
      console.log(`${id}  [running]  (后台运行，用 /status 查、/result <id> 看结果)`);
    } else {
      const getFeedback = await resolveFeedback();
      const id = await runJob(store, meta, () => runAudit({ file: parsed.file, dir: parsed.dir, exts: parsed.exts, diff: parsed.diff, allowExternal: parsed.allowExternal, customPrompt: parsed.prompt, getFeedback }));
      const job = await store.get(id);
      const summary = job?.result?.workers ? `  ${summarizeWorkers(job.result.workers)}` : "";
      console.log(`${id}  [${job.status}]${summary}`);
    }
  } else if (parsed.action === "worker-review") {
    if (!parsed.jobId) {
      console.error("--job-id is required for worker-review");
      process.exit(1);
    }
    const { review } = await import("./review-runner.mjs");
    await updateJobWithResult(store, parsed.jobId, () => review({ model: parsed.model, file: parsed.file, backend: parsed.backend || "codebuddy", allowExternal: parsed.allowExternal, customPrompt: parsed.prompt }));
  } else if (parsed.action === "worker-audit") {
    if (!parsed.jobId) {
      console.error("--job-id is required for worker-audit");
      process.exit(1);
    }
    const getFeedback = await resolveFeedback();
    await updateJobWithResult(store, parsed.jobId, () => runAudit({ file: parsed.file, dir: parsed.dir, exts: parsed.exts, diff: parsed.diff, allowExternal: parsed.allowExternal, customPrompt: parsed.prompt, getFeedback }));
  } else if (parsed.action === "worker-sleep") {
    if (!parsed.jobId) {
      console.error("--job-id is required for worker-sleep");
      process.exit(1);
    }
    await updateJobWithResult(store, parsed.jobId, () => new Promise((resolve) => setTimeout(resolve, parsed.ms ?? 1000)));
  } else {
    console.log("Usage: node jobs.mjs --list | --get <id> | --cancel <id> | --run-review --model <m> --file <f> [--background] | --run-audit --file <f>|--dir <d> [--background]");
  }
}
