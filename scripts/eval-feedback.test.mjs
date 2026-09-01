import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeFeedbackWeights } from "./eval-feedback.mjs";

describe("computeFeedbackWeights", () => {
  it("空/null → 空对象", () => {
    assert.deepEqual(computeFeedbackWeights([]), {});
    assert.deepEqual(computeFeedbackWeights(null), {});
  });

  it("按模型+类型计数归一化", () => {
    const log = [
      { models: ["glm-5.2"], confirmed: { final: "false", mistakeType: "path-normalized" } },
      { models: ["glm-5.2"], confirmed: { final: "false", mistakeType: "path-normalized" } },
      { models: ["glm-5.2"], confirmed: { final: "false", mistakeType: "by-design" } },
    ];
    const w = computeFeedbackWeights(log);
    assert.equal(w["glm-5.2"]["path-normalized"], 2 / 3);
    assert.equal(w["glm-5.2"]["by-design"], 1 / 3);
  });

  it("final=true 不计入（权重只用终审真值）", () => {
    const log = [
      { models: ["glm-5.2"], confirmed: { final: "true", mistakeType: "by-design" } },
      { models: ["glm-5.2"], confirmed: { final: "false", mistakeType: "by-design" } },
    ];
    const w = computeFeedbackWeights(log);
    assert.equal(w["glm-5.2"]["by-design"], 1);
  });

  it("无/非法 mistakeType 计入 total 但不产生权重（fail-closed）", () => {
    const log = [
      { models: ["glm-5.2"], confirmed: { final: "false" } },
      { models: ["glm-5.2"], confirmed: { final: "false", mistakeType: "garbage" } },
      { models: ["glm-5.2"], confirmed: { final: "false", mistakeType: "by-design" } },
    ];
    const w = computeFeedbackWeights(log);
    assert.deepEqual(w["glm-5.2"], { "by-design": 1 / 3 });
  });

  it("多模型隔离", () => {
    const log = [
      { models: ["glm-5.2"], confirmed: { final: "false", mistakeType: "by-design" } },
      { models: ["kimi-k2.7-code"], confirmed: { final: "false", mistakeType: "path-normalized" } },
    ];
    const w = computeFeedbackWeights(log);
    assert.deepEqual(w["glm-5.2"], { "by-design": 1 });
    assert.deepEqual(w["kimi-k2.7-code"], { "path-normalized": 1 });
  });

  it("无合法 mistakeType 的模型 → 空权重对象", () => {
    const log = [{ models: ["glm-5.2"], confirmed: { final: "false" } }];
    const w = computeFeedbackWeights(log);
    assert.deepEqual(w["glm-5.2"], {});
  });
});
