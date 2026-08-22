import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  pickCounterExamples,
  pickExemplars,
  formatFeedbackItem,
  buildFeedbackPreamble,
  pickRootCauses,
  formatRootCauseItem,
  buildRootCausePreamble,
  pickMissed,
  formatMissedItem,
  buildMissedPreamble,
  filterMissedForFeedback,
  createFeedbackResolver,
  groupByMistakeType,
  buildWorkerLessonCandidates,
  buildOrchestratorPreflight,
} from "./feedback.mjs";

describe("pickCounterExamples", () => {
  const log = [
    { file: "a.js", line: 1, finding: "null deref", model: "glm-5.2", confirmed: { final: "false", reason: "已有 null 守卫", confirmedAt: "2026-01-01T00:00:00Z" } },
    { file: "b.js", line: 2, finding: "tilde not expanded", model: "glm-5.2", confirmed: { final: "false", reason: "已做 ~ 展开", confirmedAt: "2026-01-02T00:00:00Z" } },
    { file: "c.js", line: 3, finding: "real bug", model: "glm-5.2", confirmed: { final: "true", reason: "确实", confirmedAt: "2026-01-03T00:00:00Z" } },
    { file: "d.js", line: 4, finding: "unconfirmed false", model: "glm-5.2", verdict: "false" },
    { file: "e.js", line: 5, finding: "other model", model: "kimi-k2.7-code", confirmed: { final: "false", reason: "x", confirmedAt: "2026-01-04T00:00:00Z" } },
  ];

  it("只挑终审判 false 且属于该模型的样本", () => {
    const out = pickCounterExamples(log, "glm-5.2");
    assert.equal(out.length, 2);
    assert.ok(out.every((v) => v.model === "glm-5.2" && v.confirmed.final === "false"));
  });

  it("未经终审的 false 不进回灌（负向）", () => {
    const out = pickCounterExamples(log, "glm-5.2");
    assert.ok(!out.some((v) => v.finding === "unconfirmed false"), "无 confirmed 的 false 不得进回灌");
  });

  it("按确认时间倒序（最近优先）", () => {
    const out = pickCounterExamples(log, "glm-5.2");
    assert.equal(out[0].finding, "tilde not expanded");
  });

  it("topN 截断", () => {
    const out = pickCounterExamples(log, "glm-5.2", { topN: 1 });
    assert.equal(out.length, 1);
  });

  it("空账本返回空", () => {
    assert.deepEqual(pickCounterExamples([], "glm-5.2"), []);
    assert.deepEqual(pickCounterExamples(null, "glm-5.2"), []);
  });
});

describe("pickExemplars", () => {
  it("只挑终审判 true 的样本", () => {
    const log = [
      { file: "c.js", finding: "real bug", model: "glm-5.2", confirmed: { final: "true" } },
      { file: "a.js", finding: "false positive", model: "glm-5.2", confirmed: { final: "false" } },
    ];
    const out = pickExemplars(log, "glm-5.2");
    assert.equal(out.length, 1);
    assert.equal(out[0].finding, "real bug");
  });
});

describe("formatFeedbackItem", () => {
  it("带位置、finding、原因", () => {
    const s = formatFeedbackItem({ file: "a.js", line: 3, finding: "null deref", confirmed: { reason: "已有守卫" } });
    assert.ok(s.includes("a.js:3"), s);
    assert.ok(s.includes("null deref"), s);
    assert.ok(s.includes("已有守卫"), s);
  });

  it("缺 line 时不输出 :undefined", () => {
    const s = formatFeedbackItem({ file: "a.js", finding: "x", confirmed: {} });
    assert.ok(!s.includes("undefined"), s);
  });
});

