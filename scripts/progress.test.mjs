import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { splitByBatch, fpRate, computeProgress, progressCli, computeMistakeBreakdown, computeAdjudicatorAgreement } from "./progress.mjs";

describe("splitByBatch", () => {
  it("空账本返回两个空数组", () => {
    assert.deepEqual(splitByBatch([]), { latest: [], historical: [] });
    assert.deepEqual(splitByBatch(null), { latest: [], historical: [] });
  });

  it("单一批次全部归 latest，historical 为空", () => {
    const log = [
      { models: ["glm-5.2"], confirmed: { final: "false", confirmedAt: "t" } },
      { models: ["glm-5.2"], confirmed: { final: "true", confirmedAt: "t" } },
    ];
    const { latest, historical } = splitByBatch(log);
    assert.equal(latest.length, 2);
    assert.equal(historical.length, 0);
  });

  it("按最大 confirmedAt 切分历史与本次", () => {
    const log = [
      { models: ["glm-5.2"], confirmed: { final: "false", confirmedAt: "2026-01-01T00:00:00Z" } },
      { models: ["glm-5.2"], confirmed: { final: "true", confirmedAt: "2026-01-01T00:00:00Z" } },
      { models: ["kimi-k2.7-code"], confirmed: { final: "false", confirmedAt: "2026-01-02T00:00:00Z" } },
    ];
    const { latest, historical } = splitByBatch(log);
    assert.equal(latest.length, 1);
    assert.equal(latest[0].models[0], "kimi-k2.7-code");
    assert.equal(historical.length, 2);
  });

  it("忽略无 confirmed 标签的条目", () => {
    const log = [
      { models: ["glm-5.2"], verdict: "false" },
      { models: ["glm-5.2"], confirmed: { final: "false", confirmedAt: "t" } },
    ];
    const { latest, historical } = splitByBatch(log);
    assert.equal(latest.length, 1);
    assert.equal(historical.length, 0);
  });
});

describe("fpRate", () => {
  it("空/空数组返回 null", () => {
    assert.equal(fpRate([]), null);
    assert.equal(fpRate(null), null);
  });

  it("1真1假 = 0.5", () => {
    assert.equal(
      fpRate([{ confirmed: { final: "false" } }, { confirmed: { final: "true" } }]),
      0.5
    );
  });

  it("全真 = 0", () => {
    assert.equal(fpRate([{ confirmed: { final: "true" } }, { confirmed: { final: "true" } }]), 0);
  });
});

