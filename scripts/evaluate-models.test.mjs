import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { normalizeFinding, dice, findingMatches, classifyConsensus, buildAdjudicatorPrompt, parseVerdict, adjudicate, evaluateModels, computePrecision, ADJUDICATE_TIMEOUT, extractContext, dedupJobsByTask, dedupFindings, makeResolveCode, filterAuditsByFiles, matchesFileFilter, cli, confirmFindings, confirmCli, adjudicateLedger } from "./evaluate-models.mjs";
import { setSpawn } from "./runner-core.mjs";
import { setRetryBackoffMs } from "./review-tools.mjs";

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

  it("同一模型报 2 条同位置 finding 不算共识", () => {
    const results = [
      {
        model: "glm-5.2",
        success: true,
        issues: [
          { file: "a.js", line: 10, finding: "tilde not expanded" },
          { file: "a.js", line: 10, finding: "路径未做波浪号展开" },
        ],
      },
    ];
    const r = classifyConsensus(results);
    assert.equal(r.groups.length, 1);
    assert.equal(r.groups[0].type, "unique", "同一模型的重复 finding 不应算共识");
    assert.equal(r.perModel["glm-5.2"].uniqueCount, 2);
    assert.equal(r.perModel["glm-5.2"].consensusCount, 0);
  });
});