describe("buildFeedbackPreamble", () => {
  it("同时含误报与正例两段", () => {
    const log = [
      { file: "a.js", finding: "误报", model: "glm-5.2", confirmed: { final: "false", reason: "r" } },
      { file: "b.js", finding: "真 bug", model: "glm-5.2", confirmed: { final: "true" } },
    ];
    const s = buildFeedbackPreamble("glm-5.2", log);
    assert.ok(s.includes("历史误报"), s);
    assert.ok(s.includes("真 bug 示范"), s);
  });

  it("无反馈返回空串", () => {
    assert.equal(buildFeedbackPreamble("glm-5.2", []), "");
  });
});

describe("createFeedbackResolver", () => {
  it("返回 (model)=>preamble 的函数", async () => {
    const load = async () => [
      { file: "a.js", finding: "误报", model: "glm-5.2", confirmed: { final: "false", reason: "r" } },
    ];
    const resolve = await createFeedbackResolver({ load, loadMissed: async () => [] });
    const s = resolve("glm-5.2");
    assert.ok(s.includes("历史误报"), s);
    assert.equal(resolve("kimi-k2.7-code"), "");
  });

  it("load 抛错时降级为返回空 preamble 的 resolver", async () => {
    const load = async () => { throw new Error("corrupted"); };
    const resolve = await createFeedbackResolver({ load, loadMissed: async () => [] });
    assert.equal(resolve("glm-5.2"), "");
  });

  it("注入本项目已修复 bug 的根因（按 projectDir 匹配）", async () => {
    const load = async () => [
      { file: "a.js", finding: "null deref", model: "glm-5.2", projectDir: "/proj/x", fixed: { rootCause: "信任边界", fixedAt: "2026-01-01T00:00:00Z" } },
    ];
    const resolve = await createFeedbackResolver({ load, projectDir: "/proj/x" });
    const s = resolve("kimi-k2.7-code", "other.js");
    assert.ok(s.includes("本项目曾修复过的 bug"), s);
    assert.ok(s.includes("null deref"), s);
  });

  it("不同 projectDir 的根因不注入", async () => {
    const load = async () => [
      { file: "a.js", finding: "null deref", projectDir: "/proj/other", fixed: { rootCause: "x" } },
    ];
    const resolve = await createFeedbackResolver({ load, projectDir: "/proj/x" });
    assert.equal(resolve("kimi-k2.7-code", "other.js"), "");
  });
});

describe("pickRootCauses", () => {
  const log = [
    { file: "a.js", finding: "f1", fixed: { rootCause: "r1", fixedAt: "2026-01-01T00:00:00Z" } },
    { file: "b.js", finding: "f2", projectDir: "/p", fixed: { rootCause: "r2", fixedAt: "2026-01-02T00:00:00Z" } },
    { file: "c.js", finding: "no root cause", fixed: { commit: "c1" } },
    { file: "d.js", finding: "no fixed" },
  ];

  it("只挑有 rootCause 的", () => {
    const out = pickRootCauses(log);
    assert.equal(out.length, 2);
    assert.ok(out.every((v) => v.fixed.rootCause));
  });

  it("按 file 精确匹配", () => {
    const out = pickRootCauses(log, { file: "b.js" });
    assert.equal(out.length, 1);
    assert.equal(out[0].finding, "f2");
  });

  it("按 projectDir 匹配", () => {
    const out = pickRootCauses(log, { projectDir: "/p" });
    assert.equal(out.length, 1);
    assert.equal(out[0].finding, "f2");
  });

  it("不传 file/projectDir 时返回全部（兼容）", () => {
    assert.equal(pickRootCauses(log).length, 2);
  });

  it("topN 截断 + 空账本", () => {
    assert.equal(pickRootCauses(log, { topN: 1 }).length, 1);
    assert.deepEqual(pickRootCauses([]), []);
  });
});

describe("buildRootCausePreamble", () => {
  it("无根因返回空串", () => {
    assert.equal(buildRootCausePreamble([], { projectDir: "/p" }), "");
  });
});