describe("computeProgress", () => {
  const OLD = "2026-01-01T00:00:00Z";
  const NEW = "2026-01-02T00:00:00Z";

  it("进步：本次误报率低于历史", () => {
    const log = [
      { models: ["glm-5.2"], confirmed: { final: "false", confirmedAt: OLD } },
      { models: ["glm-5.2"], confirmed: { final: "true", confirmedAt: OLD } },
      { models: ["glm-5.2"], confirmed: { final: "true", confirmedAt: NEW } },
      { models: ["glm-5.2"], confirmed: { final: "true", confirmedAt: NEW } },
      { models: ["glm-5.2"], confirmed: { final: "true", confirmedAt: NEW } },
    ];
    const p = computeProgress(log);
    assert.equal(p["glm-5.2"].historicalFpRate, 0.5);
    assert.equal(p["glm-5.2"].latestFpRate, 0);
    assert.equal(p["glm-5.2"].direction, "↑");
  });

  it("退步：本次误报率高于历史", () => {
    const log = [
      { models: ["glm-5.2"], confirmed: { final: "true", confirmedAt: OLD } },
      { models: ["glm-5.2"], confirmed: { final: "false", confirmedAt: NEW } },
    ];
    const p = computeProgress(log);
    assert.equal(p["glm-5.2"].historicalFpRate, 0);
    assert.equal(p["glm-5.2"].latestFpRate, 1);
    assert.equal(p["glm-5.2"].direction, "↓");
  });

  it("持平：两次误报率相同", () => {
    const log = [
      { models: ["glm-5.2"], confirmed: { final: "false", confirmedAt: OLD } },
      { models: ["glm-5.2"], confirmed: { final: "true", confirmedAt: OLD } },
      { models: ["glm-5.2"], confirmed: { final: "false", confirmedAt: NEW } },
      { models: ["glm-5.2"], confirmed: { final: "true", confirmedAt: NEW } },
    ];
    const p = computeProgress(log);
    assert.equal(p["glm-5.2"].direction, "—");
  });

  it("无历史：首次参与 → 无历史", () => {
    const log = [{ models: ["glm-5.2"], confirmed: { final: "false", confirmedAt: NEW } }];
    const p = computeProgress(log);
    assert.equal(p["glm-5.2"].direction, "无历史");
    assert.equal(p["glm-5.2"].historicalFpRate, null);
  });

  it("无本次：只在历史出现过 → 无本次", () => {
    const log = [
      { models: ["glm-5.2"], confirmed: { final: "false", confirmedAt: OLD } },
      { models: ["kimi-k2.7-code"], confirmed: { final: "true", confirmedAt: NEW } },
    ];
    const p = computeProgress(log);
    assert.equal(p["glm-5.2"].direction, "无本次");
    assert.equal(p["glm-5.2"].latestFpRate, null);
    assert.equal(p["kimi-k2.7-code"].direction, "无历史");
  });

  it("按 models 数组归属到每个模型", () => {
    const log = [
      { models: ["glm-5.2", "kimi-k2.7-code"], confirmed: { final: "false", confirmedAt: NEW } },
    ];
    const p = computeProgress(log);
    assert.ok(p["glm-5.2"]);
    assert.ok(p["kimi-k2.7-code"]);
  });

  it("空账本返回空对象", () => {
    assert.deepEqual(computeProgress([]), {});
  });
});

describe("progressCli", () => {
  it("空数据打印暂无提示", async () => {
    let out = "";
    await progressCli({ load: async () => [], stdout: { write: (s) => { out += s; } } });
    assert.ok(out.includes("暂无终审数据"), out);
  });

  it("打印各模型误报率与方向", async () => {
    const log = [
      { models: ["glm-5.2"], confirmed: { final: "false", confirmedAt: "old" } },
      { models: ["glm-5.2"], confirmed: { final: "true", confirmedAt: "new" } },
    ];
    let out = "";
    await progressCli({ load: async () => log, stdout: { write: (s) => { out += s; } } });
    assert.ok(out.includes("glm-5.2"), out);
    assert.ok(out.includes("↑"), out);
  });

  it("有裁决+终审数据时打印 hy3 吻合率", async () => {
    const log = [
      { models: ["glm-5.2"], verdict: "true", confirmed: { final: "true", confirmedAt: "t" } },
      { models: ["glm-5.2"], verdict: "false", confirmed: { final: "false", confirmedAt: "t" } },
    ];
    let out = "";
    await progressCli({ load: async () => log, stdout: { write: (s) => { out += s; } } });
    assert.ok(out.includes("吻合率"), out);
  });

  it("无 verdict 时判真/判假列显示无样本，不除零", async () => {
    const log = [
      { models: ["glm-5.2"], confirmed: { final: "true", confirmedAt: "t" } },
    ];
    let out = "";
    await progressCli({ load: async () => log, stdout: { write: (s) => { out += s; } } });
    assert.ok(out.includes("无样本"), out);
    assert.ok(out.includes("拿不准"), out);
  });
});

