import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { hashContent } from "./verdict-log.mjs";

export const STEPS = ["step1", "step2", "step3", "step4", "step5"];

export const DEFAULT_FIX_STATE_DIR = ".cc-suite-cn/fix-state";

export function stateFile(projectDir) {
  const h = hashContent(projectDir ?? "");
  return `${h.slice(0, 16)}.json`;
}

export function createEmptyState(projectDir) {
  return { projectDir: projectDir ?? "", done: {} };
}

export function isStepDone(state, step) {
  return !!state?.done?.[step];
}

export function markStepDone(state, step) {
  if (!STEPS.includes(step)) {
    throw new Error(`invalid step: ${step}（应在 ${STEPS.join("|")} 中）`);
  }
  const done = { ...(state?.done ?? {}), [step]: true };
  return { ...(state ?? {}), done };
}

export async function loadState(dir, projectDir) {
  const file = join(dir, stateFile(projectDir));
  let raw;
  try {
    raw = await readFile(file, "utf-8");
  } catch (err) {
    if (err && err.code === "ENOENT") return createEmptyState(projectDir);
    throw err;
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.done && typeof parsed.done === "object") {
      return { ...parsed, projectDir: parsed.projectDir ?? projectDir };
    }
  } catch {
    // 损坏 state 回退空 state，不阻断 /fix 重跑
  }
  return createEmptyState(projectDir);
}

export async function saveState(dir, state) {
  await mkdir(dir, { recursive: true });
  const file = join(dir, stateFile(state?.projectDir ?? ""));
  const tmp = `${file}.${Date.now()}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(state ?? createEmptyState(state?.projectDir), null, 2), "utf-8");
    await rename(tmp, file);
  } finally {
    await unlink(tmp).catch(() => {});
  }
  return state;
}
