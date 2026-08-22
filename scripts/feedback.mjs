import { matchesModel, isConfirmed, isValidMistakeType } from "./verdict-log.mjs";

function byRecency(a, b) {
  const ta = a?.confirmed?.confirmedAt ?? a?.timestamp ?? "";
  const tb = b?.confirmed?.confirmedAt ?? b?.timestamp ?? "";
  return tb < ta ? -1 : tb > ta ? 1 : 0;
}

export function pickCounterExamples(log, model, { topN = 5 } = {}) {
  const n = Number.isInteger(topN) && topN > 0 ? topN : 5;
  return (log ?? [])
    .filter((v) => matchesModel(v, model) && isConfirmed(v, "false"))
    .sort(byRecency)
    .slice(0, n);
}

export function pickExemplars(log, model, { topN = 5 } = {}) {
  const n = Number.isInteger(topN) && topN > 0 ? topN : 5;
  return (log ?? [])
    .filter((v) => matchesModel(v, model) && isConfirmed(v, "true"))
    .sort(byRecency)
    .slice(0, n);
}

export function formatFeedbackItem(v) {
  const loc = [v?.file, v?.line].filter((x) => x != null).join(":");
  const reason = v?.confirmed?.reason ? `（原因：${v.confirmed.reason}）` : "";
  return `- ${loc || "(未知位置)"} — ${v?.finding ?? ""}${reason}`;
}

export function buildFeedbackPreamble(model, log, { topN = 5 } = {}) {
  const counters = pickCounterExamples(log, model, { topN });
  const exemplars = pickExemplars(log, model, { topN });
  const parts = [];
  if (counters.length) {
    parts.push(`[你的历史误报——这次别重犯]\n${counters.map(formatFeedbackItem).join("\n")}`);
  }
  if (exemplars.length) {
    parts.push(`[你过去抓到的真 bug 示范]\n${exemplars.map(formatFeedbackItem).join("\n")}`);
  }
  return parts.join("\n\n");
}

export function pickRootCauses(log, { file = null, projectDir = null, topN = 3 } = {}) {
  const n = Number.isInteger(topN) && topN > 0 ? topN : 3;
  const items = (log ?? [])
    .filter((v) => v?.fixed?.rootCause)
    .filter((v) => {
      if (!file && !projectDir) return true;
      if (file && v.file === file) return true;
      if (projectDir && v.projectDir === projectDir) return true;
      return false;
    })
    .sort((a, b) => ((b.fixed?.fixedAt ?? "") < (a.fixed?.fixedAt ?? "") ? -1 : 1))
    .slice(0, n);
  return items;
}

export function formatRootCauseItem(v) {
  const loc = [v?.file, v?.line].filter((x) => x != null).join(":");
  return `- ${loc || "(未知位置)"} — ${v?.finding ?? ""}（根因：${v?.fixed?.rootCause ?? ""}）`;
}

export function buildRootCausePreamble(log, { file = null, projectDir = null, topN = 3 } = {}) {
  const items = pickRootCauses(log, { file, projectDir, topN });
  return items.length ? `[本项目曾修复过的 bug——警惕同类]\n${items.map(formatRootCauseItem).join("\n")}` : "";
}

export function pickMissed(log, { file = null, projectDir = null, topN = 3 } = {}) {
  const n = Number.isInteger(topN) && topN > 0 ? topN : 3;
  const items = (log ?? [])
    .filter((v) => {
      if (!file && !projectDir) return true;
      if (file && v.file === file) return true;
      if (projectDir && v.projectDir === projectDir) return true;
      return false;
    })
    .sort((a, b) => ((b.timestamp ?? "") < (a.timestamp ?? "") ? -1 : 1))
    .slice(0, n);
  return items;
}

export function formatMissedItem(v) {
  const loc = [v?.file, v?.line].filter((x) => x != null).join(":");
  const reason = v?.chainAnalysis ? `（依据：${v.chainAnalysis}）` : "";
  return `- ${loc || "(未知位置)"} — ${v?.finding ?? ""}${reason}`;
}