describe("computeMistakeBreakdown", () => {
  it("空账本/null 返回零结构", () => {
    assert.deepEqual(computeMistakeBreakdown([]), { byType: {}, total: 0, unlabeled: 0 });
    assert.deepEqual(computeMistakeBreakdown(null), { byType: {}, total: 0, unlabeled: 0 });
  });

  it("混合：有类型 + 无类型 + final=true 计数正确", () => {
    const log = [
      { file: "a.js", confirmed: { final: "false", mistakeType: "path-normalized" } },
      { file: "b.js", confirmed: { final: "false", mistakeType: "by-design" } },
      { file: "c.js", confirmed: { final: "false" } },                              // 旧记录无类型 → unlabeled
      { file: "d.js", confirmed: { final: "true", mistakeType: "by-design" } },      // final=true → 不计
    ];
    const b = computeMistakeBreakdown(log);
    assert.equal(b.total, 2);
    assert.equal(b.unlabeled, 1);
    assert.deepEqual(b.byType, { "path-normalized": 1, "by-design": 1 });
  });

  it("单类型全量", () => {
    const log = [
      { file: "a.js", confirmed: { final: "false", mistakeType: "unknown" } },
      { file: "b.js", confirmed: { final: "false", mistakeType: "unknown" } },
    ];
    const b = computeMistakeBreakdown(log);
    assert.deepEqual(b, { byType: { unknown: 2 }, total: 2, unlabeled: 0 });
  });

  it("非法 mistakeType 脏数据计入 unlabeled（不进 byType）", () => {
    const log = [
      { file: "a.js", confirmed: { final: "false", mistakeType: "not-a-real-type" } },
      { file: "b.js", confirmed: { final: "false", mistakeType: "by-design" } },
    ];
    const b = computeMistakeBreakdown(log);
    assert.deepEqual(b.byType, { "by-design": 1 });
    assert.equal(b.unlabeled, 1, "非法类型应计入 unlabeled（fail-closed）");
    assert.equal(b.total, 1);
  });
});

describe("computeAdjudicatorAgreement", () => {
  it("空/null 账本返回全零、agreement 全 null", () => {
    const a = computeAdjudicatorAgreement([]);
    assert.equal(a.samples, 0);
    assert.equal(a.verdictTrue.agreement, null);
    assert.equal(a.verdictFalse.agreement, null);
    assert.equal(a.uncertain.trueRate, null);
  });

  it("verdict=true 全对 → agreement 1", () => {
    const log = [
      { verdict: "true", confirmed: { final: "true" } },
      { verdict: "true", confirmed: { final: "true" } },
    ];
    const a = computeAdjudicatorAgreement(log);
    assert.equal(a.verdictTrue.agreement, 1);
    assert.equal(a.verdictTrue.total, 2);
  });

  it("verdict=true 里 1对1错 → agreement 0.5", () => {
    const log = [
      { verdict: "true", confirmed: { final: "true" } },
      { verdict: "true", confirmed: { final: "false" } },
    ];
    const a = computeAdjudicatorAgreement(log);
    assert.equal(a.verdictTrue.agreement, 0.5);
  });

  it("verdict=false 全对 → agreement 1", () => {
    const log = [{ verdict: "false", confirmed: { final: "false" } }];
    const a = computeAdjudicatorAgreement(log);
    assert.equal(a.verdictFalse.agreement, 1);
  });

  it("verdict=false 判错（漏报）→ agreement 0", () => {
    const log = [{ verdict: "false", confirmed: { final: "true" } }];
    const a = computeAdjudicatorAgreement(log);
    assert.equal(a.verdictFalse.agreement, 0);
  });

  it("uncertain 里一半判真 → trueRate 0.5", () => {
    const log = [
      { verdict: "uncertain", confirmed: { final: "true" } },
      { verdict: "uncertain", confirmed: { final: "false" } },
    ];
    const a = computeAdjudicatorAgreement(log);
    assert.equal(a.uncertain.trueRate, 0.5);
    assert.equal(a.uncertain.trueCount, 1);
  });

  it("verdict 非 true/false（含 undefined/缺失）计入 uncertain", () => {
    const log = [
      { verdict: undefined, confirmed: { final: "true" } },
      { confirmed: { final: "false" } },
    ];
    const a = computeAdjudicatorAgreement(log);
    assert.equal(a.uncertain.total, 2);
  });

  it("只统计已终审的 finding，未终审忽略", () => {
    const log = [
      { verdict: "true", confirmed: { final: "true" } },
      { verdict: "true" },
      { verdict: "true", confirmed: { final: "unconfirmed" } },
    ];
    const a = computeAdjudicatorAgreement(log);
    assert.equal(a.verdictTrue.total, 1);
    assert.equal(a.samples, 1);
  });
});
