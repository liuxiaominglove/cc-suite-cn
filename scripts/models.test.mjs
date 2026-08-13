import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { WORKERS, MODEL_ALIASES, canonicalModel, isWorkerModel } from "./models.mjs";

describe("WORKERS", () => {
  it("defines exactly 4 workers with correct backends and models", () => {
    assert.equal(WORKERS.length, 4);
    assert.deepEqual(
      WORKERS.map((w) => `${w.backend}/${w.model}`),
      ["codebuddy/glm-5.2", "codebuddy/hy3", "kimi/kimi-k2.7-code", "qwen/qwen3-coder-plus"]
    );
  });

  it("has no duplicate model ids", () => {
    const ids = WORKERS.map((w) => w.model);
    assert.equal(new Set(ids).size, ids.length);
  });
});

describe("canonicalModel", () => {
  it("maps legacy alias to canonical name", () => {
    assert.equal(canonicalModel("custom-local:qwen-coder-plus"), "qwen3-coder-plus");
    assert.equal(canonicalModel("qwen-coder-plus"), "qwen3-coder-plus");
  });

  it("returns canonical names unchanged", () => {
    assert.equal(canonicalModel("qwen3-coder-plus"), "qwen3-coder-plus");
    assert.equal(canonicalModel("glm-5.2"), "glm-5.2");
  });
});

describe("isWorkerModel", () => {
  it("recognizes canonical worker models", () => {
    assert.equal(isWorkerModel("glm-5.2"), true);
    assert.equal(isWorkerModel("qwen3-coder-plus"), true);
  });

  it("rejects non-worker models", () => {
    assert.equal(isWorkerModel("deepseek-v4-pro"), false);
    assert.equal(isWorkerModel("custom-local:qwen-coder-plus"), false);
  });
});

describe("weights.json consistency", () => {
  it("every model key canonicalizes to a worker model", async () => {
    const raw = await readFile("./.opencode/skills/cc-review/weights.json", "utf-8");
    const weights = JSON.parse(raw);
    for (const modelId of Object.keys(weights.models)) {
      assert.equal(isWorkerModel(canonicalModel(modelId)), true, `weights.json key "${modelId}" is not a known worker model`);
    }
  });

  it("contains no legacy alias keys (all keys must be canonical)", async () => {
    const raw = await readFile("./.opencode/skills/cc-review/weights.json", "utf-8");
    const weights = JSON.parse(raw);
    for (const modelId of Object.keys(weights.models)) {
      assert.equal(canonicalModel(modelId), modelId, `weights.json key "${modelId}" is a legacy alias — rename to "${canonicalModel(modelId)}"`);
    }
  });
});
