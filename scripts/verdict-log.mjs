import { createHash, randomBytes } from "node:crypto";
import { resolve, dirname, join, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";

export const VERDICT_LOG_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../.cc-suite-cn/verdict-log.json");

export const MISTAKE_TYPES = [
  "trigger-not-reproducible",
  "by-design",
  "param-assembled-elsewhere",
  "path-normalized",
  "re-export-by-design",
  "regex-quantifier-too-narrow",
  "callback-index-pollution",
  "prompt-injection-misattributed",
  "unknown",
];

export function isValidMistakeType(v) {
  return typeof v === "string" && MISTAKE_TYPES.includes(v);
}

export function hashContent(content) {
  return createHash("sha256").update(String(content ?? "")).digest("hex");
}

export function modelsOf(v) {
  if (Array.isArray(v?.models)) return v.models.filter((m) => typeof m === "string" && m !== "");
  if (typeof v?.model === "string" && v.model !== "") return [v.model];
  return [];
}

export function matchesModel(v, model) {
  return modelsOf(v).includes(model);
}

export function isConfirmed(v, final) {
  if (typeof final === "string") return v?.confirmed?.final === final;
  return v?.confirmed?.final === "true" || v?.confirmed?.final === "false";
}

export function verdictKey(v) {
  return JSON.stringify([v.file ?? "", v.line ?? "", v.finding ?? ""]);
}

export function dedupeVerdicts(verdicts) {
  const map = new Map();
  for (let v of verdicts ?? []) {
    const key = verdictKey(v);
    const prev = map.get(key);
    if (prev && prev.fixed && !v.fixed) {
      v = { ...v, fixed: prev.fixed };
    }
    map.set(key, v);
  }
  return [...map.values()];
}

export async function loadVerdicts(filePath = VERDICT_LOG_PATH) {
  let raw;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch (err) {
    if (err && err.code === "ENOENT") return [];
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`corrupted verdict log: ${filePath}`);
  }
  return Array.isArray(parsed) ? parsed : [];
}

let _writeQueue = Promise.resolve();

async function writeVerdictFile(updated, filePath) {
  await mkdir(dirname(filePath), { recursive: true });
  const tmpPath = join(dirname(filePath), `.verdict-${Date.now()}-${randomBytes(4).toString("hex")}.tmp`);
  try {
    await writeFile(tmpPath, JSON.stringify(updated, null, 2) + "\n", "utf-8");
    await rename(tmpPath, filePath);
  } finally {
    try {
      await unlink(tmpPath);
    } catch {}
  }
}

function enqueue(fn) {
  const result = _writeQueue.then(fn, fn);
  _writeQueue = result.then(() => {}, () => {});
  return result;
}

export async function persistVerdicts(verdicts, filePath = VERDICT_LOG_PATH) {
  return enqueue(async () => {
    return withLock(`${filePath}.lock`, async () => {
      const existing = await loadVerdicts(filePath);
      const updated = dedupeVerdicts([...existing, ...(verdicts ?? [])]);
      await writeVerdictFile(updated, filePath);
      return updated;
    });
  });
}

export async function upsertFindings(entries, filePath = VERDICT_LOG_PATH) {
  return enqueue(async () => {
    return withLock(`${filePath}.lock`, async () => {
      const log = await loadVerdicts(filePath);
      const updated = [...log];
      for (const e of entries ?? []) {
        if (!e || typeof e !== "object") continue;
        const key = verdictKey(e);
        const idx = updated.findIndex((v) => verdictKey(v) === key);
        if (idx === -1) {
          updated.push({ ...e });
        } else {
          // fill-missing-only：只补找 bug 阶段字段，绝不覆盖 verdict/evidence/codeHash/confirmed/fixed
          const existing = updated[idx];
          for (const field of ["fix", "chainAnalysis", "source"]) {
            if (!existing[field] && e[field]) existing[field] = e[field];
          }
          if (Array.isArray(e.models)) {
            const merged = new Set([...(Array.isArray(existing.models) ? existing.models : []), ...e.models].filter(Boolean));
            existing.models = [...merged];
          }
        }
      }
      await writeVerdictFile(updated, filePath);
      return updated;
    });
  });
}

