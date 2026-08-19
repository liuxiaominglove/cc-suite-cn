import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { REPORT_REQUIRED_SECTIONS, REPORT_MARKER, findMissingReportSections } from "./report-sections.mjs";

const FULL_REPORT = REPORT_REQUIRED_SECTIONS.map((s) => `## ${s}\n内容`).join("\n\n");

describe("REPORT_REQUIRED_SECTIONS", () => {
  it("含 5 个无条件必带项", () => {
    assert.deepEqual([...REPORT_REQUIRED_SECTIONS], [
      "总体结论",
      "行动项",
      "本次各 AI 表现",
      "本次触达功能",
      "本次各 AI 进步",
    ]);
  });
});

describe("findMissingReportSections", () => {
  it("完整报告返回空（无缺项）", () => {
    const text = `${REPORT_MARKER}\n\n${FULL_REPORT}`;
    assert.deepEqual(findMissingReportSections(text), []);
  });

  it("缺一项返回该段落 + 缺项名", () => {
    const partial = REPORT_REQUIRED_SECTIONS.filter((s) => s !== "行动项")
      .map((s) => `## ${s}\n内容`)
      .join("\n\n");
    const text = `${REPORT_MARKER}\n\n${partial}`;
    const problems = findMissingReportSections(text);
    assert.equal(problems.length, 1);
    assert.deepEqual(problems[0].missing, ["行动项"]);
  });

  it("缺全部返回全部缺项", () => {
    const text = `${REPORT_MARKER}\n\n# 某任务\n只有标题没有报告`;
    const problems = findMissingReportSections(text);
    assert.equal(problems.length, 1);
    assert.deepEqual(problems[0].missing, [...REPORT_REQUIRED_SECTIONS]);
  });

  it("无标记返回「无标记」问题", () => {
    const problems = findMissingReportSections("没有任何标记的文本");
    assert.equal(problems.length, 1);
    assert.equal(problems[0].section, "（无标记）");
  });

  it("标记之前的历史段落不校验", () => {
    const text = `# 历史段落（无报告项）\n\n${REPORT_MARKER}\n\n${FULL_REPORT}`;
    assert.deepEqual(findMissingReportSections(text), []);
  });

  it("多段分段校验，逐段报缺项", () => {
    const text = [
      REPORT_MARKER,
      "",
      FULL_REPORT,
      "",
      "---",
      "",
      "# 缺项段落",
    ].join("\n");
    const problems = findMissingReportSections(text);
    assert.equal(problems.length, 1);
    assert.equal(problems[0].section, "标记后第 2 段");
  });
});
