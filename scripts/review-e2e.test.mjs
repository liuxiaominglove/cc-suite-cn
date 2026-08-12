import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { review } from "./review-runner.mjs";
import { readFile } from "node:fs/promises";

const RUNNER_CODE = await readFile("./scripts/review-runner.mjs", "utf-8");

describe("e2e - real CodeBuddy multi-model review", { timeout: 420000 }, () => {

  it("should return valid results from DeepSeek", async () => {
    const result = await review({
      model: "deepseek-v4-pro",
      code: RUNNER_CODE,
      customPrompt: "Review this code briefly. Find 1-2 issues if any. Output as JSON: {\"issues\":[{\"finding\":\"...\",\"fix\":\"...\"}],\"summary\":\"...\"}",
      timeout: 180000,
    });

    assert.equal(result.model, "deepseek-v4-pro");
    assert.equal(result.success, true);
    assert.ok(typeof result.summary === "string", "summary should be a string");
    assert.ok(result.summary.length > 0, "summary should not be empty");
    console.log(`  DeepSeek summary: ${result.summary.slice(0, 100)}...`);
  });

  it("should return valid results from Qwen", async () => {
    const result = await review({
      model: "qwen-coder-plus",
      code: RUNNER_CODE,
      customPrompt: "Review this code briefly. Find 1-2 issues if any. Output as JSON: {\"issues\":[{\"finding\":\"...\",\"fix\":\"...\"}],\"summary\":\"...\"}",
      timeout: 180000,
    });

    assert.equal(result.model, "qwen-coder-plus");
    assert.equal(result.success, true);
    assert.ok(typeof result.summary === "string", "summary should be a string");
    assert.ok(result.summary.length > 0, "summary should not be empty");
    console.log(`  Qwen summary: ${result.summary.slice(0, 100)}...`);
  });

  it("should produce different perspectives from the two models", async () => {
    const [deepseek, qwen] = await Promise.all([
      review({
        model: "deepseek-v4-pro",
        code: RUNNER_CODE,
      customPrompt: "Find 1 bug or improvement in this code. Output JSON: {\"issues\":[{\"finding\":\"...\"}],\"summary\":\"...\"}",
        timeout: 180000,
      }),
      review({
        model: "qwen-coder-plus",
        code: RUNNER_CODE,
        customPrompt: "Find 1 bug or improvement in this code. Output JSON: {\"issues\":[{\"finding\":\"...\"}],\"summary\":\"...\"}",
        timeout: 180000,
      }),
    ]);

    assert.equal(deepseek.success, true);
    assert.equal(qwen.success, true);

    const dsFindings = deepseek.issues.map(i => i.finding?.toLowerCase() || "").join(" ");
    const qwFindings = qwen.issues.map(i => i.finding?.toLowerCase() || "").join(" ");

    console.log(`  DeepSeek raw issues: ${JSON.stringify(deepseek.issues)}`);
    console.log(`  Qwen raw issues: ${JSON.stringify(qwen.issues)}`);
    console.log(`  DeepSeek summary: ${deepseek.summary.slice(0, 150)}`);
    console.log(`  Qwen summary: ${qwen.summary.slice(0, 150)}`);

    // At least one model should find something
    const totalFindings = deepseek.issues.length + qwen.issues.length;
    assert.ok(totalFindings > 0, "At least one model should report a finding");

    // If both found issues, they should differ (perspective divergence)
    if (deepseek.issues.length > 0 && qwen.issues.length > 0) {
      assert.notEqual(dsFindings, qwFindings, "The two models should have different findings");
    } else {
      console.log("  NOTE: One model found issues the other missed — this is the value of multi-model review.");
    }
  });
});
