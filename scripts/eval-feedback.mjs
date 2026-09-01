import { modelsOf, isValidMistakeType } from "./verdict-log.mjs";

// 从终审真值算「回灌权重」：每模型、每种误报类型占该模型总误报数的比例。
// 权重信号只来自 confirmed.final（opencode 终审真值），绝不引入 verdict（验证审计员初筛，旧 hy3 实测判真吻合率仅 39% 不可信；hy4-preview 待重测）。
// 无/非法 mistakeType 计入 total（分母）但不产生权重（分子），fail-closed：拿不准的类型权重视为 0。
export function computeFeedbackWeights(log) {
  const perModel = {};
  for (const v of log ?? []) {
    if (!v || v.confirmed?.final !== "false") continue;
    const t = v.confirmed?.mistakeType;
    const valid = isValidMistakeType(t);
    for (const m of modelsOf(v)) {
      if (!perModel[m]) perModel[m] = { total: 0, byType: {} };
      perModel[m].total += 1;
      if (valid) perModel[m].byType[t] = (perModel[m].byType[t] ?? 0) + 1;
    }
  }
  const weights = {};
  for (const [m, s] of Object.entries(perModel)) {
    weights[m] = {};
    for (const [t, count] of Object.entries(s.byType)) {
      weights[m][t] = s.total === 0 ? 0 : count / s.total;
    }
  }
  return weights;
}