describe("pickMissed", () => {
  const log = [
    { file: "a.js", line: 3, finding: "missed bug", projectDir: "/p", timestamp: "2026-01-01T00:00:00Z" },
    { file: "b.js", line: 4, finding: "missed bug 2", projectDir: "/p", timestamp: "2026-01-02T00:00:00Z" },
    { file: "c.js", line: 5, finding: "missed bug 3", projectDir: "/other", timestamp: "2026-01-03T00:00:00Z" },
  ];

  it("按 projectDir 过滤", () => {
    const out = pickMissed(log, { projectDir: "/p" });
    assert.equal(out.length, 2);
  });

  it("按 file 精确过滤", () => {
    const out = pickMissed(log, { file: "a.js" });
    assert.equal(out.length, 1);
    assert.equal(out[0].finding, "missed bug");
  });

  it("最近优先 + topN 截断", () => {
    const out = pickMissed(log, { projectDir: "/p", topN: 1 });
    assert.equal(out.length, 1);
    assert.equal(out[0].finding, "missed bug 2");
  });

  it("空账本返回空", () => {
    assert.deepEqual(pickMissed([], { projectDir: "/p" }), []);
  });
});

describe("buildMissedPreamble", () => {
  it("注入漏报提醒", () => {
    const s = buildMissedPreamble([{ file: "a.js", line: 3, finding: "missed bug", projectDir: "/p" }], { projectDir: "/p" });
    assert.ok(s.includes("漏掉"), s);
    assert.ok(s.includes("missed bug"), s);
  });

  it("无漏报返回空", () => {
    assert.equal(buildMissedPreamble([], { projectDir: "/p" }), "");
  });
});

describe("createFeedbackResolver 漏报", () => {
  it("注入 qwen 的漏报提醒", async () => {
    const load = async () => [];
    const loadMissed = async () => [{ file: "a.js", finding: "missed bug", projectDir: "/proj/x" }];
    const resolve = await createFeedbackResolver({ load, loadMissed, projectDir: "/proj/x" });
    const s = resolve("glm-5.2", "a.js");
    assert.ok(s.includes("漏掉"), s);
    assert.ok(s.includes("missed bug"), s);
  });
});

describe("filterMissedForFeedback", () => {
  it("只回灌确认为真的补漏（排除假阳 + 未裁决）", () => {
    const log = [
      { file: "a.js", source: "qwen-critic", finding: "真补漏", verdict: "true" },
      { file: "b.js", source: "qwen-critic", finding: "假阳补漏", verdict: "false" },
      { file: "c.js", source: "qwen-critic", finding: "未裁决", verdict: null },
      { file: "d.js", source: "qwen-critic", finding: "终审假", verdict: "true", confirmed: { final: "false" } },
      { file: "e.js", source: "audit", finding: "不是补漏", verdict: "true" },
      { file: "f.js", source: "qwen-critic", finding: "终审真", verdict: null, confirmed: { final: "true" } },
    ];
    const out = filterMissedForFeedback(log);
    assert.deepEqual(out.map((v) => v.finding), ["真补漏", "终审真"]);
  });
});

