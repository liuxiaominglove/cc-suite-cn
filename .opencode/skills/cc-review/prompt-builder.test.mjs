import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildPrompt, cli } from "./prompt-builder.mjs";

const WEIGHTS = {
  version: "1.0",
  models: {
    "glm-5.2": {
      security: { depth: "deep", weight: 0.80 },
      logic: { depth: "deep", weight: 0.60 },
      code_quality: { depth: "standard", weight: 0.50 },
      style: { depth: "light", weight: 0.30 },
    },
    "custom-local:qwen-coder-plus": {
      security: { depth: "light", weight: 0.30 },
      logic: { depth: "standard", weight: 0.40 },
      code_quality: { depth: "deep", weight: 0.80 },
      style: { depth: "deep", weight: 0.80 },
    },
  },
};

describe("buildPrompt", () => {
  it("should include effort unit allocation intro", () => {
    const p = buildPrompt(WEIGHTS, "glm-5.2");
    assert.ok(p.includes("units of"), "should mention units of effort");
  });

  it("should convert weight to effort units (weight × 100)", () => {
    const p = buildPrompt(WEIGHTS, "glm-5.2");
    assert.ok(p.includes("80 units"), "0.80 → 80 units");
    assert.ok(p.includes("60 units"), "0.60 → 60 units");
    assert.ok(p.includes("50 units"), "0.50 → 50 units");
    assert.ok(p.includes("30 units"), "0.30 → 30 units");
  });

  it("should sort capabilities by units descending", () => {
    const p = buildPrompt(WEIGHTS, "glm-5.2");
    const pos80 = p.indexOf("80 units");
    const pos60 = p.indexOf("60 units");
    assert.ok(pos80 < pos60, "80 units should appear before 60 units");
  });

  it("should include depth-specific review instructions for deep", () => {
    const p = buildPrompt(WEIGHTS, "glm-5.2");
    assert.ok(p.includes("every line"), "deep should mention thoroughness");
  });

  it("should include depth-specific review instructions for standard", () => {
    const p = buildPrompt(WEIGHTS, "glm-5.2");
    assert.ok(p.includes("common"), "standard should mention focused check");
  });

  it("should include depth-specific review instructions for light", () => {
    const p = buildPrompt(WEIGHTS, "glm-5.2");
    assert.ok(p.includes("quick"), "light should mention quick scan");
  });

  it("should generate different effort allocation for Qwen", () => {
    const p = buildPrompt(WEIGHTS, "custom-local:qwen-coder-plus");
    assert.ok(p.includes("80 units"), "Qwen should have 80 unit capabilities");
    const secPos = p.indexOf("Security");
    const qualPos = p.indexOf("Code Quality");
    assert.ok(qualPos < secPos, "Qwen: Code Quality (80) should come before Security (30)");
  });

  it("should omit tier sections with no capabilities", () => {
    const w = JSON.parse(JSON.stringify(WEIGHTS));
    delete w.models["glm-5.2"].security;
    delete w.models["glm-5.2"].logic;
    const p = buildPrompt(w, "glm-5.2");
    assert.ok(!p.includes("every line"), "deep section should not appear");
  });

  it("should include JSON output format instruction", () => {
    const p = buildPrompt(WEIGHTS, "glm-5.2");
    assert.ok(p.includes("JSON"), "should require JSON output");
    assert.ok(p.includes("focus"), "should include focus field");
  });

  it("should handle all-zero weights gracefully", () => {
    const w = JSON.parse(JSON.stringify(WEIGHTS));
    for (const c of Object.keys(w.models["glm-5.2"])) {
      w.models["glm-5.2"][c].weight = 0;
    }
    const p = buildPrompt(w, "glm-5.2");
    assert.ok(p.includes("JSON"), "should still include JSON instruction");
  });

  it("should throw for unknown model", () => {
    assert.throws(() => buildPrompt(WEIGHTS, "unknown"), { message: /unknown/i });
  });
});
