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
    const resolve = await createFeedbackResolver({ load });
    const s = resolve("glm-5.2");
    assert.ok(s.includes("历史误报"), s);
    assert.equal(resolve("kimi-k2.7-code"), "");
  });

  it("load 抛错时降级为返回空 preamble 的 resolver", async () => {
    const load = async () => { throw new Error("corrupted"); };
    const resolve = await createFeedbackResolver({ load });
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