describe("groupByMistakeType", () => {
  it("空账本/null 返回空对象", () => {
    assert.deepEqual(groupByMistakeType([]), {});
    assert.deepEqual(groupByMistakeType(null), {});
  });

  it("多类型正确分组", () => {
    const log = [
      { file: "a.js", finding: "f1", confirmed: { final: "false", mistakeType: "path-normalized" } },
      { file: "b.js", finding: "f2", confirmed: { final: "false", mistakeType: "by-design" } },
      { file: "c.js", finding: "f3", confirmed: { final: "false", mistakeType: "path-normalized" } },
    ];
    const out = groupByMistakeType(log);
    assert.equal(out["path-normalized"].length, 2);
    assert.equal(out["by-design"].length, 1);
  });

  it("final=false 无 mistakeType（旧记录）不计入", () => {
    const log = [
      { file: "a.js", finding: "f1", confirmed: { final: "false" } },
      { file: "b.js", finding: "f2", confirmed: { final: "false", mistakeType: "by-design" } },
    ];
    const out = groupByMistakeType(log);
    assert.deepEqual(Object.keys(out), ["by-design"]);
  });

  it("final=true（即使有 mistakeType）不计入", () => {
    const log = [
      { file: "a.js", finding: "f1", confirmed: { final: "true", mistakeType: "by-design" } },
      { file: "b.js", finding: "f2", confirmed: { final: "false", mistakeType: "by-design" } },
    ];
    const out = groupByMistakeType(log);
    assert.equal(out["by-design"].length, 1, "final=true 不计入");
  });

  it("同类型多条聚合完整（保留条目引用）", () => {
    const a = { file: "a.js", finding: "f1", confirmed: { final: "false", mistakeType: "unknown" } };
    const b = { file: "b.js", finding: "f2", confirmed: { final: "false", mistakeType: "unknown" } };
    const out = groupByMistakeType([a, b]);
    assert.deepEqual(out["unknown"], [a, b]);
  });

  it("非法 mistakeType 脏数据不入组", () => {
    const log = [
      { file: "a.js", finding: "f1", confirmed: { final: "false", mistakeType: "not-a-real-type" } },
      { file: "b.js", finding: "f2", confirmed: { final: "false", mistakeType: "by-design" } },
    ];
    const out = groupByMistakeType(log);
    assert.deepEqual(Object.keys(out), ["by-design"], "非法类型不入组");
  });
});

describe("buildWorkerLessonCandidates", () => {
  it("空账本/null 返回空数组", () => {
    assert.deepEqual(buildWorkerLessonCandidates([]), []);
    assert.deepEqual(buildWorkerLessonCandidates(null), []);
  });

  it("带 mistakeType 的假阳生成三段候选", () => {
    const log = [
      { file: "a.js", line: 112, finding: "lessons 未 sanitize", confirmed: { final: "false", mistakeType: "prompt-injection-misattributed" } },
    ];
    const out = buildWorkerLessonCandidates(log);
    assert.equal(out.length, 1);
    assert.equal(out[0].mistakeType, "prompt-injection-misattributed");
    assert.ok(out[0].rule.includes("prompt injection"), "规则文本应含关键词");
    assert.equal(out[0].instance, "a.js:112");
    assert.equal(out[0].source, "lessons 未 sanitize");
  });

  it("final=true 或无 mistakeType 不生成", () => {
    const log = [
      { file: "a.js", finding: "f1", confirmed: { final: "true", mistakeType: "by-design" } },
      { file: "b.js", finding: "f2", confirmed: { final: "false" } },
    ];
    assert.deepEqual(buildWorkerLessonCandidates(log), []);
  });

  it("非法 mistakeType 不生成", () => {
    const log = [{ file: "a.js", finding: "f", confirmed: { final: "false", mistakeType: "not-a-real-type" } }];
    assert.deepEqual(buildWorkerLessonCandidates(log), []);
  });

  it("unknown 类型用 fallback 规则", () => {
    const log = [{ file: "a.js", finding: "f", confirmed: { final: "false", mistakeType: "unknown" } }];
    const out = buildWorkerLessonCandidates(log);
    assert.equal(out.length, 1);
    assert.ok(out[0].rule.includes("待 opencode"), "unknown 应用 fallback 规则");
  });
});

