import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { WORKERS, MODEL_ALIASES, canonicalModel, isWorkerModel, FIND_BUG_WORKERS, CRITIC_MODEL, VERIFIER_MODEL } from "./models.mjs";

describe("WORKERS", () => {
  it("defines exactly 4 workers with correct backends and models", () => {
    assert.equal(WORKERS.length, 4);
    assert.deepEqual(
      WORKERS.map((w) => `${w.backend}/${w.model}`),
      ["codebuddy/glm-5.3", "codebuddy/hy4-preview", "kimi/kimi-k3", "qwen/qwen3.8-max"]
    );
  });

  it("has no duplicate model ids", () => {
    const ids = WORKERS.map((w) => w.model);
    assert.equal(new Set(ids).size, ids.length);
  });
});

describe("canonicalModel", () => {
  it("maps legacy alias to canonical name", () => {
    assert.equal(canonicalModel("custom-local:qwen-coder-plus"), "qwen3.8-max");
    assert.equal(canonicalModel("qwen-coder-plus"), "qwen3.8-max");
  });

  it("returns canonical names unchanged", () => {
    assert.equal(canonicalModel("qwen3.8-max"), "qwen3.8-max");
    assert.equal(canonicalModel("glm-5.3"), "glm-5.3");
  });
});

describe("isWorkerModel", () => {
  it("recognizes canonical worker models", () => {
    assert.equal(isWorkerModel("glm-5.3"), true);
    assert.equal(isWorkerModel("qwen3.8-max"), true);
  });

  it("rejects non-worker models", () => {
    assert.equal(isWorkerModel("deepseek-v4-pro"), false);
    assert.equal(isWorkerModel("custom-local:qwen-coder-plus"), false);
  });
});

describe("role constants", () => {
  it("defines find-bug workers as glm + kimi", () => {
    assert.deepEqual(
      FIND_BUG_WORKERS.map((w) => `${w.backend}/${w.model}`),
      ["codebuddy/glm-5.3", "kimi/kimi-k3"]
    );
  });

  it("defines critic and verifier models", () => {
    assert.equal(CRITIC_MODEL, "qwen3.8-max");
    assert.equal(VERIFIER_MODEL, "hy4-preview");
  });

  it("keeps roles mutually exclusive", () => {
    const findModels = FIND_BUG_WORKERS.map((w) => w.model);
    assert.ok(!findModels.includes(CRITIC_MODEL), "critic should not also be a find-bug worker");
    assert.ok(!findModels.includes(VERIFIER_MODEL), "verifier should not also be a find-bug worker");
    assert.notEqual(CRITIC_MODEL, VERIFIER_MODEL, "critic and verifier must differ");
  });

  it("find-bug workers are a subset of WORKERS", () => {
    const workerKeys = new Set(WORKERS.map((w) => `${w.backend}/${w.model}`));
    for (const w of FIND_BUG_WORKERS) {
      assert.ok(workerKeys.has(`${w.backend}/${w.model}`), `${w.model} should be in WORKERS`);
    }
  });
});
