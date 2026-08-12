import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { adjustWeightsFromBenchmarks } from "./weekly-sync.mjs";

const WEIGHTS = {
  models: {
    "glm-5.2": {
      security: { depth: "deep", weight: 0.80 },
      logic: { depth: "deep", weight: 0.80 },
    },
  },
};

const PREVIOUS_BENCHMARKS = {
  "glm-5.2": { swe_bench: 57, security_score: 82 },
};

function makeBenchmark(model, swe_bench, security_score) {
  return { [model]: { swe_bench, security_score } };
}

describe("adjustWeightsFromBenchmarks", () => {
  it("should update weights when benchmark improved significantly", () => {
    const current = makeBenchmark("glm-5.2", 62, 88);
    const result = adjustWeightsFromBenchmarks(WEIGHTS, current, PREVIOUS_BENCHMARKS);
    const sec = result.suggestions.find((s) => s.capability === "security");
    assert.ok(sec, "security should be suggested to increase");
    assert.equal(sec.direction, "up");
  });

  it("should decrease weights when benchmark regressed", () => {
    const current = makeBenchmark("glm-5.2", 52, 76);
    const result = adjustWeightsFromBenchmarks(WEIGHTS, current, PREVIOUS_BENCHMARKS);
    const logic = result.suggestions.find((s) => s.capability === "logic");
    assert.ok(logic);
    assert.equal(logic.direction, "down");
  });

  it("should not suggest changes when benchmark is stable", () => {
    const current = makeBenchmark("glm-5.2", 57, 82);
    const result = adjustWeightsFromBenchmarks(WEIGHTS, current, PREVIOUS_BENCHMARKS);
    assert.equal(result.suggestions.length, 0);
  });

  it("should handle empty benchmark result gracefully", () => {
    const result = adjustWeightsFromBenchmarks(WEIGHTS, {}, PREVIOUS_BENCHMARKS);
    assert.equal(result.stale, true);
    assert.equal(result.suggestions.length, 0);
  });

  it("should save only on first run without previous data", () => {
    const current = makeBenchmark("glm-5.2", 62, 88);
    const result = adjustWeightsFromBenchmarks(WEIGHTS, current, null);
    assert.equal(result.first_run, true);
    assert.equal(result.suggestions.length, 0);
  });

  it("should clamp single weight change to max permitted", () => {
    const current = makeBenchmark("glm-5.2", 97, 98);
    const result = adjustWeightsFromBenchmarks(WEIGHTS, current, PREVIOUS_BENCHMARKS);
    for (const s of result.suggestions) {
      const delta = Math.abs(s.new_weight - s.old_weight);
      assert.ok(delta <= 0.15, `weight change ${delta} should be ≤ 0.15`);
    }
  });

  it("should handle model not present in current benchmarks", () => {
    const result = adjustWeightsFromBenchmarks(WEIGHTS, {}, PREVIOUS_BENCHMARKS);
    assert.equal(result.stale, true);
  });
});
