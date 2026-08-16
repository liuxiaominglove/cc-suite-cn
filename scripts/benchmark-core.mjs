export function matchFindings(found, expected, { lineTolerance = 3 } = {}) {
  const foundList = found ?? [];
  const expectedList = expected ?? [];
  const tol = Number.isFinite(lineTolerance) && lineTolerance >= 0 ? lineTolerance : 3;
  const matchedExpected = new Set();
  let tp = 0;
  let fp = 0;
  for (const f of foundList) {
    const line = f?.line;
    let idx = -1;
    if (line != null) {
      idx = expectedList.findIndex((e, i) => !matchedExpected.has(i) && e?.line != null && Math.abs(e.line - line) <= tol);
    }
    if (idx >= 0) {
      matchedExpected.add(idx);
      tp += 1;
    } else {
      fp += 1;
    }
  }
  const fn = expectedList.length - matchedExpected.size;
  return { tp, fp, fn };
}

export function precision(m) {
  const denom = (m?.tp ?? 0) + (m?.fp ?? 0);
  return denom === 0 ? 0 : (m?.tp ?? 0) / denom;
}

export function recall(m) {
  const denom = (m?.tp ?? 0) + (m?.fn ?? 0);
  return denom === 0 ? 0 : (m?.tp ?? 0) / denom;
}

export function f1(m) {
  const p = precision(m);
  const r = recall(m);
  return p + r === 0 ? 0 : (2 * p * r) / (p + r);
}

export function scoreFindings(found, expected, opts = {}) {
  const m = matchFindings(found, expected, opts);
  return { ...m, precision: precision(m), recall: recall(m), f1: f1(m) };
}

export function aggregateByModel(runs, { lineTolerance = 3 } = {}) {
  const perModel = {};
  for (const run of runs ?? []) {
    if (!run?.model) continue;
    if (!perModel[run.model]) perModel[run.model] = { tp: 0, fp: 0, fn: 0, runs: 0 };
    const m = matchFindings(run.found, run.expected, { lineTolerance });
    const p = perModel[run.model];
    p.tp += m.tp;
    p.fp += m.fp;
    p.fn += m.fn;
    p.runs += 1;
  }
  for (const p of Object.values(perModel)) {
    p.precision = precision(p);
    p.recall = recall(p);
    p.f1 = f1(p);
  }
  return perModel;
}

export function parseManifest(text) {
  if (typeof text !== "string" || !text.trim()) return null;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("manifest is not valid JSON");
  }
  if (!parsed || !Array.isArray(parsed.fixtures)) {
    throw new Error('manifest must be an object with a "fixtures" array');
  }
  return parsed;
}