export function buildMissedPreamble(log, { file = null, projectDir = null, topN = 3 } = {}) {
  const items = pickMissed(log, { file, projectDir, topN });
  return items.length ? `[其他评审员发现你漏掉的 bug——这次注意]\n${items.map(formatMissedItem).join("\n")}` : "";
}

export function filterMissedForFeedback(log) {
  return (log ?? []).filter((v) => {
    if (!v || v.source !== "qwen-critic") return false;
    if (v.confirmed && v.confirmed.final === "true") return true;
    if (v.confirmed && v.confirmed.final === "false") return false;
    return v.verdict === "true";
  });
}

export function groupByMistakeType(log) {
  const out = {};
  for (const v of log ?? []) {
    if (!v || v.confirmed?.final !== "false") continue;
    const t = v.confirmed?.mistakeType;
    if (!isValidMistakeType(t)) continue;
    (out[t] ??= []).push(v);
  }
  return out;
}

export const MISTAKE_TYPE_RULES = {
  "prompt-injection-misattributed": "报告 prompt injection 前，先核对注入内容来源——仓库内受控文件（如 worker-lessons.md）不是攻击面；真攻击面是「来自不受信源码的 finding」和「来自外部项目文件的 rules」（见 known-risks KR-01）",
};

export function buildWorkerLessonCandidates(log) {
  const candidates = [];
  for (const v of log ?? []) {
    if (!v || v.confirmed?.final !== "false") continue;
    const t = v.confirmed?.mistakeType;
    if (!isValidMistakeType(t)) continue;
    candidates.push({
      mistakeType: t,
      rule: MISTAKE_TYPE_RULES[t] ?? "（待 opencode 润色：该类型的评审准则）",
      instance: [v.file, v.line].filter((x) => x != null).join(":"),
      source: v.finding ?? "",
    });
  }
  return candidates;
}

export function buildOrchestratorPreflight(log, { projectDir = null, files = null, rootCauseTopN = 3, mistakeTopN = 3 } = {}) {
  const parts = [];

  const rootCauses = pickRootCauses(log, { file: files?.[0] ?? null, projectDir, topN: rootCauseTopN });
  if (rootCauses.length) {
    parts.push(`[本项目修过的 bug——修 bug 时警惕同类]\n${rootCauses.map(formatRootCauseItem).join("\n")}`);
  }

  const scoped = projectDir ? (log ?? []).filter((v) => v?.projectDir === projectDir) : (log ?? []);
  const entries = Object.entries(groupByMistakeType(scoped))
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, mistakeTopN);
  if (entries.length) {
    parts.push(`[本项目历史误报类型——终审时警惕同类假阳]\n${entries.map(([t, items]) => `- ${t}（${items.length} 例）`).join("\n")}`);
  }

  return parts.join("\n\n");
}

export async function createFeedbackResolver({ load = null, loadMissed = null, topN = 5, rootCauseTopN = 3, missedTopN = 3, projectDir = process.cwd() } = {}) {
  const loadFn = load ?? (await import("./verdict-log.mjs")).loadVerdicts;
  const loadMissedFn = loadMissed ?? (async () => {
    const { loadVerdicts } = await import("./verdict-log.mjs");
    const log = await loadVerdicts();
    return filterMissedForFeedback(log);
  });
  let log = [];
  let missed = [];
  try {
    log = await loadFn();
  } catch {
    log = [];
  }
  try {
    missed = await loadMissedFn();
  } catch {
    missed = [];
  }
  return (model, file) => {
    const parts = [];
    const personal = buildFeedbackPreamble(model, log, { topN });
    if (personal) parts.push(personal);
    const missedP = buildMissedPreamble(missed, { file: file ?? null, projectDir, topN: missedTopN });
    if (missedP) parts.push(missedP);
    const rootCause = buildRootCausePreamble(log, { file: file ?? null, projectDir, topN: rootCauseTopN });
    if (rootCause) parts.push(rootCause);
    return parts.join("\n\n");
  };
}
