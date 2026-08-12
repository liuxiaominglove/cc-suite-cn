import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { appendAuditEntry, computeStats, fromReviewResult } from "./audit-logger.mjs";

function makeEntry(overrides = {}) {
  return {
    timestamp: "2026-08-12T10:00:00Z",
    model: "glm-5.2",
    file: "demos/test.js",
    success: true,
    severity: "high",
    issues: [
      { finding: "SQL injection", fix: "parameterize", focus: "security" },
      { finding: "No validation", fix: "add guards", focus: "code_quality" },
    ],
    summary: "Found issues",
    ...overrides,
  };
}

describe("audit-logger", () => {
  it("should append first entry to empty log", () => {
    const entry = makeEntry();
    const log = appendAuditEntry([], entry);
    assert.equal(log.length, 1);
    assert.equal(log[0].model, "glm-5.2");
  });

  it("should append multiple entries preserving order", () => {
    let log = [];
    log = appendAuditEntry(log, makeEntry({ model: "A" }));
    log = appendAuditEntry(log, makeEntry({ model: "B" }));
    log = appendAuditEntry(log, makeEntry({ model: "C" }));
    assert.equal(log.length, 3);
    assert.equal(log[0].model, "A");
    assert.equal(log[2].model, "C");
  });

  it("should compute hit rate per model", () => {
    const log = [
      makeEntry({ model: "glm-5.2" }),
      makeEntry({ model: "glm-5.2", issues: [] }),
      makeEntry({ model: "qwen", issues: [{ finding: "xss", fix: "...", focus: "security" }] }),
    ];
    const stats = computeStats(log);
    assert.ok(stats.models["glm-5.2"], "should have glm-5.2 stats");
    assert.equal(stats.models["glm-5.2"].total_issues, 2);
    assert.equal(stats.models["glm-5.2"].avg_issues_per_run, 1);
  });

  it("should group stats by focus area", () => {
    const log = [
      makeEntry({ model: "glm-5.2", issues: [
        { finding: "a", fix: "x", focus: "security" },
        { finding: "b", fix: "x", focus: "security" },
        { finding: "c", fix: "x", focus: "code_quality" },
      ]}),
    ];
    const stats = computeStats(log);
    const focus = stats.models["glm-5.2"].by_focus;
    assert.equal(focus.security, 2);
    assert.equal(focus.code_quality, 1);
  });

  it("should handle entry with empty issues array", () => {
    const log = [makeEntry({ issues: [] })];
    const stats = computeStats(log);
    assert.equal(stats.models["glm-5.2"].total_issues, 0);
  });

  it("should reject entry missing timestamp", () => {
    assert.throws(() => appendAuditEntry([], { model: "x" }), {
      message: /timestamp/i,
    });
  });

  it("should return zero totals for empty log", () => {
    const stats = computeStats([]);
    assert.equal(stats.total_runs, 0);
    assert.equal(stats.total_issues, 0);
    assert.deepEqual(stats.models, {});
  });

  it("should convert review result to audit log entry with focus fields", () => {
    const reviewResult = {
      model: "glm-5.2",
      success: true,
      severity: "high",
      issues: [
        { file: "test.js", line: 1, finding: "SQL injection", fix: "...", focus: "security" },
        { file: "test.js", line: 5, finding: "Bad name", fix: "...", focus: "style" },
      ],
      summary: "Found issues",
    };

    const entry = fromReviewResult(reviewResult, "demos/test.js");
    assert.equal(entry.model, "glm-5.2");
    assert.ok(entry.timestamp, "should have timestamp");
    assert.equal(entry.issues.length, 2);
    assert.equal(entry.issues[0].focus, "security");
    assert.equal(entry.issues[1].focus, "style");
    assert.equal(entry.file, "demos/test.js");
  });

  it("should reject entry with invalid timestamp", () => {
    assert.throws(() => appendAuditEntry([], { timestamp: "yesterday", model: "x" }), {
      message: /timestamp|invalid/i,
    });
  });

  it("should exclude entries without model from total_runs in stats", () => {
    const log = [
      makeEntry({ model: "glm-5.2" }),
      { timestamp: "2026-08-12T10:00:00Z" },
      makeEntry({ model: "qwen" }),
    ];
    const stats = computeStats(log);
    assert.equal(stats.total_runs, 2, "should only count entries with a model");
  });

  it("should preserve issue-level file and line fields", () => {
    const reviewResult = {
      model: "glm-5.2",
      success: true,
      severity: "low",
      issues: [
        { file: "src/auth.js", line: 5, finding: "bad login", fix: "...", focus: "security" },
        { file: "src/util.js", line: 12, finding: "bad name", fix: "...", focus: "style" },
      ],
      summary: "ok",
    };

    const entry = fromReviewResult(reviewResult, "main.js");
    assert.equal(entry.issues[0].file, "src/auth.js", "should keep per-issue file");
    assert.equal(entry.issues[0].line, 5, "should keep per-issue line");
    assert.equal(entry.issues[1].line, 12);
  });
});
