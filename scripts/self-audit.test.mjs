import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { coreScriptPaths, selfAudit } from "./self-audit.mjs";

describe("coreScriptPaths", () => {
  it("lists the 8 core non-test scripts", () => {
    const paths = coreScriptPaths();
    assert.equal(paths.length, 8);
    for (const p of paths) {
      assert.match(p, /^scripts\/.+\.mjs$/);
      assert.ok(!p.includes(".test.mjs"), "must not include test files");
    }
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
