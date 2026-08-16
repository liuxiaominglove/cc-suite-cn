import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";

export const MISSED_LOG_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../.cc-suite-cn/missed-log.json");

export function missedKey(e) {
  return JSON.stringify([e?.file ?? "", e?.line ?? null, e?.finding ?? ""]);
}

export function dedupeMissed(entries) {
  const map = new Map();
  for (const e of entries ?? []) {
    map.set(missedKey(e), e);
  }
  return [...map.values()];
}

export async function loadMissed(filePath = MISSED_LOG_PATH) {
  let raw;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch (err) {
    if (err && err.code === "ENOENT") return [];
    throw err;
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    throw new Error(`corrupted missed log: ${filePath}`);
  }
}

let _writeQueue = Promise.resolve();

async function writeMissedFile(updated, filePath) {
  await mkdir(dirname(filePath), { recursive: true });
  const tmpPath = join(dirname(filePath), `.missed-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
  try {
    await writeFile(tmpPath, JSON.stringify(updated, null, 2) + "\n", "utf-8");
    await rename(tmpPath, filePath);
  } finally {
    try { await unlink(tmpPath); } catch {}
  }
}

export async function persistMissed(entries, filePath = MISSED_LOG_PATH) {
  const result = _writeQueue.then(async () => {
    const existing = await loadMissed(filePath);
    const updated = dedupeMissed([...existing, ...(entries ?? [])]);
    await writeMissedFile(updated, filePath);
    return updated;
  });
  _writeQueue = result.then(() => {}, () => {});
  return result;
}
