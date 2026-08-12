import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { suggestWeightAdjustments, generateProposal, applyProposal, checkPending } from "./weight-analyzer.mjs";

const WEIGHTS = {
  models: {
    "glm-5.2": {
      security: { depth: "deep", weight: 0.80 },
      logic: { depth: "deep", weight: 0.80 },
    },
  },
};

const STATS_HIGH_HIT = {
  total_runs: 10,
  models: {
    "glm-5.2": {
      runs: 10,
      total_issues: 20,
      by_focus: { security: 19 },
    },
  },
};

const STATS_LOW_HIT = {
  total_runs: 10,
  models: {
    "glm-5.2": {
      runs: 10,
      total_issues: 20,
      by_focus: { security: 2 },
    },
  },
};

const STATS_FEW = {
  total_runs: 3,
  models: {
    "glm-5.2": { runs: 3, total_issues: 5, by_focus: { security: 5 } },
  },
};

describe("suggestWeightAdjustments", () => {
  it("should suggest weight increase for high hit rate capability", () => {
    const suggestions = suggestWeightAdjustments(WEIGHTS, STATS_HIGH_HIT, { min_samples: 5 });
    const sec = suggestions.find((s) => s.model === "glm-5.2" && s.capability === "security");
    assert.ok(sec, "should have security suggestion");
    assert.equal(sec.direction, "up");
    assert.ok(sec.new_weight > sec.old_weight, "weight should increase");
  });

  it("should suggest weight decrease for low hit rate capability", () => {
    const suggestions = suggestWeightAdjustments(WEIGHTS, STATS_LOW_HIT, { min_samples: 5 });
    const sec = suggestions.find((s) => s.capability === "security");
    assert.ok(sec, "should have security suggestion");
    assert.equal(sec.direction, "down");
    assert.ok(sec.new_weight < sec.old_weight);
  });

  it("should return empty for stats with insufficient data", () => {
    const suggestions = suggestWeightAdjustments(WEIGHTS, STATS_FEW, { min_samples: 5 });
    assert.equal(suggestions.length, 0);
  });

  it("should skip capability with no data in stats", () => {
    const stats = JSON.parse(JSON.stringify(STATS_HIGH_HIT));
    const suggestions = suggestWeightAdjustments(WEIGHTS, stats, { min_samples: 5 });
    const logic = suggestions.find((s) => s.capability === "logic");
    assert.equal(logic, undefined, "logic should be skipped when no data");
  });

  it("should clamp weight to 1.0 when increase would exceed", () => {
    const w = {
      models: { "glm-5.2": { security: { depth: "deep", weight: 0.97 } } },
    };
    const suggestions = suggestWeightAdjustments(w, STATS_HIGH_HIT, { min_samples: 5 });
    const sec = suggestions.find((s) => s.capability === "security");
    assert.ok(sec.new_weight <= 1.0, "should not exceed 1.0");
  });

  it("should clamp weight to 0.1 when decrease would go below", () => {
    const w = {
      models: { "glm-5.2": { security: { depth: "deep", weight: 0.12 } } },
    };
    const suggestions = suggestWeightAdjustments(w, STATS_LOW_HIT, { min_samples: 5 });
    const sec = suggestions.find((s) => s.capability === "security");
    assert.ok(sec.new_weight >= 0.1, "should not go below 0.1");
  });

  it("should show no suggestion for capability at equilibrium", () => {
    const stats = JSON.parse(JSON.stringify(STATS_HIGH_HIT));
    stats.models["glm-5.2"].by_focus.security = 14;
    stats.models["glm-5.2"].total_issues = 20;
    const suggestions = suggestWeightAdjustments(WEIGHTS, stats, { min_samples: 5, threshold: 0.70 });
    const sec = suggestions.find((s) => s.capability === "security");
    assert.equal(sec, undefined, "70% hit rate should be at equilibrium (no change)");
  });
});

const WEEK_OLD = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
const MONTH_OLD = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString();

