import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { splitByBatch, fpRate, computeProgress, progressCli } from "./progress.mjs";

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
});
