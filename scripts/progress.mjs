import { isMainModule } from "./runner-core.mjs";
import { loadVerdicts, isConfirmed, modelsOf, isValidMistakeType } from "./verdict-log.mjs";

export function splitByBatch(log) {
  const confirmed = (log ?? []).filter((v) => isConfirmed(v));
  if (confirmed.length === 0) return { latest: [], historical: [] };
  const maxAt = confirmed.reduce((m, v) => {
    const t = v.confirmed.confirmedAt || "";
    return t > m ? t : m;
  }, "");
  const latest = confirmed.filter((v) => (v.confirmed.confirmedAt || "") === maxAt);
  const historical = confirmed.filter((v) => (v.confirmed.confirmedAt || "") !== maxAt);
  return { latest, historical };
}

export function fpRate(entries) {
  if (!entries || entries.length === 0) return null;
  let fp = 0;
  for (const v of entries) {
    if (v.confirmed.final === "false") fp += 1;
  }
  return fp / entries.length;
}

function groupByModel(entries) {
  const map = {};
  for (const v of entries) {
    const models = modelsOf(v);
    for (const m of models) {
      if (!map[m]) map[m] = [];
      map[m].push(v);
    }
  }
  return map;
}

function direction(historicalFpRate, latestFpRate) {
  if (latestFpRate === null) return "无本次";
  if (historicalFpRate === null) return "无历史";
  if (latestFpRate < historicalFpRate) return "↑";
  if (latestFpRate > historicalFpRate) return "↓";
  return "—";
}

export function computeProgress(log) {
  const { latest, historical } = splitByBatch(log);
  const hist = groupByModel(historical);
  const last = groupByModel(latest);
  const models = new Set([...Object.keys(hist), ...Object.keys(last)]);
  const perModel = {};
  for (const m of models) {
    const histEntries = hist[m] ?? [];
    const lastEntries = last[m] ?? [];
    const historicalFpRate = fpRate(histEntries);
    const latestFpRate = fpRate(lastEntries);
    perModel[m] = {
      historicalFpRate,
      latestFpRate,
      historicalCount: histEntries.length,
      latestCount: lastEntries.length,
      direction: direction(historicalFpRate, latestFpRate),
    };
  }
  return perModel;
}

export function computeMistakeBreakdown(log) {
  const byType = {};
  let total = 0;
  let unlabeled = 0;
  for (const v of log ?? []) {
    if (!v || v.confirmed?.final !== "false") continue;
    const t = v.confirmed?.mistakeType;
    if (isValidMistakeType(t)) {
      byType[t] = (byType[t] ?? 0) + 1;
      total += 1;
    } else {
      unlabeled += 1;
    }
  }
  return { byType, total, unlabeled };
}

// 验证审计员 裁决 vs opencode 终审 吻合率：只统计「已终审」的 finding，对照 verdict 与 confirmed.final。
// verdict=true 判对 = final=true；verdict=false 判对 = final=false；uncertain（含 verdict 非 true/false）判真 = final=true。
// agreement / trueRate 无样本时返回 null（除零 → 不拍脑袋）。这是阶段 3 启用「高置信自动回灌」前的数据门槛。
export function computeAdjudicatorAgreement(log) {
  const verdictTrue = { total: 0, agree: 0 };
  const verdictFalse = { total: 0, agree: 0 };
  const uncertain = { total: 0, trueCount: 0 };
  for (const v of log ?? []) {
    if (!v || !isConfirmed(v)) continue;
    const final = v.confirmed.final;
    if (v.verdict === "true") {
      verdictTrue.total += 1;
      if (final === "true") verdictTrue.agree += 1;
    } else if (v.verdict === "false") {
      verdictFalse.total += 1;
      if (final === "false") verdictFalse.agree += 1;
    } else {
      uncertain.total += 1;
      if (final === "true") uncertain.trueCount += 1;
    }
  }
  const rate = (num, den) => (den === 0 ? null : num / den);
  return {
    samples: verdictTrue.total + verdictFalse.total + uncertain.total,
    verdictTrue: { total: verdictTrue.total, agree: verdictTrue.agree, agreement: rate(verdictTrue.agree, verdictTrue.total) },
    verdictFalse: { total: verdictFalse.total, agree: verdictFalse.agree, agreement: rate(verdictFalse.agree, verdictFalse.total) },
    uncertain: { total: uncertain.total, trueCount: uncertain.trueCount, trueRate: rate(uncertain.trueCount, uncertain.total) },
  };
}

function pct(x) {
  return x === null ? "无样本" : `${(x * 100).toFixed(0)}%`;
}

export async function progressCli({ load = null, stdout = process.stdout } = {}) {
  const loadFn = load ?? loadVerdicts;
  const log = await loadFn();
  const perModel = computeProgress(log);
  if (Object.keys(perModel).length === 0) {
    stdout.write("（暂无终审数据，先跑 /fix 让 opencode 终审写回）\n");
    return 0;
  }
  stdout.write("各 AI 误报率进步（历史 → 本次）\n");
  stdout.write("=".repeat(56) + "\n");
  for (const [model, m] of Object.entries(perModel)) {
    stdout.write(
      `${model.padEnd(20)}  ${pct(m.historicalFpRate).padStart(6)} → ${pct(m.latestFpRate).padStart(6)}  ${m.direction}（历史${m.historicalCount}/本次${m.latestCount}）\n`
    );
  }
  stdout.write("（↓=退步 ↑=进步 —=持平；误报率越低越好）\n");

  const agreement = computeAdjudicatorAgreement(log);
  stdout.write("\n验证审计员 裁决 vs 终审吻合率（一致 = 验证审计员 与 opencode 终审相符）\n");
  const fmtAgree = (agree, total) => (total === 0 ? "无样本" : `${((agree / total) * 100).toFixed(0)}%（一致 ${agree}/${total}）`);
  const fmtUnc = (trueCount, total) => (total === 0 ? "无样本" : `${((trueCount / total) * 100).toFixed(0)}%（真 ${trueCount}/${total}）`);
  stdout.write(`验证审计员 判真 吻合率：${fmtAgree(agreement.verdictTrue.agree, agreement.verdictTrue.total)}\n`);
  stdout.write(`验证审计员 判假 吻合率：${fmtAgree(agreement.verdictFalse.agree, agreement.verdictFalse.total)}\n`);
  stdout.write(`验证审计员 拿不准 中真 bug 占比：${fmtUnc(agreement.uncertain.trueCount, agreement.uncertain.total)}\n`);
  return 0;
}

if (isMainModule(import.meta.url)) {
  progressCli()
    .then((c) => { process.exitCode = c; })
    .catch((e) => { console.error(e.message); process.exitCode = 1; });
}
