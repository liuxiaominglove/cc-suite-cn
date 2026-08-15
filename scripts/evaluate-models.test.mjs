import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { normalizeFinding, dice, findingMatches, classifyConsensus, buildAdjudicatorPrompt, parseVerdict, adjudicate, evaluateModels, ADJUDICATE_TIMEOUT, extractContext, dedupJobsByTask, dedupFindings, makeResolveCode } from "./evaluate-models.mjs";
import { setSpawn } from "./runner-core.mjs";
import { setRetryBackoffMs } from "./review-runner.mjs";

afterEach(() => { setSpawn(null); setRetryBackoffMs(null); });

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

  it("同 file+line 但表述不同也归为共识（位置优先）", () => {
    const results = [
      { model: "glm-5.2", success: true, issues: [{ file: "a.js", line: 10, finding: "tilde not expanded" }] },
      { model: "kimi-k2.7-code", success: true, issues: [{ file: "a.js", line: 10, finding: "路径未做波浪号展开导致数据库打开失败" }] },
    ];
    const r = classifyConsensus(results);
    const consensus = r.groups.filter((g) => g.type === "consensus");
    assert.equal(consensus.length, 1, "同 file+line 的应归为共识，即使表述完全不同");
    assert.equal(r.perModel["glm-5.2"].consensusCount, 1);
    assert.equal(r.perModel["kimi-k2.7-code"].consensusCount, 1);
  });

  it("同 file 但 line 差很多则不因位置归并", () => {
    const results = [
      { model: "glm-5.2", success: true, issues: [{ file: "a.js", line: 10, finding: "SQL injection in query" }] },
      { model: "kimi-k2.7-code", success: true, issues: [{ file: "a.js", line: 100, finding: "memory leak in cache" }] },
    ];
    const r = classifyConsensus(results);
    const consensus = r.groups.filter((g) => g.type === "consensus");
    assert.equal(consensus.length, 0, "line 差太多且表述不同，不应归并");
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

  it("injects project rules when provided", () => {
    const p = buildAdjudicatorPrompt("removeItem null crash", "function x(){}", "禁止 CFTypeRef 强转");
    assert.ok(p.includes("[项目规则]"), p);
    assert.ok(p.includes("禁止 CFTypeRef 强转"), p);
  });

  it("omits the rules section when no rules provided", () => {
    const p = buildAdjudicatorPrompt("removeItem null crash", "function x(){}");
    assert.ok(!p.includes("[项目规则]"), p);
  });

  it("warns the adjudicator not to claim a repository search", () => {
    const p = buildAdjudicatorPrompt("finding", "code");
    assert.ok(p.includes("不要声称搜索"), "should include anti-hallucination clause");
    assert.ok(p.includes("无权访问"), "should state the adjudicator cannot access the filesystem");
  });

  it("injects related module source when provided", () => {
    const p = buildAdjudicatorPrompt("x", "code", "", "export function resolveDbPath(p){return p;}");
    assert.ok(p.includes("[相关模块源码]"), p);
    assert.ok(p.includes("resolveDbPath"), p);
  });

  it("omits related module section when not provided", () => {
    const p = buildAdjudicatorPrompt("x", "code");
    assert.ok(!p.includes("[相关模块源码]"), p);
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

  it("accepts JSON boolean true/false verdicts", () => {
    assert.equal(parseVerdict('{"verdict":true}').verdict, "true");
    assert.equal(parseVerdict('{"verdict":false}').verdict, "false");
  });

  it("normalizes casing and whitespace in verdict", () => {
    assert.equal(parseVerdict('{"verdict":" TRUE "}').verdict, "true");
    assert.equal(parseVerdict('{"verdict":"False"}').verdict, "false");
    assert.equal(parseVerdict('{"verdict":"Uncertain"}').verdict, "uncertain");
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

  it("passes project rules into the prompt", async () => {
    let captured = null;
    setSpawn((cmd, args) => {
      captured = mockProc('{"verdict":"true","evidence":"e"}');
      return captured;
    });
    await adjudicate({ finding: "x", code: "y", rules: "禁止 CFTypeRef 强转" });
    assert.ok(captured.stdinWritten.includes("禁止 CFTypeRef 强转"), "rules should be in the adjudicator prompt");
  });

  it("retries on transient failure", async () => {
    setRetryBackoffMs([0, 0]);
    let calls = 0;
    setSpawn(() => {
      calls += 1;
      if (calls === 1) return mockProc("", { exitCode: 1, stderr: "rate limited" });
      return mockProc('{"verdict":"false","evidence":"after retry"}');
    });
    const r = await adjudicate({ finding: "x", code: "y", retries: 1 });
    assert.deepEqual(r, { verdict: "false", evidence: "after retry" });
    assert.equal(calls, 2, "should retry once after a transient exit failure");
  });

  it("文件 ≤800 行时传整文件给裁决（不截断 ±40 行）", async () => {
    let captured = null;
    setSpawn((cmd, args) => {
      captured = mockProc('{"verdict":"true","evidence":"e"}');
      return captured;
    });
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`);
    const code = lines.join("\n");
    await adjudicate({ finding: "x", code, line: 50 });
    assert.ok(captured.stdinWritten.includes("line 0"), "应含第一行（±40 会截断掉）");
    assert.ok(captured.stdinWritten.includes("line 99"), "应含最后一行（±40 会截断掉）");
  });

  it("passes relatedCode into the adjudicator prompt", async () => {
    let captured = null;
    setSpawn((cmd, args) => {
      captured = mockProc('{"verdict":"false","evidence":"already handled"}');
      return captured;
    });
    await adjudicate({ finding: "~ not expanded", code: "openDb(dbPath)", relatedCode: "export function openDb(p){ return new DatabaseSync(resolveDbPath(p)) }" });
    assert.ok(captured.stdinWritten.includes("[相关模块源码]"), "prompt 应含相关模块段");
    assert.ok(captured.stdinWritten.includes("resolveDbPath"), "prompt 应含相关模块源码");
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

  it("returns verdicts with codeHash when arbitrating", async () => {
    const audits = [{ workers: [
      { model: "glm-5.2", success: true, issues: [{ finding: "problem alpha", file: "f.js" }] },
    ]}];
    const adjudicateFn = async () => ({ verdict: "true", evidence: "real" });
    const r = await evaluateModels({ audits, arbitrate: true, adjudicateFn, resolveCode: () => "const x = 1;" });
    assert.equal(r.verdicts.length, 1);
    assert.equal(r.verdicts[0].verdict, "true");
    assert.equal(r.verdicts[0].evidence, "real");
    assert.equal(r.verdicts[0].file, "f.js");
    assert.match(r.verdicts[0].codeHash, /^[a-f0-9]{64}$/, "codeHash 应为 sha256");
  });

  it("collects import context and passes it to the adjudicator", async () => {
    const audits = [{ workers: [
      { model: "glm-5.2", success: true, issues: [{ finding: "problem alpha", file: "f.js" }] },
    ]}];
    let seenRelated = null;
    const adjudicateFn = async ({ relatedCode }) => {
      seenRelated = relatedCode;
      return { verdict: "false" };
    };
    await evaluateModels({
      audits,
      arbitrate: true,
      adjudicateFn,
      resolveCode: () => "code",
      resolveImportContext: async (file) => "module db.js source",
    });
    assert.equal(seenRelated, "module db.js source", "应把 import 上下文传给裁决员");
  });

  it("returns empty verdicts without arbitration", async () => {
    const audits = [{ workers: [{ model: "glm-5.2", success: true, issues: [] }] }];
    const r = await evaluateModels({ audits });
    assert.deepEqual(r.verdicts, []);
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

  it("caps adjudication concurrency", async () => {
    const words = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet", "kilo", "lima", "mike", "november", "oscar", "papa", "quebec", "romeo", "sierra", "tango"];
    const issues = words.map((w) => ({ finding: `problem ${w}` }));
    const audits = [{ workers: [{ model: "glm-5.2", success: true, issues }] }];
    let running = 0;
    let maxRunning = 0;
    const adjudicateFn = async () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 5));
      running -= 1;
      return { verdict: "true" };
    };
    await evaluateModels({ audits, arbitrate: true, adjudicateFn, resolveCode: () => "code", adjudicateConcurrency: 4 });
    assert.ok(maxRunning <= 4, `concurrency should cap at 4, saw ${maxRunning}`);
    assert.ok(maxRunning > 1, "should still run in parallel");
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

  it("adjudicates deduplicated findings only (one call per unique bug)", async () => {
    const audits = [{ workers: [
      { model: "glm-5.2", success: true, issues: [{ finding: "same bug in a", file: "a.js" }, { finding: "same bug in a 2", file: "a.js" }] },
      { model: "kimi-k2.7-code", success: true, issues: [{ finding: "same bug in a variant", file: "a.js" }] },
    ]}];
    let calls = 0;
    const adjudicateFn = async () => { calls += 1; return { verdict: "true" }; };
    const r = await evaluateModels({ audits, arbitrate: true, adjudicateFn, resolveCode: () => "code" });
    assert.equal(calls, 1, "near-identical findings should be adjudicated once");
    assert.equal(r.perModel["glm-5.2"].trueCount, 2);
    assert.equal(r.perModel["kimi-k2.7-code"].trueCount, 1);
  });

  it("passes resolved project rules to the adjudicator", async () => {
    const audits = [{ workers: [
      { model: "glm-5.2", success: true, issues: [{ finding: "unique bug", file: "f.js" }] },
    ]}];
    let seenRules = null;
    const adjudicateFn = async ({ rules }) => { seenRules = rules; return { verdict: "false" }; };
    await evaluateModels({ audits, arbitrate: true, adjudicateFn, resolveCode: () => "code", resolveRules: async () => "禁止 X" });
    assert.equal(seenRules, "禁止 X");
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
  it("passes only the surrounding context when file exceeds 800 lines", async () => {
    const code = Array(900).fill(0).map((_, i) => `line${i + 1}`).join("\n");
    let proc = null;
    setSpawn((cmd, args, opts) => {
      proc = mockProc('{"verdict":"true","evidence":"real"}');
      return proc;
    });
    await adjudicate({ finding: "bug here", code, line: 500, contextLines: 10 });
    const prompt = proc.stdinWritten || "";
    assert.ok(prompt.includes("line500"), "should include the finding's line");
    assert.ok(prompt.includes("line490"), "should include context before");
    assert.ok(prompt.includes("line510"), "should include context after");
    assert.ok(!prompt.includes("line1\n"), "should NOT include far-away line 1");
    assert.ok(!prompt.includes("line900"), "should NOT include far-away line 900");
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

describe("dedupJobsByTask", () => {
  it("keeps only the latest job per task", () => {
    const jobs = [
      { task: "a.js", startedAt: "2026-01-01T00:00:00Z", id: "old" },
      { task: "a.js", startedAt: "2026-01-02T00:00:00Z", id: "new" },
    ];
    const out = dedupJobsByTask(jobs);
    assert.equal(out.length, 1);
    assert.equal(out[0].id, "new");
  });

  it("keeps all distinct tasks", () => {
    const jobs = [
      { task: "a.js", startedAt: "2026-01-01T00:00:00Z" },
      { task: "b.js", startedAt: "2026-01-01T00:00:00Z" },
    ];
    assert.equal(dedupJobsByTask(jobs).length, 2);
  });

  it("returns empty for empty input", () => {
    assert.deepEqual(dedupJobsByTask([]), []);
  });

  it("is deterministic when startedAt is missing", () => {
    const jobs = [
      { task: "a.js", startedAt: null, id: "x" },
      { task: "a.js", startedAt: null, id: "y" },
    ];
    const out = dedupJobsByTask(jobs);
    assert.equal(out.length, 1);
    assert.equal(out[0].id, "y");
  });
});

describe("dedupFindings", () => {
  it("merges similar findings", () => {
    const findings = [
      { model: "a", file: "x.js", line: 1, issue: { finding: "removeItem null deref" } },
      { model: "b", file: "x.js", line: 2, issue: { finding: "removeItem null deref causes crash" } },
    ];
    const out = dedupFindings(findings);
    assert.equal(out.length, 1);
  });

  it("keeps dissimilar findings separate", () => {
    const findings = [
      { model: "a", file: "x.js", line: 1, issue: { finding: "missing semicolon" } },
      { model: "b", file: "x.js", line: 2, issue: { finding: "unhandled promise rejection" } },
    ];
    const out = dedupFindings(findings);
    assert.equal(out.length, 2);
  });

  it("does not merge findings from different files", () => {
    const findings = [
      { model: "a", file: "x.js", line: 1, issue: { finding: "null deref in removeItem" } },
      { model: "b", file: "y.js", line: 1, issue: { finding: "null deref in removeItem" } },
    ];
    const out = dedupFindings(findings);
    assert.equal(out.length, 2);
  });

  it("同 file+line 但表述不同也归并为一条（位置优先）", () => {
    const findings = [
      { model: "a", auditFile: "x.js", issue: { file: "x.js", line: 10, finding: "tilde not expanded" } },
      { model: "b", auditFile: "x.js", issue: { file: "x.js", line: 10, finding: "完全不同的表述：数据库路径没展开波浪号" } },
    ];
    const out = dedupFindings(findings);
    assert.equal(out.length, 1, "同 file+line 应归并");
  });

  it("同 file 但 line 差很多不误并", () => {
    const findings = [
      { model: "a", auditFile: "x.js", issue: { file: "x.js", line: 10, finding: "SQL injection in query" } },
      { model: "b", auditFile: "x.js", issue: { file: "x.js", line: 100, finding: "memory leak in cache" } },
    ];
    const out = dedupFindings(findings);
    assert.equal(out.length, 2, "line 差太多且文本不同，不应归并");
  });

  it("returns empty for empty input", () => {
    assert.deepEqual(dedupFindings([]), []);
  });

  it("keeps cluster members for consensus counting", () => {
    const findings = [
      { model: "glm", file: "x.js", issue: { finding: "null deref" } },
      { model: "kimi", file: "x.js", issue: { finding: "null deref causes crash" } },
    ];
    const out = dedupFindings(findings);
    assert.equal(out.length, 1);
    assert.equal(out[0].cluster.length, 2);
  });
});

describe("makeResolveCode", () => {
  it("只读白名单内的文件", async () => {
    const read = async (p) => `content of ${p}`;
    const resolveCode = makeResolveCode(["a.js", "b.js"], read);
    assert.equal(await resolveCode("a.js"), "content of a.js");
    assert.equal(await resolveCode("b.js"), "content of b.js");
  });

  it("拒绝白名单外的路径（防 LLM 幻觉 file 字段读任意文件）", async () => {
    const read = async () => "should not be read";
    const resolveCode = makeResolveCode(["a.js"], read);
    assert.equal(await resolveCode("/etc/passwd"), "");
    assert.equal(await resolveCode("~/.ssh/id_rsa"), "");
    assert.equal(await resolveCode(""), "");
  });

  it("空白名单拒绝一切", async () => {
    const read = async () => "should not be read";
    const resolveCode = makeResolveCode([], read);
    assert.equal(await resolveCode("a.js"), "");
  });

  it("读取失败返回空字符串不抛错", async () => {
    const read = async () => { throw new Error("ENOENT"); };
    const resolveCode = makeResolveCode(["a.js"], read);
    assert.equal(await resolveCode("a.js"), "");
  });
});

describe("buildAdjudicatorPrompt 技术栈", () => {
  it("传 stackContext 时含 [技术栈] 段", () => {
    const p = buildAdjudicatorPrompt("x", "code", "", "", "Node.js (node >=22)");
    assert.ok(p.includes("[技术栈]"), p);
    assert.ok(p.includes("Node.js"), p);
  });

  it("不传 stackContext 时不含 [技术栈]", () => {
    const p = buildAdjudicatorPrompt("x", "code");
    assert.ok(!p.includes("[技术栈]"), p);
  });
});

describe("adjudicate 技术栈", () => {
  it("adjudicate 传 stackContext 进 prompt", async () => {
    let captured = null;
    setSpawn((cmd, args) => {
      captured = mockProc('{"verdict":"true","evidence":"e"}');
      return captured;
    });
    await adjudicate({ finding: "x", code: "y", stackContext: "Node.js (node >=22)" });
    assert.ok(captured.stdinWritten.includes("[技术栈]"), "prompt 应含技术栈段");
    assert.ok(captured.stdinWritten.includes("Node.js"), "prompt 应含技术栈内容");
  });
});
