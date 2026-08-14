import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { normalizeFinding, dice, findingMatches, classifyConsensus, buildAdjudicatorPrompt, parseVerdict, adjudicate, evaluateModels, ADJUDICATE_TIMEOUT, extractContext } from "./evaluate-models.mjs";
import { setSpawn } from "./runner-core.mjs";

afterEach(() => setSpawn(null));

function mockProc(stdout = "", { exitCode = 0, stderr = "" } = {}) {
  const stdoutStream = new EventEmitter();
  const stderrStream = new EventEmitter();
  const events = new EventEmitter();
  const proc = {
    stdout: stdoutStream,
    stderr: stderrStream,
    on: (e, cb) => { events.on(e, cb); return proc; },
    kill: () => {},
    removeListener: () => proc,
    stdin: { write: () => {}, end: () => {} },
  };
  const close = () => {
    if (stdout) stdoutStream.emit("data", Buffer.from(stdout));
    stdoutStream.emit("end");
    if (stderr) stderrStream.emit("data", Buffer.from(stderr));
    stderrStream.emit("end");
    events.emit("close", exitCode, null);
  };
  proc.stdin = {
    write: (d) => { proc.stdinWritten = d; },
    end: () => {},
  };
  setImmediate(close);
  return proc;
}

describe("normalizeFinding", () => {
  it("lowercases and extracts ascii word tokens", () => {
    const t = normalizeFinding("SQL Injection!");
    assert.ok(t.includes("sql"));
    assert.ok(t.includes("injection"));
    assert.ok(!t.includes("SQL"));
  });

  it("strips punctuation to spaces", () => {
    const t = normalizeFinding("a-b_c.d");
    assert.deepEqual(t, ["a", "b", "c", "d"]);
  });

  it("returns empty for non-string or empty", () => {
    assert.deepEqual(normalizeFinding(""), []);
    assert.deepEqual(normalizeFinding(null), []);
    assert.deepEqual(normalizeFinding(undefined), []);
  });
});

describe("dice", () => {
  it("returns 1 for identical token sets", () => {
    assert.equal(dice(["a", "b"], ["a", "b"]), 1);
  });

  it("returns 0 for disjoint sets", () => {
    assert.equal(dice(["a"], ["b"]), 0);
  });

  it("returns 0 for both empty", () => {
    assert.equal(dice([], []), 0);
  });
});

describe("findingMatches", () => {
  it("matches same issue with case/punctuation differences", () => {
    assert.equal(findingMatches("SQL Injection!", "sql injection"), true);
  });

  it("matches with extra words", () => {
    assert.equal(findingMatches("sql injection", "sql injection risk in query"), true);
  });

  it("does not match unrelated findings", () => {
    assert.equal(findingMatches("removeItem null crash", "calcTotal rounding error"), false);
  });

  it("matches identical CJK findings", () => {
    assert.equal(findingMatches("空值访问崩溃", "空值访问崩溃"), true);
  });

  it("does not crash on empty inputs", () => {
    assert.equal(findingMatches("", ""), false);
  });
});

describe("classifyConsensus", () => {
  it("groups matching findings as consensus", () => {
    const results = [
      { model: "glm-5.2", success: true, issues: [{ finding: "SQL injection risk" }] },
      { model: "kimi-k2.7-code", success: true, issues: [{ finding: "sql injection in query" }] },
    ];
    const r = classifyConsensus(results);
    assert.equal(r.groups.length, 1);
    assert.equal(r.groups[0].type, "consensus");
    assert.equal(r.groups[0].size, 2);
    assert.equal(r.perModel["glm-5.2"].consensusCount, 1);
    assert.equal(r.perModel["kimi-k2.7-code"].consensusCount, 1);
  });

  it("separates a unique finding", () => {
    const results = [
      { model: "glm-5.2", success: true, issues: [{ finding: "removeItem null crash" }] },
      { model: "kimi-k2.7-code", success: true, issues: [{ finding: "removeItem null crash" }, { finding: "calcTotal rounding error" }] },
    ];
    const r = classifyConsensus(results);
    const consensus = r.groups.filter((g) => g.type === "consensus");
    const unique = r.groups.filter((g) => g.type === "unique");
    assert.equal(consensus.length, 1);
    assert.equal(unique.length, 1);
    assert.equal(r.perModel["kimi-k2.7-code"].uniqueCount, 1);
    assert.equal(r.perModel["kimi-k2.7-code"].consensusCount, 1);
  });

  it("computes consensus rate", () => {
    const results = [
      { model: "glm-5.2", success: true, issues: [{ finding: "a" }, { finding: "b" }] },
      { model: "kimi-k2.7-code", success: true, issues: [{ finding: "a" }, { finding: "c" }] },
    ];
    const r = classifyConsensus(results);
    assert.equal(r.perModel["glm-5.2"].consensusRate, 0.5);
    assert.equal(r.perModel["glm-5.2"].uniqueCount, 1);
    assert.equal(r.perModel["kimi-k2.7-code"].consensusRate, 0.5);
  });

  it("ignores failed workers", () => {
    const results = [
      { model: "glm-5.2", success: false, issues: [] },
      { model: "kimi-k2.7-code", success: true, issues: [{ finding: "x" }] },
    ];
    const r = classifyConsensus(results);
    assert.equal(r.groups.length, 1);
    assert.equal(r.groups[0].type, "unique");
  });
});

