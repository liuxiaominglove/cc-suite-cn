import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  matchFindings,
  precision,
  recall,
  f1,
  scoreFindings,
  aggregateByModel,
  parseManifest,
} from "./benchmark-core.mjs";

describe("matchFindings", () => {
  it("exact line match counts as TP", () => {
    const m = matchFindings([{ line: 2 }], [{ line: 2 }]);
    assert.deepEqual(m, { tp: 1, fp: 0, fn: 0 });
  });

  it("line within tolerance counts as TP", () => {
    const m = matchFindings([{ line: 5 }], [{ line: 3 }], { lineTolerance: 2 });
    assert.deepEqual(m, { tp: 1, fp: 0, fn: 0 });
  });

  it("line beyond tolerance counts as FP + FN", () => {
    const m = matchFindings([{ line: 20 }], [{ line: 3 }], { lineTolerance: 2 });
    assert.deepEqual(m, { tp: 0, fp: 1, fn: 1 });
  });

  it("missing expected line never matches (finding without line is FP)", () => {
    const m = matchFindings([{ finding: "x" }], [{ line: 3 }]);
    assert.deepEqual(m, { tp: 0, fp: 1, fn: 1 });
  });

  it("each expected line matches at most once", () => {
    const m = matchFindings([{ line: 3 }, { line: 4 }, { line: 5 }], [{ line: 3 }], { lineTolerance: 2 });
    assert.deepEqual(m, { tp: 1, fp: 2, fn: 0 });
  });

  it("empty found with expected => all FN", () => {
    assert.deepEqual(matchFindings([], [{ line: 1 }, { line: 2 }]), { tp: 0, fp: 0, fn: 2 });
  });

  it("empty expected with found => all FP", () => {
    assert.deepEqual(matchFindings([{ line: 1 }], []), { tp: 0, fp: 1, fn: 0 });
  });

  it("handles null inputs", () => {
    assert.deepEqual(matchFindings(null, null), { tp: 0, fp: 0, fn: 0 });
  });
});

describe("precision / recall / f1", () => {
  it("computes precision", () => {
    assert.equal(precision({ tp: 1, fp: 1 }), 0.5);
    assert.equal(precision({ tp: 0, fp: 0 }), 0);
  });

  it("computes recall", () => {
    assert.equal(recall({ tp: 1, fn: 1 }), 0.5);
    assert.equal(recall({ tp: 0, fn: 0 }), 0);
  });

  it("computes f1", () => {
    assert.equal(f1({ tp: 1, fp: 1, fn: 1 }), 0.5);
    assert.equal(f1({ tp: 0, fp: 0, fn: 0 }), 0);
  });
});

describe("scoreFindings", () => {
  it("returns all metrics", () => {
    const s = scoreFindings([{ line: 2 }], [{ line: 2 }]);
    assert.equal(s.tp, 1);
    assert.equal(s.precision, 1);
    assert.equal(s.recall, 1);
    assert.equal(s.f1, 1);
  });
});

describe("aggregateByModel", () => {
  it("aggregates per model across runs", () => {
    const runs = [
      { model: "glm-5.2", found: [{ line: 2 }], expected: [{ line: 2 }] },
      { model: "glm-5.2", found: [{ line: 99 }], expected: [{ line: 2 }] },
      { model: "kimi-k2.7-code", found: [], expected: [{ line: 2 }] },
    ];
    const agg = aggregateByModel(runs);
    assert.equal(agg["glm-5.2"].tp, 1);
    assert.equal(agg["glm-5.2"].fp, 1);
    assert.equal(agg["glm-5.2"].fn, 1);
    assert.equal(agg["glm-5.2"].precision, 0.5);
    assert.equal(agg["kimi-k2.7-code"].fn, 1);
    assert.equal(agg["kimi-k2.7-code"].recall, 0);
  });

  it("returns empty for empty input", () => {
    assert.deepEqual(aggregateByModel([]), {});
    assert.deepEqual(aggregateByModel(null), {});
  });
});

describe("parseManifest", () => {
  it("parses valid manifest", () => {
    const m = parseManifest('{"fixtures": [{"file": "a.js", "expected": []}]}');
    assert.equal(m.fixtures.length, 1);
  });

  it("throws on invalid JSON", () => {
    assert.throws(() => parseManifest("{ not json"), /not valid JSON/);
  });

  it("throws when missing fixtures array", () => {
    assert.throws(() => parseManifest('{"foo": 1}'), /fixtures/);
  });

  it("returns null for empty input", () => {
    assert.equal(parseManifest(""), null);
  });
});