describe("buildAdjudicatorPrompt", () => {
  it("contains the narrow verifier persona, finding, and code", () => {
    const p = buildAdjudicatorPrompt("removeItem null crash", "function x(){}");
    assert.ok(p.includes("裁决员") || p.includes("审计"), "should carry the verifier persona");
    assert.ok(p.includes("removeItem null crash"), "should carry the finding");
    assert.ok(p.includes("function x(){}"), "should carry the code");
    assert.ok(p.includes("verdict"), "should ask for a verdict");
    assert.ok(p.includes("盲评纪律"), "应含盲评纪律（独立判，不依赖上游）");
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

  it("injects lessons into [评审教训] section when provided", () => {
    const p = buildAdjudicatorPrompt("x", "code", "", "", "", "- 规则：先 trace 再报");
    assert.ok(p.includes("[评审教训]"), p);
    assert.ok(p.includes("先 trace 再报"), p);
  });

  it("omits lessons section when not provided (backward compat)", () => {
    const p = buildAdjudicatorPrompt("x", "code");
    assert.ok(!p.includes("[评审教训]"), p);
  });

  it("omits lessons for empty/null/whitespace", () => {
    assert.ok(!buildAdjudicatorPrompt("x", "code", "", "", "", "").includes("[评审教训]"));
    assert.ok(!buildAdjudicatorPrompt("x", "code", "", "", "", null).includes("[评审教训]"));
    assert.ok(!buildAdjudicatorPrompt("x", "code", "", "", "", undefined).includes("[评审教训]"));
    assert.ok(!buildAdjudicatorPrompt("x", "code", "", "", "", "  \n ").includes("[评审教训]"));
  });

  it("keeps lessons special chars verbatim", () => {
    const weird = "- 规则：用 $ 与 ` 反引号 ` 与 <tag>";
    const p = buildAdjudicatorPrompt("x", "code", "", "", "", weird);
    assert.ok(p.includes(weird), p);
  });

  it("places lessons before CODE", () => {
    const p = buildAdjudicatorPrompt("x", "code", "", "", "", "- 规则：先 trace");
    assert.ok(p.includes("[评审教训]"), "教训段应存在");
    assert.ok(p.indexOf("[评审教训]") < p.indexOf("CODE:"), p);
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

  it("retries empty output then succeeds", async () => {
    setRetryBackoffMs([0, 0]);
    let calls = 0;
    setSpawn(() => {
      calls += 1;
      if (calls === 1) return mockProc("");
      return mockProc('{"verdict":"true","evidence":"after empty retry"}');
    });
    const r = await adjudicate({ finding: "x", code: "y", retries: 1 });
    assert.deepEqual(r, { verdict: "true", evidence: "after empty retry" });
    assert.equal(calls, 2, "should retry once after empty output");
  });

  it("degrades to uncertain after empty output exhausts retries", async () => {
    setRetryBackoffMs([0, 0]);
    let calls = 0;
    setSpawn(() => { calls += 1; return mockProc(""); });
    const r = await adjudicate({ finding: "x", code: "y", retries: 1 });
    assert.equal(r.verdict, "uncertain");
    assert.equal(calls, 2, "should retry then degrade to uncertain");
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

  it("passes lessons into the prompt", async () => {
    let captured = null;
    setSpawn((cmd, args) => {
      captured = mockProc('{"verdict":"true","evidence":"e"}');
      return captured;
    });
    await adjudicate({ finding: "x", code: "y", lessons: "- 规则：先 trace 再报" });
    assert.ok(captured.stdinWritten.includes("[评审教训]"), "应注入段头");
    assert.ok(captured.stdinWritten.includes("先 trace 再报"), "应注入内容");
  });

  it("omits lessons section when not provided (backward compat)", async () => {
    let captured = null;
    setSpawn((cmd, args) => {
      captured = mockProc('{"verdict":"true","evidence":"e"}');
      return captured;
    });
    await adjudicate({ finding: "x", code: "y" });
    assert.ok(!captured.stdinWritten.includes("[评审教训]"), "默认不注入");
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

  it("counts consensus findings without arbitration", async () => {
    const audits = [{ workers: [
      { model: "glm-5.2", success: true, issues: [{ finding: "shared" }] },
      { model: "kimi-k2.7-code", success: true, issues: [{ finding: "shared" }] },
    ]}];
    const r = await evaluateModels({ audits });
    assert.equal(r.perModel["glm-5.2"].consensusCount, 1);
    assert.equal(r.perModel["glm-5.2"].consensusRate, 1);
  });
});

describe("computePrecision", () => {
  it("computes per-model precision and uniqueTrue from ledger verdicts", () => {
    const log = [
      { models: ["glm-5.2", "kimi-k2.7-code"], verdict: "true", finding: "共识真" },
      { models: ["glm-5.2"], verdict: "true", finding: "glm 独有真" },
      { models: ["glm-5.2"], verdict: "false", finding: "glm 假" },
      { models: ["kimi-k2.7-code"], verdict: "false", finding: "kimi 假" },
    ];
    const p = computePrecision(log);
    assert.equal(p["glm-5.2"].precision, 2 / 3);
    assert.equal(p["glm-5.2"].uniqueTrue, 1);
    assert.equal(p["kimi-k2.7-code"].precision, 0.5);
    assert.equal(p["kimi-k2.7-code"].uniqueTrue, 0);
  });

  it("ignores uncertain and unadjudicated findings", () => {
    const log = [
      { models: ["glm-5.2"], verdict: "uncertain", finding: "不确定" },
      { models: ["glm-5.2"], finding: "未裁决" },
      { models: ["glm-5.2"], verdict: "true", finding: "真" },
    ];
    const p = computePrecision(log);
    assert.equal(p["glm-5.2"].precision, 1);
    assert.equal(p["glm-5.2"].samples, 1);
  });

  it("falls back to single model field when models array missing", () => {
    const log = [{ model: "glm-5.2", verdict: "true", finding: "用 model 字段" }];
    const p = computePrecision(log);
    assert.equal(p["glm-5.2"].precision, 1);
  });

  it("flags insufficient sample size for precision", () => {
    const log = [{ models: ["glm-5.2"], verdict: "true", finding: "只 1 条" }];
    const p = computePrecision(log);
    assert.equal(p["glm-5.2"].sampleInsufficient, true);
  });

  it("returns empty object for empty or verdict-less log", () => {
    assert.deepEqual(computePrecision([]), {});
    assert.deepEqual(computePrecision([{ models: ["glm-5.2"], finding: "no verdict" }]), {});
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

  it("行号远超文件末尾时返回完整代码而非空串", () => {
    assert.equal(extractContext(code, 99999), code, "line 超出范围应回退为完整代码");
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

describe("matchesFileFilter", () => {
  it("精确相等命中", () => {
    assert.equal(matchesFileFilter("scripts/jobs.mjs", "scripts/jobs.mjs"), true);
  });

  it("basename 后缀命中", () => {
    assert.equal(matchesFileFilter("scripts/jobs.mjs", "jobs.mjs"), true);
    assert.equal(matchesFileFilter("/Users/x/project/learnunk/src/ui.js", "ui.js"), true);
  });

  it("不匹配返回 false", () => {
    assert.equal(matchesFileFilter("scripts/jobs.mjs", "other.js"), false);
    assert.equal(matchesFileFilter(null, "jobs.mjs"), false);
    assert.equal(matchesFileFilter("scripts/jobs.mjs", null), false);
  });
});

describe("filterAuditsByFiles", () => {
  const audits = [
    { file: "scripts/jobs.mjs", workers: [] },
    { file: "scripts/guard.mjs", workers: [] },
  ];

  it("按文件过滤只返回匹配任务", () => {
    const out = filterAuditsByFiles(audits, ["jobs.mjs"]);
    assert.equal(out.length, 1);
    assert.equal(out[0].file, "scripts/jobs.mjs");
  });

  it("多值过滤", () => {
    assert.equal(filterAuditsByFiles(audits, ["jobs.mjs", "guard.mjs"]).length, 2);
  });

  it("无匹配返回空", () => {
    assert.deepEqual(filterAuditsByFiles(audits, ["nonexistent.js"]), []);
  });

  it("无过滤返回全部（向后兼容）", () => {
    assert.equal(filterAuditsByFiles(audits, null).length, 2);
    assert.equal(filterAuditsByFiles(audits, []).length, 2);
    assert.equal(filterAuditsByFiles(audits, undefined).length, 2);
  });
});

describe("confirmFindings", () => {
  it("批量写回，所有条目用同一个批次时间戳", async () => {
    const seen = [];
    const confirmFn = async (file, line, finding, opts) => {
      seen.push({ file, line, finding, ...opts });
      return { confirmed: opts };
    };
    const { batchAt, results } = await confirmFindings(
      [
        { file: "a.js", line: 1, finding: "f1", final: "false", reason: "r1", independent: { final: "false", reason: "i1" }, comparison: "c1" },
        { file: "b.js", line: 2, finding: "f2", final: "true", reason: "r2", independent: { final: "true", reason: "i2" }, comparison: "c2" },
      ],
      { confirmFn, now: () => "BATCH" }
    );
    assert.equal(batchAt, "BATCH");
    assert.equal(seen.length, 2);
    assert.ok(seen.every((s) => s.confirmedAt === "BATCH"), "所有条目应共享批次时间戳");
    assert.equal(seen[0].final, "false");
    assert.equal(results.filter((r) => r.ok).length, 2);
  });

  it("final 非法值不抛错，记为失败条目", async () => {
    const confirmFn = async () => { throw new Error("不应被调用"); };
    const { results } = await confirmFindings(
      [{ file: "a.js", line: 1, finding: "f", final: "maybe" }],
      { confirmFn }
    );
    assert.equal(results.length, 1);
    assert.equal(results[0].ok, false);
    assert.ok(results[0].error.includes("invalid final"));
  });

  it("reason 空时记为失败条目（终审必须附依据）", async () => {
    const confirmFn = async () => { throw new Error("不应被调用"); };
    const { results } = await confirmFindings(
      [{ file: "a.js", line: 1, finding: "f", final: "false", reason: "   " }],
      { confirmFn }
    );
    assert.equal(results.length, 1);
    assert.equal(results[0].ok, false);
    assert.ok(results[0].error.includes("missing reason"), "应报缺 reason 依据");
  });

  it("缺 independent 记为失败条目（两步终审步骤 1 必须落实）", async () => {
    const confirmFn = async () => { throw new Error("不应被调用"); };
    const { results } = await confirmFindings(
      [{ file: "a.js", line: 1, finding: "f", final: "false", reason: "r" }],
      { confirmFn }
    );
    assert.equal(results[0].ok, false);
    assert.ok(results[0].error.includes("missing independent"));
  });

  it("空数组不报错", async () => {
    const { results } = await confirmFindings([], { confirmFn: async () => ({}) });
    assert.deepEqual(results, []);
  });

  it("confirmFn 返回 null（未匹配）时 ok=false", async () => {
    const { results } = await confirmFindings(
      [{ file: "a.js", line: 1, finding: "f", final: "false", reason: "r", independent: { final: "false", reason: "i" }, comparison: "c" }],
      { confirmFn: async () => null }
    );
    assert.equal(results[0].ok, false);
  });

  it("透传 mistakeType 给 confirmFn（不传则不透传）", async () => {
    const seen = [];
    const confirmFn = async (file, line, finding, opts) => {
      seen.push(opts);
      return { confirmed: opts };
    };
    await confirmFindings(
      [
        { file: "a.js", line: 1, finding: "f1", final: "false", reason: "r", independent: { final: "false", reason: "i" }, comparison: "c", mistakeType: "prompt-injection-misattributed" },
        { file: "b.js", line: 2, finding: "f2", final: "false", reason: "r", independent: { final: "false", reason: "i" }, comparison: "c" },
      ],
      { confirmFn }
    );
    assert.equal(seen[0].mistakeType, "prompt-injection-misattributed", "应透传 mistakeType");
    assert.equal(seen[1].mistakeType, undefined, "不传 mistakeType 时不应透传");
  });
});

describe("confirmCli", () => {
  it("无 --confirm 参数返回 null（交回 cli）", async () => {
    assert.equal(await confirmCli(["--arbitrate"]), null);
  });

  it("缺文件路径返回 1 并提示", async () => {
    let err = "";
    const code = await confirmCli(["--confirm"], { stderr: { write: (s) => { err += s; } } });
    assert.equal(code, 1);
    assert.ok(err.includes("--confirm"), err);
  });

  it("读 JSON 数组并写回", async () => {
    let out = "";
    let err = "";
    const readFile = async () => JSON.stringify([{ file: "a.js", line: 1, finding: "f", final: "false", reason: "r", independent: { final: "false", reason: "i" }, comparison: "c" }]);
    const code = await confirmCli(
      ["--confirm", "x.json"],
      { readFile, confirmFn: async () => ({ confirmed: {} }), stdout: { write: (s) => { out += s; } }, stderr: { write: (s) => { err += s; } } }
    );
    assert.equal(code, 0);
    assert.ok(out.includes("终审写回 1 条"), out);
  });

  it("非数组 JSON 返回 1", async () => {
    let err = "";
    const readFile = async () => JSON.stringify({ foo: 1 });
    const code = await confirmCli(["--confirm", "x.json"], { readFile, stderr: { write: (s) => { err += s; } } });
    assert.equal(code, 1);
    assert.ok(err.includes("数组"), err);
  });

  it("JSON 解析失败返回 1", async () => {
    let err = "";
    const readFile = async () => "{ not json";
    const code = await confirmCli(["--confirm", "x.json"], { readFile, stderr: { write: (s) => { err += s; } } });
    assert.equal(code, 1);
    assert.ok(err.includes("解析失败"), err);
  });
});

describe("cli --file 过滤", () => {
  it("把 --file 传给 load", async () => {
    let captured = null;
    const load = async (opts) => { captured = opts; return []; };
    let out = "";
    await cli(["--file", "jobs.mjs"], { load, stdout: { write: (s) => { out += s; } }, stderr: { write: () => {} } });
    assert.deepEqual(captured.files, ["jobs.mjs"]);
  });

  it("把 --files 逗号多值传给 load", async () => {
    let captured = null;
    const load = async (opts) => { captured = opts; return []; };
    await cli(["--files", "jobs.mjs,guard.mjs"], { load, stdout: { write: () => {} }, stderr: { write: () => {} } });
    assert.deepEqual(captured.files, ["jobs.mjs", "guard.mjs"]);
  });

  it("无 --file 时传 null（向后兼容）", async () => {
    let captured = null;
    const load = async (opts) => { captured = opts; return []; };
    await cli([], { load, stdout: { write: () => {} }, stderr: { write: () => {} } });
    assert.deepEqual(captured.files, null);
  });
});

describe("cli --arbitrate --project-dir", () => {
  it("把 --project-dir 传给 adjudicateLedgerFn", async () => {
    let captured = null;
    const adjudicateLedgerFn = async (opts) => { captured = opts.projectDir; return []; };
    await cli(["--arbitrate", "--project-dir", "/p"], { adjudicateLedgerFn, stdout: { write: () => {} }, stderr: { write: () => {} } });
    assert.equal(captured, "/p");
  });

  it("不传 --project-dir 时透传 null（兼容）", async () => {
    let captured = "sentinel";
    const adjudicateLedgerFn = async (opts) => { captured = opts.projectDir ?? "none"; return []; };
    await cli(["--arbitrate"], { adjudicateLedgerFn, stdout: { write: () => {} }, stderr: { write: () => {} } });
    assert.equal(captured, "none");
  });
});

describe("cli --arbitrate resolveLessons", () => {
  it("把 resolveLessons 函数传给 adjudicateLedgerFn", async () => {
    let captured = null;
    const adjudicateLedgerFn = async (opts) => { captured = opts.resolveLessons; return []; };
    await cli(["--arbitrate"], { adjudicateLedgerFn, stdout: { write: () => {} }, stderr: { write: () => {} } });
    assert.equal(typeof captured, "function", "resolveLessons 应是函数");
  });

  it("resolveLessons 调用返回字符串（接 collectWorkerLessons）", async () => {
    let captured = null;
    const adjudicateLedgerFn = async (opts) => { captured = await opts.resolveLessons(); return []; };
    await cli(["--arbitrate"], { adjudicateLedgerFn, stdout: { write: () => {} }, stderr: { write: () => {} } });
    assert.equal(typeof captured, "string", "resolveLessons 返回字符串");
  });
});

describe("cli --preflight", () => {
  it("打印防坑清单", async () => {
    const loadLedger = async () => [
      { file: "a.js", finding: "f1", fixed: { rootCause: "边界" } },
      { file: "b.js", finding: "f2", confirmed: { final: "false", mistakeType: "by-design" } },
    ];
    let out = "";
    await cli(["--preflight"], { loadLedger, stdout: { write: (s) => { out += s; } }, stderr: { write: () => {} } });
    assert.ok(out.includes("修 bug 时警惕同类"), out);
    assert.ok(out.includes("终审时警惕同类假阳"), out);
    assert.ok(out.endsWith("\n"), "非空输出应以换行结尾");
  });

  it("空账本打印无历史教训提示", async () => {
    let out = "";
    await cli(["--preflight"], { loadLedger: async () => [], stdout: { write: (s) => { out += s; } }, stderr: { write: () => {} } });
    assert.ok(out.includes("无历史教训"), out);
  });

  it("账本读取失败打 stderr 警告不崩", async () => {
    let err = "";
    let out = "";
    await cli(["--preflight"], { loadLedger: async () => { throw new Error("boom"); }, stdout: { write: (s) => { out += s; } }, stderr: { write: (s) => { err += s; } } });
    assert.ok(err.includes("账本读取失败"), err);
  });
});

describe("cli 非 arbitrate 输出 precision", () => {
  it("合并数量/共识与账本 precision 到一张表", async () => {
    const load = async () => [
      { file: "a.js", workers: [
        { model: "glm-5.2", success: true, issues: [{ finding: "a" }] },
        { model: "kimi-k2.7-code", success: true, issues: [{ finding: "a" }] },
      ]},
    ];
    const loadLedger = async () => [
      { models: ["glm-5.2"], verdict: "true", finding: "真" },
      { models: ["kimi-k2.7-code"], verdict: "false", finding: "假" },
    ];
    let out = "";
    await cli([], { load, loadLedger, stdout: { write: (s) => { out += s; } }, stderr: { write: () => {} } });
    assert.ok(out.includes("precision"), "表头应含 precision 列");
    assert.ok(out.includes("glm-5.2"), "应含 glm 行");
    assert.ok(out.includes("kimi-k2.7-code"), "应含 kimi 行");
  });

  it("账本损坏时优雅降级：precision 列标 —，数量/共识照常显示", async () => {
    const load = async () => [
      { file: "a.js", workers: [{ model: "glm-5.2", success: true, issues: [{ finding: "a" }] }] },
    ];
    const loadLedger = async () => { throw new Error("corrupted verdict log"); };
    let out = "";
    let err = "";
    await cli([], { load, loadLedger, stdout: { write: (s) => { out += s; } }, stderr: { write: (s) => { err += s; } } });
    assert.ok(out.includes("glm-5.2"), "数量/共识行仍应显示");
    assert.ok(out.includes("—"), "precision 列应标 —");
    assert.ok(err.includes("裁决账本"), "应打 stderr 警告");
  });
});

describe("adjudicateLedger", () => {
  it("只裁 verdict 为空的 finding，追加 verdict/evidence/codeHash", async () => {
    const log = [
      { file: "a.js", line: 1, finding: "f1", verdict: null },
      { file: "b.js", line: 2, finding: "f2", verdict: "true" },
      { file: "c.js", line: 3, finding: "f3" },
    ];
    const resolveCode = async (file) => `code of ${file}`;
    const adjudicateFn = async ({ finding }) => ({ verdict: "true", evidence: `ev-${finding}` });
    let persisted = null;
    const persist = async (vs) => { persisted = vs; };
    const results = await adjudicateLedger({ load: async () => log, resolveCode, adjudicateFn, persist });
    assert.equal(results.length, 2, "只裁 f1 和 f3");
    assert.deepEqual(results.map((r) => r.finding), ["f1", "f3"]);
    assert.equal(results[0].verdict, "true");
    assert.equal(results[0].evidence, "ev-f1");
    assert.ok(results[0].codeHash, "应有 codeHash");
    assert.equal(persisted.length, 2);
  });

  it("verdict=uncertain 也重裁", async () => {
    const log = [{ file: "a.js", line: 1, finding: "f", verdict: "uncertain" }];
    const resolveCode = async () => "code";
    const adjudicateFn = async () => ({ verdict: "false", evidence: "e" });
    const results = await adjudicateLedger({ load: async () => log, resolveCode, adjudicateFn, persist: async () => {} });
    assert.equal(results.length, 1);
  });

  it("空 pending 不调 persist", async () => {
    const log = [{ file: "a.js", line: 1, finding: "f", verdict: "true" }];
    let called = false;
    const persist = async () => { called = true; };
    const results = await adjudicateLedger({ load: async () => log, adjudicateFn: async () => ({}), persist });
    assert.deepEqual(results, []);
    assert.equal(called, false);
  });

  it("files 过滤只裁匹配的 finding", async () => {
    const log = [
      { file: "a.js", line: 1, finding: "f1" },
      { file: "b.js", line: 2, finding: "f2" },
    ];
    const resolveCode = async () => "code";
    const adjudicateFn = async ({ finding }) => ({ verdict: "true", evidence: finding });
    const results = await adjudicateLedger({ load: async () => log, resolveCode, adjudicateFn, persist: async () => {}, files: ["a.js"] });
    assert.deepEqual(results.map((r) => r.finding), ["f1"], "应只裁 a.js");
  });

  it("传 projectDir 时只裁命中项目且落库结果用传入值", async () => {
    const log = [{ file: "a.js", line: 1, finding: "f", projectDir: "/p" }];
    const resolveCode = async () => "code";
    const adjudicateFn = async ({ finding }) => ({ verdict: "true", evidence: finding });
    const results = await adjudicateLedger({ load: async () => log, resolveCode, adjudicateFn, persist: async () => {}, projectDir: "/p" });
    assert.equal(results.length, 1);
    assert.equal(results[0].projectDir, "/p");
  });

  it("不传 projectDir 时 fallback process.cwd()（兼容旧行为）", async () => {
    const log = [{ file: "a.js", line: 1, finding: "f" }];
    const resolveCode = async () => "code";
    const adjudicateFn = async ({ finding }) => ({ verdict: "true", evidence: finding });
    const results = await adjudicateLedger({ load: async () => log, resolveCode, adjudicateFn, persist: async () => {} });
    assert.equal(results[0].projectDir, process.cwd());
  });

  it("projectDir 只裁命中项目的 finding，不裁别的项目", async () => {
    const log = [
      { file: "a.js", line: 1, finding: "f1", projectDir: "/p" },
      { file: "b.js", line: 2, finding: "f2", projectDir: "/other" },
      { file: "c.js", line: 3, finding: "f3" },
    ];
    const resolveCode = async () => "code";
    const adjudicateFn = async ({ finding }) => ({ verdict: "true", evidence: finding });
    const results = await adjudicateLedger({ load: async () => log, resolveCode, adjudicateFn, persist: async () => {}, projectDir: "/p" });
    assert.deepEqual(results.map((r) => r.finding), ["f1"], "只裁 /p 项目的 finding");
  });

  it("不传 projectDir 时保留 finding 自身 projectDir（不被 cwd 覆盖）", async () => {
    const log = [{ file: "a.js", line: 1, finding: "f1", projectDir: "/external/project" }];
    const resolveCode = async () => "code";
    const adjudicateFn = async ({ finding }) => ({ verdict: "true", evidence: finding });
    const results = await adjudicateLedger({ load: async () => log, resolveCode, adjudicateFn, persist: async () => {} });
    assert.equal(results[0].projectDir, "/external/project");
  });

  it("resolveLessons 提供给每条 finding 的 adjudicateFn", async () => {
    const log = [{ file: "a.js", line: 1, finding: "f1" }, { file: "b.js", line: 2, finding: "f2" }];
    const resolveCode = async () => "code";
    const seen = [];
    const adjudicateFn = async (opts) => { seen.push(opts.lessons); return { verdict: "false", evidence: "e" }; };
    await adjudicateLedger({ load: async () => log, resolveCode, adjudicateFn, persist: async () => {}, resolveLessons: async () => "- 规则：先 trace" });
    assert.deepEqual(seen, ["- 规则：先 trace", "- 规则：先 trace"], "每条 finding 都收到 lessons");
  });

  it("不传 resolveLessons 时 lessons 为空串（向后兼容）", async () => {
    const log = [{ file: "a.js", line: 1, finding: "f1" }];
    let captured = null;
    const adjudicateFn = async (opts) => { captured = opts.lessons; return { verdict: "false", evidence: "e" }; };
    await adjudicateLedger({ load: async () => log, resolveCode: async () => "code", adjudicateFn, persist: async () => {} });
    assert.equal(captured, "", "默认空串不注入");
  });

  it("resolveLessons 返回 null 不抛、透传 null", async () => {
    const log = [{ file: "a.js", line: 1, finding: "f1" }];
    let captured = "sentinel";
    const adjudicateFn = async (opts) => { captured = opts.lessons; return { verdict: "false", evidence: "e" }; };
    await adjudicateLedger({ load: async () => log, resolveCode: async () => "code", adjudicateFn, persist: async () => {}, resolveLessons: async () => null });
    assert.equal(captured, null);
  });

  it("resolveLessons 返回含换行/特殊字符原样透传", async () => {
    const log = [{ file: "a.js", line: 1, finding: "f1" }];
    let captured = null;
    const weird = "- 规则：多行\n第二行 $ 与 ` 反引号";
    const adjudicateFn = async (opts) => { captured = opts.lessons; return { verdict: "false", evidence: "e" }; };
    await adjudicateLedger({ load: async () => log, resolveCode: async () => "code", adjudicateFn, persist: async () => {}, resolveLessons: async () => weird });
    assert.equal(captured, weird);
  });
});