function makeLogEntry(model, issuesByFocus, timestamp) {
  const issues = [];
  for (const [focus, count] of Object.entries(issuesByFocus)) {
    for (let i = 0; i < count; i++) {
      issues.push({ finding: `${focus} issue`, fix: "...", focus });
    }
  }
  return { timestamp: timestamp || WEEK_OLD, model, file: "test.js", severity: "low", issues, summary: "ok" };
}

describe("generateProposal", () => {
  it("should suggest weight increase for high hit rate with enough data", async () => {
    const log = [];
    for (let i = 0; i < 6; i++) {
      log.push(makeLogEntry("glm-5.2", { security: 8, style: 2 }));
    }
    const proposal = await generateProposal(WEIGHTS, log);
    const sec = proposal.suggestions.find((s) => s.capability === "security");
    assert.ok(sec, "security should have a suggestion");
    assert.equal(sec.direction, "up");
    assert.ok(sec.new_weight > sec.old_weight);
    assert.ok(sec.evidence, "should include evidence field");
    assert.ok(sec.evidence.hit_rate > 0.5, "hit rate should be calculated");
  });

  it("should suggest weight decrease for low hit rate", async () => {
    const log = [];
    for (let i = 0; i < 6; i++) {
      log.push(makeLogEntry("qwen", { security: 1, style: 9 }));
    }
    const w = { models: { "qwen": { security: { depth: "deep", weight: 0.80 }, style: { depth: "deep", weight: 0.80 } } } };
    const proposal = await generateProposal(w, log);
    const sec = proposal.suggestions.find((s) => s.capability === "security");
    assert.ok(sec);
    assert.equal(sec.direction, "down");
  });

  it("should return needs_more_data when no logs in period", async () => {
    const log = [makeLogEntry("glm-5.2", { security: 5 }, MONTH_OLD)];
    const proposal = await generateProposal(WEIGHTS, log);
    assert.equal(proposal.needs_more_data, true);
  });

  it("should return needs_more_data for empty log", async () => {
    const proposal = await generateProposal(WEIGHTS, []);
    assert.equal(proposal.needs_more_data, true);
  });

  it("should mark capability with no data as insufficient", async () => {
    const log = [];
    for (let i = 0; i < 6; i++) {
      log.push(makeLogEntry("glm-5.2", { security: 10 }));
    }
    const proposal = await generateProposal(WEIGHTS, log);
    const logic = proposal.suggestions.find((s) => s.capability === "logic");
    assert.equal(logic, undefined, "logic should not have suggestion without data");
  });

  it("should return empty suggestions when all within threshold", async () => {
    const log = [];
    for (let i = 0; i < 6; i++) {
      log.push(makeLogEntry("glm-5.2", { code_quality: 65, style: 35 }));
    }
    const w = {
      models: {
        "glm-5.2": {
          code_quality: { depth: "deep", weight: 0.70 },
        },
      },
    };
    const proposal = await generateProposal(w, log);
    assert.equal(proposal.suggestions.length, 0);
    assert.equal(proposal.needs_more_data, false);
  });

  it("should filter logs to last 7 days only", async () => {
    const recent = makeLogEntry("glm-5.2", { security: 5 });
    const old = makeLogEntry("glm-5.2", { security: 5 }, MONTH_OLD);
    const log = [old, recent];
    const proposal = await generateProposal(WEIGHTS, log);
    assert.equal(proposal.period_total_runs, 1, "should only count recent entry");
  });
});

