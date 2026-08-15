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

export async function persistVerdicts(verdicts, filePath = VERDICT_LOG_PATH) {
  const run = async () => {
    const existing = await loadVerdicts(filePath);
    const updated = dedupeVerdicts([...existing, ...(verdicts ?? [])]);

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
    return updated;
  };
  const result = _writeQueue.then(run, run);
  _writeQueue = result.then(() => {}, () => {});
  return result;
}

export function getActionableFindings(log) {
  return (log ?? []).filter((v) => v.verdict === "true");
}

export function isVerdictStale(verdict, currentContent) {
  if (!verdict?.codeHash) return true;
  return hashContent(currentContent) !== verdict.codeHash;
}