export async function appendCritic(entries, filePath = VERDICT_LOG_PATH) {
  return enqueue(async () => {
    return withLock(`${filePath}.lock`, async () => {
      const log = await loadVerdicts(filePath);
      for (const e of entries ?? []) {
        if (!e || typeof e !== "object") continue;
        const key = verdictKey(e);
        const target = log.find((v) => verdictKey(v) === key);
        if (!target) continue;
        target.critic = { agree: e.agree === true, reason: e.reason ?? "" };
      }
      await writeVerdictFile(log, filePath);
      return log;
    });
  });
}

export async function appendVerdicts(verdicts, filePath = VERDICT_LOG_PATH) {
  return enqueue(async () => {
    return withLock(`${filePath}.lock`, async () => {
      const log = await loadVerdicts(filePath);
      for (const v of verdicts ?? []) {
        if (!v || typeof v !== "object") continue;
        const key = verdictKey(v);
        const target = log.find((x) => verdictKey(x) === key);
        if (target) {
          target.verdict = v.verdict;
          target.evidence = v.evidence ?? "";
          if (v.codeHash != null) target.codeHash = v.codeHash;
          if (Array.isArray(v.models) && v.models.length) target.models = v.models;
          if (v.requiresManualVerify != null) target.requiresManualVerify = v.requiresManualVerify;
        } else {
          log.push({ ...v });
        }
      }
      await writeVerdictFile(log, filePath);
      return log;
    });
  });
}

export function getActionableFindings(log, { projectDir = null } = {}) {
  return (log ?? []).filter(
    (v) => v.verdict === "true" && !v.fixed && v.confirmed?.final !== "false" && (projectDir == null || v.projectDir === projectDir)
  );
}

export function getUncertainFindings(log, { projectDir = null } = {}) {
  return (log ?? []).filter(
    (v) => v.verdict !== "true" && v.verdict !== "false" && (projectDir == null || v.projectDir === projectDir)
  );
}

// 修复背景（/verify 注入）：只返回「本轮（auditCommit===headCommit）仍在修」的 actionable finding。
// 关联逻辑（finding→diff）：headCommit 是硬门槛（无法定位 HEAD 就 fail-closed 返回空，不硬凑）；
// changedFiles 是可选精筛。两侧路径都按 projectDir 对称归一（相对 → 绝对），避免任一侧存相对路径时静默漏配。
export function getFixContext(log, { projectDir = null, headCommit = null, changedFiles = null } = {}) {
  if (headCommit == null) return [];
  const norm = (f) => (projectDir && f && !isAbsolute(f) ? resolve(projectDir, f) : f);
  const changed = Array.isArray(changedFiles) ? new Set(changedFiles.map(norm)) : null;
  return getActionableFindings(log, { projectDir }).filter((v) => {
    if (v.auditCommit !== headCommit) return false;
    if (changed && !changed.has(norm(v.file ?? ""))) return false;
    return true;
  });
}

export function isVerdictStale(verdict, currentContent) {
  if (!verdict?.codeHash) return true;
  return hashContent(currentContent) !== verdict.codeHash;
}

export async function markFixed(file, line, finding, { commit, testEvidence, rootCause, fixedAt = new Date().toISOString() }, filePath = VERDICT_LOG_PATH) {
  return enqueue(async () => {
    return withLock(`${filePath}.lock`, async () => {
      const log = await loadVerdicts(filePath);
      const key = verdictKey({ file, line, finding });
      const target = log.find((v) => verdictKey(v) === key);
      if (!target) return null;
      target.fixed = { commit, testEvidence, rootCause, fixedAt };
      await writeVerdictFile(log, filePath);
      return target;
    });
  });
}

