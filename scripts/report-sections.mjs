// report-sections.mjs — 总结报告的必带项单一数据源。
//
// 触发评审命令（/audit /review /evaluate /verify /fix /fix-incremental /audit-full /review-kimi /review-qwen / pnpm self-audit）
// 的任务总结，末尾固定附「总体结论 + 行动项 + 三节」。这里把必带项的关键词定义一次，
// docs-consistency.test.mjs 用它同时校验三处：
//   - SKILL.md 的 Report Template（模板不漂移）
//   - AGENTS.md 的汇报惯例（机器指令不漂移）
//   - docs/verification.md 标记之后的报告段落（落账不漏项）
//
// 条件必带项（复审状态 / 终审两步判真）依赖任务类型，无法无脑校验，不在此列，
// 由 SKILL.md / AGENTS.md 文字约束。

export const REPORT_REQUIRED_SECTIONS = Object.freeze([
  "总体结论",
  "行动项",
  "本次各 AI 表现",
  "本次触达功能",
  "本次各 AI 进步",
]);

export const REPORT_MARKER = "<!-- report-required: begin -->";

// 返回缺项的段落列表；标记之前（历史）不校验。
export function findMissingReportSections(text, { marker = REPORT_MARKER, sections = REPORT_REQUIRED_SECTIONS } = {}) {
  const idx = (text ?? "").indexOf(marker);
  if (idx === -1) {
    return [{ section: "（无标记）", missing: [...sections] }];
  }
  const after = text.slice(idx + marker.length);
  const blocks = after
    .split(/\n---+\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const problems = [];
  for (const [i, block] of blocks.entries()) {
    const missing = sections.filter((req) => !block.includes(req));
    if (missing.length) {
      problems.push({ section: `标记后第 ${i + 1} 段`, missing });
    }
  }
  return problems;
}