describe("buildOrchestratorPreflight", () => {
  it("两源都有时产出两段", () => {
    const log = [
      { file: "a.js", line: 1, finding: "f1", projectDir: "/p", fixed: { rootCause: "边界", fixedAt: "2026-01-01T00:00:00Z" } },
      { file: "b.js", line: 2, finding: "f2", projectDir: "/p", confirmed: { final: "false", mistakeType: "path-normalized" } },
    ];
    const out = buildOrchestratorPreflight(log, { projectDir: "/p" });
    assert.ok(out.includes("修 bug 时警惕同类"), "应含根因段头");
    assert.ok(out.includes("终审时警惕同类假阳"), "应含误报段头");
    assert.ok(out.includes("边界"), "应含根因内容");
    assert.ok(out.includes("path-normalized"), "应含误报类型");
  });

  it("空账本/null 返回空串", () => {
    assert.equal(buildOrchestratorPreflight([]), "");
    assert.equal(buildOrchestratorPreflight(null), "");
  });

  it("只有 rootCause 时只出根因段", () => {
    const log = [{ file: "a.js", finding: "f1", fixed: { rootCause: "边界" } }];
    const out = buildOrchestratorPreflight(log);
    assert.ok(out.includes("修 bug 时警惕同类"));
    assert.ok(!out.includes("终审时警惕同类假阳"), "无误报段");
  });

  it("只有 mistakeType 时只出误报段", () => {
    const log = [{ file: "a.js", finding: "f1", confirmed: { final: "false", mistakeType: "by-design" } }];
    const out = buildOrchestratorPreflight(log);
    assert.ok(out.includes("终审时警惕同类假阳"));
    assert.ok(!out.includes("修 bug 时警惕同类"), "无根因段");
  });

  it("漏报（source=qwen-critic 的真 bug）不进清单", () => {
    const log = [{ file: "a.js", source: "qwen-critic", finding: "漏报真 bug", verdict: "true", confirmed: { final: "true" } }];
    assert.equal(buildOrchestratorPreflight(log), "");
  });

  it("projectDir 过滤只匹配本项目根因", () => {
    const log = [
      { file: "a.js", finding: "f1", projectDir: "/p", fixed: { rootCause: "边界" } },
      { file: "b.js", finding: "f2", projectDir: "/other", fixed: { rootCause: "时序" } },
    ];
    const out = buildOrchestratorPreflight(log, { projectDir: "/p" });
    assert.ok(out.includes("边界"));
    assert.ok(!out.includes("时序"), "其他项目根因不进");
  });

  it("非法 mistakeType 不纳入", () => {
    const log = [{ file: "a.js", finding: "f1", confirmed: { final: "false", mistakeType: "garbage" } }];
    assert.equal(buildOrchestratorPreflight(log), "");
  });

  it("final=true 带 mistakeType 不计入误报段", () => {
    const log = [{ file: "a.js", finding: "f1", confirmed: { final: "true", mistakeType: "by-design" } }];
    assert.equal(buildOrchestratorPreflight(log), "");
  });

  it("topN 截断", () => {
    const log = Array.from({ length: 5 }, (_, i) => ({ file: `f${i}.js`, finding: `f${i}`, fixed: { rootCause: `r${i}` } }));
    const out = buildOrchestratorPreflight(log, { rootCauseTopN: 3 });
    const lines = out.split("\n").filter((l) => l.startsWith("- "));
    assert.equal(lines.length, 3, "只出 3 条根因");
  });

  it("mistakeTopN 按频率降序取前 N（高频后出现也要保留）", () => {
    const log = [
      { file: "a1.js", confirmed: { final: "false", mistakeType: "unknown" } },
      { file: "b1.js", confirmed: { final: "false", mistakeType: "path-normalized" } },
      { file: "b2.js", confirmed: { final: "false", mistakeType: "path-normalized" } },
      { file: "c1.js", confirmed: { final: "false", mistakeType: "by-design" } },
      { file: "c2.js", confirmed: { final: "false", mistakeType: "by-design" } },
      { file: "c3.js", confirmed: { final: "false", mistakeType: "by-design" } },
    ];
    const out = buildOrchestratorPreflight(log, { mistakeTopN: 2 });
    assert.ok(out.includes("by-design"), "高频 by-design 应保留");
    assert.ok(out.includes("path-normalized"), "次高频 path-normalized 应保留");
    assert.ok(!out.includes("unknown"), "低频 unknown 应被丢弃（即使先出现）");
  });
});

