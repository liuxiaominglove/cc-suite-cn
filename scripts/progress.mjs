import { isMainModule } from "./runner-core.mjs";
import { loadVerdicts } from "./verdict-log.mjs";

export function isConfirmed(v) {
  return !!v?.confirmed && (v.confirmed.final === "true" || v.confirmed.final === "false");
}

export function splitByBatch(log) {
  const confirmed = (log ?? []).filter(isConfirmed);
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
    const models = Array.isArray(v.models) ? v.models : (v.model ? [v.model] : []);
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
  return 0;
}

if (isMainModule(import.meta.url)) {
  progressCli()
    .then((c) => { process.exitCode = c; })
    .catch((e) => { console.error(e.message); process.exitCode = 1; });
}
