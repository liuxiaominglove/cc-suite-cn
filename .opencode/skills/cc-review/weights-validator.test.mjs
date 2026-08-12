import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateWeights } from "./weights-validator.mjs";

const VALID_WEIGHTS = {
  version: "1.0",
  last_adjusted: "2026-08-12T10:00:00Z",
  pending_proposal: null,
  last_adjusted: "2026-08-12T10:00:00Z",
  pending_proposal: null,
  models: {
    "glm-5.2": {
      security: { depth: "deep", weight: 0.8 },
      logic: { depth: "deep", weight: 0.8 },
      code_quality: { depth: "standard", weight: 0.5 },
      style: { depth: "light", weight: 0.3 },
    },
    "custom-local:qwen-coder-plus": {
      security: { depth: "light", weight: 0.3 },
      logic: { depth: "standard", weight: 0.4 },
      code_quality: { depth: "deep", weight: 0.8 },
      style: { depth: "deep", weight: 0.8 },
    },
  },
};

describe("validateWeights", () => {
  it("should return valid for a complete weight config", () => {
    const result = validateWeights(VALID_WEIGHTS);
    assert.equal(result.valid, true);
  });

  it("should reject config missing models field", () => {
    const result = validateWeights({ version: "1.0" });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("models")));
  });

  it("should reject model with no capabilities", () => {
    const config = { ...VALID_WEIGHTS, models: { "glm-5.2": {} } };
    const result = validateWeights(config);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("glm-5.2")));
  });

  it("should reject weight above 1.0", () => {
    const config = JSON.parse(JSON.stringify(VALID_WEIGHTS));
    config.models["glm-5.2"].security.weight = 1.5;
    const result = validateWeights(config);
    assert.equal(result.valid, false);
  });

  it("should reject negative weight", () => {
    const config = JSON.parse(JSON.stringify(VALID_WEIGHTS));
    config.models["glm-5.2"].security.weight = -0.3;
    const result = validateWeights(config);
    assert.equal(result.valid, false);
  });

  it("should reject invalid depth level", () => {
    const config = JSON.parse(JSON.stringify(VALID_WEIGHTS));
    config.models["glm-5.2"].security.depth = "ultra";
    const result = validateWeights(config);
    assert.equal(result.valid, false);
  });

  it("should reject empty object", () => {
    const result = validateWeights({});
    assert.equal(result.valid, false);
  });

  it("should accept weight of 0.0", () => {
    const config = JSON.parse(JSON.stringify(VALID_WEIGHTS));
    config.models["glm-5.2"].style.weight = 0;
    const result = validateWeights(config);
    assert.equal(result.valid, true);
  });

  it("should accept weight of 1.0", () => {
    const config = JSON.parse(JSON.stringify(VALID_WEIGHTS));
    config.models["glm-5.2"].security.weight = 1.0;
    const result = validateWeights(config);
    assert.equal(result.valid, true);
  });

  it("should reject unknown capability name", () => {
    const config = JSON.parse(JSON.stringify(VALID_WEIGHTS));
    config.models["glm-5.2"].securty = { depth: "deep", weight: 0.9 };
    const result = validateWeights(config);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("unknown capability")));
  });

  it("should return errors array directly without redundant ternary", () => {
    const result = validateWeights(VALID_WEIGHTS);
    assert.ok(Array.isArray(result.errors));
    assert.equal(result.errors.length, 0);
  });

  it("should accept config with last_adjusted timestamp", () => {
    const config = JSON.parse(JSON.stringify(VALID_WEIGHTS));
    config.last_adjusted = "2026-08-12T10:00:00Z";
    const result = validateWeights(config);
    assert.equal(result.valid, true);
  });

  it("should accept config with pending_proposal set to null", () => {
    const config = JSON.parse(JSON.stringify(VALID_WEIGHTS));
    config.pending_proposal = null;
    const result = validateWeights(config);
    assert.equal(result.valid, true);
  });

  it("should accept old-format config without last_adjusted field", () => {
    const config = JSON.parse(JSON.stringify(VALID_WEIGHTS));
    delete config.last_adjusted;
    delete config.pending_proposal;
    const result = validateWeights(config);
    assert.equal(result.valid, true);
  });
});
