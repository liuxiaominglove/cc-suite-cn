import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { coreScriptPaths, selfAudit } from "./self-audit.mjs";

describe("coreScriptPaths", () => {
  it("lists the 15 core non-test scripts", () => {
    const paths = coreScriptPaths();
    assert.equal(paths.length, 15);
    for (const p of paths) {
      assert.match(p, /^scripts\/.+\.mjs$/);
      assert.ok(!p.includes(".test.mjs"), "must not include test files");
    }
    assert.ok(paths.includes("scripts/audit-baseline.mjs"), "自审清单应含 audit-baseline.mjs");
    assert.ok(paths.includes("scripts/verdict-log.mjs"), "自审清单应含 verdict-log.mjs");
    assert.ok(paths.includes("scripts/review-tools.mjs"), "自审清单应含 review-tools.mjs（runModel 核心逻辑）");
    assert.ok(paths.includes("scripts/review-critic.mjs"), "自审清单应含 review-critic.mjs（批判员子流程）");
    assert.ok(paths.includes("scripts/review-context.mjs"), "自审清单应含 review-context.mjs（上下文采集）");
    assert.ok(paths.includes("scripts/review-source.mjs"), "自审清单应含 review-source.mjs（validateFilePath 路径安全）");
    assert.ok(paths.includes("scripts/review-prompts.mjs"), "自审清单应含 review-prompts.mjs（提示词单一数据源）");
  });
});

describe("selfAudit", () => {
  it("runs audit per core script and counts findings", async () => {
    const seen = [];
    const runAuditFn = async ({ file }) => {
      seen.push(file);
      return {
        workers: [
          { model: "glm-5.2", success: true, issues: [{}, {}] },
          { model: "kimi-k2.7-code", success: true, issues: [{}] },
        ],
      };
    };
    const results = await selfAudit({ runAuditFn, scripts: ["review-runner", "backends"] });
    assert.deepEqual(seen, ["scripts/review-runner.mjs", "scripts/backends.mjs"]);
    assert.equal(results[0].count, 3);
    assert.equal(results[1].count, 3);
  });
});