export async function confirmVerdict(file, line, finding, { final, reason, independent = null, comparison = "", confirmedAt = new Date().toISOString(), mistakeType = null }, filePath = VERDICT_LOG_PATH) {
  if (final !== "true" && final !== "false") {
    throw new Error(`confirmVerdict final must be "true" or "false", got: ${final}`);
  }
  if (final === "false" && mistakeType != null && !isValidMistakeType(mistakeType)) {
    throw new Error(`mistakeType 非法，应在 [${MISTAKE_TYPES.join("|")}] 中，got: ${JSON.stringify(mistakeType)}`);
  }
  if (typeof reason !== "string" || !reason.trim()) {
    throw new Error("confirmVerdict reason must be a non-empty string (终审依据不能为空)");
  }
  if (!independent || typeof independent !== "object") {
    throw new Error("confirmVerdict independent is required (两步终审：步骤 1 盲判必须落实)");
  }
  if (independent.final !== "true" && independent.final !== "false") {
    throw new Error(`confirmVerdict independent.final must be "true" or "false"`);
  }
  if (typeof independent.reason !== "string" || !independent.reason.trim()) {
    throw new Error("confirmVerdict independent.reason must be a non-empty string");
  }
  if (typeof comparison !== "string" || !comparison.trim()) {
    throw new Error("confirmVerdict comparison must be a non-empty string (步骤 2 对比必须落实)");
  }
  return enqueue(async () => {
    return withLock(`${filePath}.lock`, async () => {
      const log = await loadVerdicts(filePath);
      const key = verdictKey({ file, line, finding });
      const target = log.find((v) => verdictKey(v) === key);
      if (!target) return null;
      target.confirmed = {
        final,
        reason,
        independent: { final: independent.final, reason: independent.reason },
        comparison,
        confirmedAt,
        ...(final === "false" && mistakeType != null ? { mistakeType } : {}),
      };
      await writeVerdictFile(log, filePath);
      return target;
    });
  });
}

export async function getTrace(file, line, finding, filePath = VERDICT_LOG_PATH) {
  const log = await loadVerdicts(filePath);
  const key = verdictKey({ file, line, finding });
  const target = log.find((v) => verdictKey(v) === key);
  if (!target) return null;
  return {
    finding: target.finding ?? "",
    fix: target.fix ?? null,
    chainAnalysis: target.chainAnalysis ?? null,
    models: target.models ?? null,
    source: target.source ?? null,
    critic: target.critic ?? null,
    verdict: target.verdict ?? null,
    evidence: target.evidence ?? null,
    codeHash: target.codeHash ?? null,
    confirmed: target.confirmed ?? null,
    fixed: target.fixed ?? null,
  };
}

function isPidAlive(pid) {
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code !== "ESRCH";
  }
}

async function readLockFile(lockPath) {
  try {
    const raw = await readFile(lockPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
    return { corrupt: true };
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    return { corrupt: true };
  }
}

export async function acquireLock(lockPath, { ttlMs = 10000, retryMs = 50, maxWaitMs = 30000, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), alive = isPidAlive } = {}) {
  const deadline = now() + maxWaitMs;
  for (;;) {
    const existing = await readLockFile(lockPath);
    const stale = existing
      ? (existing.corrupt || !alive(existing.pid) || (typeof existing.expiresAt === "number" && existing.expiresAt < now()))
      : false;
    if (!existing || stale) {
      if (stale) {
        if (existing.corrupt) {
          // corrupt 锁没有有效 pid/expiresAt，直接删（否则会卡到超时）
          try { await unlink(lockPath); } catch {}
        } else {
          // 重读确认仍 stale 才删：缩小"删掉别人刚建的新锁"的 TOCTOU 窗口
          const latest = await readLockFile(lockPath);
          const sameStale = latest && !latest.corrupt && latest.pid === existing.pid && latest.expiresAt === existing.expiresAt;
          if (sameStale) {
            try { await unlink(lockPath); } catch {}
          }
        }
      }
      try {
        await writeFile(lockPath, JSON.stringify({ pid: process.pid, expiresAt: now() + ttlMs }), { flag: "wx" });
        return;
      } catch (err) {
        if (err && err.code === "EEXIST") {
          // 竞争：别的进程刚建锁，重试
        } else {
          throw err;
        }
      }
    }
    if (now() >= deadline) {
      throw new Error("acquireLock timeout: lock held by a live process");
    }
    await sleep(retryMs);
  }
}

export async function releaseLock(lockPath) {
  try {
    const existing = await readLockFile(lockPath);
    if (existing && !existing.corrupt && existing.pid === process.pid) {
      await unlink(lockPath);
    }
  } catch {}
}

async function withLock(lockPath, fn) {
  await acquireLock(lockPath);
  try {
    return await fn();
  } finally {
    await releaseLock(lockPath);
  }
}
