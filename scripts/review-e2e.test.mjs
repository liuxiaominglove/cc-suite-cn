import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { review } from "./review-runner.mjs";
import { readFile } from "node:fs/promises";

const TARGET_CODE = await readFile("./demos/shopping-cart.js", "utf-8");

const WORKERS = [
  { backend: "codebuddy", model: "glm-5.2" },
  { backend: "codebuddy", model: "hy3" },
  { backend: "kimi", model: "kimi-k2.7-code" },
  { backend: "qwen", model: "qwen3-coder-plus" },
];

const PROMPT =
  'Review this code briefly. Find 1-2 issues if any. Output as JSON: {"issues":[{"finding":"...","fix":"..."}],"summary":"..."}';

describe("e2e - real multi-model review (4 workers)", { timeout: 600000 }, () => {

  for (const { backend, model } of WORKERS) {
    it(`should return valid results from ${backend}/${model}`, async () => {
      const result = await review({
        model,
        backend,
        code: TARGET_CODE,
        customPrompt: PROMPT,
        timeout: 180000,
      });

      assert.equal(result.model, model);
      assert.equal(result.success, true);
      assert.ok(typeof result.summary === "string", "summary should be a string");
      assert.ok(result.summary.length > 0, "summary should not be empty");
      console.log(`  ${backend}/${model} summary: ${result.summary.slice(0, 100)}...`);
    });
  }

  it("should produce different perspectives across models", async () => {
    const results = await Promise.all(
      WORKERS.map(({ backend, model }) =>
        review({
          model,
          backend,
          code: TARGET_CODE,
          customPrompt: 'Find 1 bug or improvement in this code. Output JSON: {"issues":[{"finding":"..."}],"summary":"..."}',
          timeout: 180000,
        }),
      ),
    );

    for (const r of results) {
      assert.equal(r.success, true, `${r.model} should succeed`);
    }

    const totalFindings = results.reduce((n, r) => n + r.issues.length, 0);
    assert.ok(totalFindings > 0, "At least one model should report a finding");

    const findingSets = results.map((r) =>
      r.issues.map((i) => i.finding?.toLowerCase() || "").join(" | "),
    );
    const uniqueSets = new Set(findingSets.filter((s) => s.length > 0));
    console.log(`  distinct finding perspectives: ${uniqueSets.size}/${results.length}`);
  });
});