describe("applyProposal", () => {
  it("should apply all approved suggestions full batch", () => {
    const w = JSON.parse(JSON.stringify(WEIGHTS));
    const approved = [
      { model: "glm-5.2", capability: "security", new_weight: 0.85 },
    ];
    const result = applyProposal(w, approved);
    assert.equal(result.weights.models["glm-5.2"].security.weight, 0.85);
    assert.ok(result.weights.last_adjusted);
  });

  it("should apply only approved suggestions when partial batch", () => {
    const w = JSON.parse(JSON.stringify(WEIGHTS));
    w.last_adjusted = null;
    const approved = [{ model: "glm-5.2", capability: "security", new_weight: 0.85 }];
    const result = applyProposal(w, approved);
    assert.equal(result.weights.models["glm-5.2"].security.weight, 0.85);
    assert.equal(result.weights.models["glm-5.2"].logic.weight, 0.80, "logic should not change");
  });

  it("should clear pending_proposal after apply", () => {
    const w = JSON.parse(JSON.stringify(WEIGHTS));
    w.pending_proposal = { suggestions: [{ model: "glm-5.2", capability: "security", new_weight: 0.85 }] };
    const result = applyProposal(w, [{ model: "glm-5.2", capability: "security", new_weight: 0.85 }]);
    assert.equal(result.weights.pending_proposal, null);
  });

  it("should keep pending proposal if all rejected", () => {
    const w = JSON.parse(JSON.stringify(WEIGHTS));
    w.pending_proposal = { suggestions: [{ model: "glm-5.2", capability: "security", new_weight: 0.85 }] };
    const result = applyProposal(w, []);
    assert.equal(result.weights.pending_proposal, null, "should clear even when all rejected");
  });

  it("should clamp approved weight to 1.0", () => {
    const w = JSON.parse(JSON.stringify(WEIGHTS));
    const result = applyProposal(w, [{ model: "glm-5.2", capability: "security", new_weight: 1.5 }]);
    assert.equal(result.weights.models["glm-5.2"].security.weight, 1.0);
  });

  it("should clamp approved weight to 0.1", () => {
    const w = JSON.parse(JSON.stringify(WEIGHTS));
    const result = applyProposal(w, [{ model: "glm-5.2", capability: "security", new_weight: 0.01 }]);
    assert.equal(result.weights.models["glm-5.2"].security.weight, 0.1);
  });

  it("should preserve existing last_adjusted on reject", () => {
    const w = JSON.parse(JSON.stringify(WEIGHTS));
    w.last_adjusted = "2026-01-01T00:00:00Z";
    const result = applyProposal(w, []);
    assert.equal(result.weights.last_adjusted, "2026-01-01T00:00:00Z");
  });
});

describe("checkPending", () => {
  it("should flag overdue pending proposal as needs_review", () => {
    const w = JSON.parse(JSON.stringify(WEIGHTS));
    w.pending_proposal = { suggestions: [{ model: "glm-5.2", capability: "security", new_weight: 0.85 }] };
    w.last_adjusted = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString();
    const result = checkPending(w);
    assert.equal(result.needs_review, true);
    assert.ok(result.overdue_days > 0);
  });

  it("should return needs_review false when no pending", () => {
    const w = JSON.parse(JSON.stringify(WEIGHTS));
    w.pending_proposal = null;
    const result = checkPending(w);
    assert.equal(result.needs_review, false);
  });

  it("should flag stale when last_adjusted is over 7 days and no pending", () => {
    const w = JSON.parse(JSON.stringify(WEIGHTS));
    w.last_adjusted = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString();
    w.pending_proposal = null;
    const result = checkPending(w);
    assert.equal(result.stale, true);
  });

  it("should not flag stale when last_adjusted is recent", () => {
    const w = JSON.parse(JSON.stringify(WEIGHTS));
    w.last_adjusted = new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString();
    const result = checkPending(w);
    assert.equal(result.stale, false);
  });

  it("should not flag needs_review when pending is from today", () => {
    const w = JSON.parse(JSON.stringify(WEIGHTS));
    w.pending_proposal = { suggestions: [] };
    w.last_adjusted = new Date().toISOString();
    const result = checkPending(w);
    assert.equal(result.needs_review, false);
  });
});

describe("applyProposal integrity", () => {
  it("should skip approved items not in pending_proposal suggestions", () => {
    const w = JSON.parse(JSON.stringify(WEIGHTS));
    w.pending_proposal = {
      suggestions: [{ model: "glm-5.2", capability: "security", new_weight: 0.85 }],
    };
    const approved = [
      { model: "glm-5.2", capability: "security", new_weight: 0.85 },
      { model: "glm-5.2", capability: "logic", new_weight: 0.99 },
    ];
    const result = applyProposal(w, approved);
    assert.equal(result.weights.models["glm-5.2"].security.weight, 0.85);
    assert.equal(result.weights.models["glm-5.2"].logic.weight, 0.80, "logic should not change");
    assert.equal(result.applied, 1, "only 1 item should be applied (security)");
  });
});