describe("buildAdjudicatorPrompt", () => {
  it("contains the narrow verifier persona, finding, and code", () => {
    const p = buildAdjudicatorPrompt("removeItem null crash", "function x(){}");
    assert.ok(p.includes("裁决员") || p.includes("审计"), "should carry the verifier persona");
    assert.ok(p.includes("removeItem null crash"), "should carry the finding");
    assert.ok(p.includes("function x(){}"), "should carry the code");
    assert.ok(p.includes("verdict"), "should ask for a verdict");
  });
});

describe("parseVerdict", () => {
  it("parses a valid false verdict", () => {
    assert.deepEqual(parseVerdict('{"verdict":"false","evidence":"已参数化"}'), { verdict: "false", evidence: "已参数化" });
  });

  it("parses a valid true verdict", () => {
    assert.deepEqual(parseVerdict('{"verdict":"true","evidence":"确实"}'), { verdict: "true", evidence: "确实" });
  });

  it("degrades to uncertain on garbage", () => {
    const r = parseVerdict("not json at all");
    assert.equal(r.verdict, "uncertain");
  });

  it("degrades to uncertain on missing/invalid verdict", () => {
    assert.equal(parseVerdict('{"foo":"bar"}').verdict, "uncertain");
    assert.equal(parseVerdict('{"verdict":"maybe"}').verdict, "uncertain");
  });
});

describe("adjudicate", () => {
  it("uses hy3 and returns the verdict", async () => {
    let captured = null;
    setSpawn((cmd, args, opts) => {
      captured = { cmd, args, opts };
      return mockProc('{"verdict":"false","evidence":"already parameterized"}');
    });
    const r = await adjudicate({ finding: "SQL injection", code: "const q = 'x'" });
    assert.deepEqual(r, { verdict: "false", evidence: "already parameterized" });
    assert.ok(captured.args.includes("hy3"), "must adjudicate with hy3");
  });

  it("returns uncertain when the model fails", async () => {
    setSpawn(() => mockProc("", { exitCode: 1, stderr: "boom" }));
    const r = await adjudicate({ finding: "x", code: "y" });
    assert.equal(r.verdict, "uncertain");
  });
});

describe("evaluateModels", () => {
  it("aggregates quantity and consensus rate", async () => {
    const audits = [
      { workers: [
        { model: "glm-5.2", success: true, severity: "high", issues: [{ finding: "a" }, { finding: "b" }] },
        { model: "kimi-k2.7-code", success: true, severity: "high", issues: [{ finding: "a" }] },
      ]},
      { workers: [
        { model: "glm-5.2", success: true, severity: "medium", issues: [{ finding: "c" }] },
        { model: "kimi-k2.7-code", success: true, severity: "medium", issues: [{ finding: "c" }] },
      ]},
    ];
    const r = await evaluateModels({ audits });
    const glm = r.perModel["glm-5.2"];
    assert.equal(glm.runs, 2);
    assert.equal(glm.totalIssues, 3);
    assert.equal(glm.consensusCount, 2);
    assert.equal(glm.uniqueCount, 1);
    assert.equal(glm.avgIssuesPerRun, 1.5);
    assert.equal(glm.consensusRate, 2 / 3);
  });

  it("flags insufficient sample size", async () => {
    const audits = [{ workers: [{ model: "glm-5.2", success: true, issues: [] }] }];
    const r = await evaluateModels({ audits });
    assert.equal(r.perModel["glm-5.2"].sampleInsufficient, true);
  });

  it("arbitrates unique findings into precision", async () => {
    const audits = [{ workers: [
      { model: "glm-5.2", success: true, issues: [{ finding: "unique bug x", file: "f.js" }] },
      { model: "kimi-k2.7-code", success: true, issues: [{ finding: "totally different y", file: "f.js" }] },
    ]}];
    const adjudicateFn = async () => ({ verdict: "true", evidence: "real" });
    const r = await evaluateModels({ audits, arbitrate: true, adjudicateFn, resolveCode: () => "code" });
    assert.equal(r.perModel["glm-5.2"].uniqueTrue, 1);
    assert.equal(r.perModel["glm-5.2"].precision, 1);
  });

  it("counts consensus findings without arbitration", async () => {
    const audits = [{ workers: [
      { model: "glm-5.2", success: true, issues: [{ finding: "shared" }] },
      { model: "kimi-k2.7-code", success: true, issues: [{ finding: "shared" }] },
    ]}];
    const r = await evaluateModels({ audits });
    assert.equal(r.perModel["glm-5.2"].consensusCount, 1);
    assert.equal(r.perModel["glm-5.2"].consensusRate, 1);
  });

  it("adjudicates consensus findings too (not default true)", async () => {
    const audits = [{ workers: [
      { model: "glm-5.2", success: true, issues: [{ finding: "shared but wrong finding" }] },
      { model: "kimi-k2.7-code", success: true, issues: [{ finding: "shared but wrong finding" }] },
    ]}];
    const adjudicateFn = async () => ({ verdict: "false" });
    const r = await evaluateModels({ audits, arbitrate: true, adjudicateFn, resolveCode: () => "" });
    assert.equal(r.perModel["glm-5.2"].trueCount, 0);
    assert.equal(r.perModel["glm-5.2"].precision, 0);
  });
});

