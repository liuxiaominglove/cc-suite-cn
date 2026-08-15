import { createHash, randomBytes } from "node:crypto";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";

export const VERDICT_LOG_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../.cc-suite-pe/verdict-log.json");

export function hashContent(content) {
  return createHash("sha256").update(String(content ?? "")).digest("hex");
}

export function verdictKey(v) {
  return `${v.file ?? ""}:${v.line ?? ""}:${v.finding ?? ""}`;
}

export function dedupeVerdicts(verdicts) {
  const map = new Map();
  for (const v of verdicts ?? []) {
    map.set(verdictKey(v), v);
  }
  return [...map.values()];
}

export async function loadVerdicts(filePath = VERDICT_LOG_PATH) {
  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
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
    const existing = await loadVerdicts(filePath);
    const updated = dedupeVerdicts([...existing, ...(verdicts ?? [])]);
    await writeVerdictFile(updated, filePath);
    return updated;
  });
}

export function getActionableFindings(log) {
  return (log ?? []).filter((v) => v.verdict === "true");
}

export function isVerdictStale(verdict, currentContent) {
  if (!verdict?.codeHash) return true;
  return hashContent(currentContent) !== verdict.codeHash;
}

export async function markFixed(file, line, finding, { commit, testEvidence, fixedAt = new Date().toISOString() }, filePath = VERDICT_LOG_PATH) {
  return enqueue(async () => {
    const log = await loadVerdicts(filePath);
    const key = verdictKey({ file, line, finding });
    const target = log.find((v) => verdictKey(v) === key);
    if (!target) return null;
    target.fixed = { commit, testEvidence, fixedAt };
    await writeVerdictFile(log, filePath);
    return target;
  });
}

export async function getTrace(file, line, finding, filePath = VERDICT_LOG_PATH) {
  const log = await loadVerdicts(filePath);
  const key = verdictKey({ file, line, finding });
  const target = log.find((v) => verdictKey(v) === key);
  if (!target) return null;
  return {
    verdict: target.verdict,
    evidence: target.evidence ?? "",
    codeHash: target.codeHash ?? null,
    fixed: target.fixed ?? null,
  };
}