describe("timeout defaults", () => {
  it("adjudicate default timeout is 900000ms", () => {
    assert.equal(ADJUDICATE_TIMEOUT, 900000);
  });
});

describe("extractContext", () => {
  const code = Array(100).fill(0).map((_, i) => `line${i + 1}`).join("\n");

  it("extracts surrounding lines around a middle line", () => {
    const ctx = extractContext(code, 50, { contextLines: 5 });
    const lines = ctx.split("\n");
    assert.equal(lines.length, 11); // 5 before + line 50 + 5 after
    assert.equal(lines[0], "line45");
    assert.equal(lines[10], "line55");
  });

  it("clamps to the start", () => {
    const ctx = extractContext(code, 3, { contextLines: 5 });
    assert.ok(ctx.startsWith("line1"), "should start at line 1");
  });

  it("clamps to the end", () => {
    const ctx = extractContext(code, 98, { contextLines: 5 });
    assert.ok(ctx.endsWith("line100"), "should end at last line");
  });

  it("returns full code when line is missing/invalid", () => {
    assert.equal(extractContext(code, null), code);
    assert.equal(extractContext(code, undefined), code);
  });

  it("returns empty for empty code", () => {
    assert.equal(extractContext("", 5), "");
  });
});

describe("adjudicate context extraction", () => {
  it("passes only the surrounding context (not full code) when line is provided", async () => {
    const code = Array(200).fill(0).map((_, i) => `line${i + 1}`).join("\n");
    let proc = null;
    setSpawn((cmd, args, opts) => {
      proc = mockProc('{"verdict":"true","evidence":"real"}');
      return proc;
    });
    await adjudicate({ finding: "bug here", code, line: 100, contextLines: 10 });
    const prompt = proc.stdinWritten || "";
    assert.ok(prompt.includes("line100"), "should include the finding's line");
    assert.ok(prompt.includes("line90"), "should include context before");
    assert.ok(prompt.includes("line110"), "should include context after");
    assert.ok(!prompt.includes("line1\n"), "should NOT include far-away line 1");
    assert.ok(!prompt.includes("line200"), "should NOT include far-away line 200");
  });

  it("passes the full code when no line is provided", async () => {
    const code = "const a = 1;\nconst b = 2;";
    let proc = null;
    setSpawn((cmd, args, opts) => {
      proc = mockProc('{"verdict":"false","evidence":"x"}');
      return proc;
    });
    await adjudicate({ finding: "x", code });
    assert.ok((proc.stdinWritten || "").includes("const b = 2;"));
  });
});

describe("evaluateModels passes line to adjudicator", () => {
  it("passes each finding's line number", async () => {
    const audits = [{ workers: [
      { model: "glm-5.2", success: true, issues: [{ finding: "unique x", file: "f.js", line: 42 }] },
      { model: "kimi-k2.7-code", success: true, issues: [{ finding: "different y", file: "f.js", line: 7 }] },
    ]}];
    const seen = [];
    const adjudicateFn = async ({ line }) => { seen.push(line); return { verdict: "false" }; };
    await evaluateModels({ audits, arbitrate: true, adjudicateFn, resolveCode: () => "code" });
    assert.deepEqual(seen.sort((a, b) => a - b), [7, 42]);
  });
});
