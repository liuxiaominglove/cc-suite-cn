import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  modelsOf,
  matchesModel,
  isConfirmed,
  hashContent,
  verdictKey,
  dedupeVerdicts,
  persistVerdicts,
  loadVerdicts,
  getActionableFindings,
  getUncertainFindings,
  getFixContext,
  isVerdictStale,
  markFixed,
  confirmVerdict,
  getTrace,
  acquireLock,
  releaseLock,
  upsertFindings,
  appendCritic,
  appendVerdicts,
  MISTAKE_TYPES,
  isValidMistakeType,
} from "./verdict-log.mjs";

describe("modelsOf", () => {
  it("returns models array as-is", () => {
    assert.deepEqual(modelsOf({ models: ["glm-5.2", "kimi-k2.7-code"] }), ["glm-5.2", "kimi-k2.7-code"]);
  });

  it("wraps legacy single model field into array", () => {
    assert.deepEqual(modelsOf({ model: "glm-5.2" }), ["glm-5.2"]);
  });

  it("returns empty for absent models", () => {
    assert.deepEqual(modelsOf({}), []);
    assert.deepEqual(modelsOf(null), []);
  });

  it("ignores empty-string model (空字符串不算有效模型)", () => {
    assert.deepEqual(modelsOf({ model: "" }), []);
    assert.deepEqual(modelsOf({ models: ["glm-5.2", ""] }), ["glm-5.2"]);
  });
});

describe("matchesModel", () => {
  it("matches via models array", () => {
    assert.equal(matchesModel({ models: ["glm-5.2", "kimi-k2.7-code"] }, "glm-5.2"), true);
  });

  it("matches via legacy single model field", () => {
    assert.equal(matchesModel({ model: "glm-5.2" }, "glm-5.2"), true);
  });

  it("returns false when model is absent", () => {
    assert.equal(matchesModel({}, "glm-5.2"), false);
    assert.equal(matchesModel(null, "glm-5.2"), false);
  });

  it("returns false when model not in list", () => {
    assert.equal(matchesModel({ models: ["kimi-k2.7-code"] }, "glm-5.2"), false);
  });
});

describe("isConfirmed", () => {
  it("true only for confirmed final === expected (带 final 参数)", () => {
    assert.equal(isConfirmed({ confirmed: { final: "false" } }, "false"), true);
    assert.equal(isConfirmed({ confirmed: { final: "true" } }, "true"), true);
    assert.equal(isConfirmed({ confirmed: { final: "false" } }, "true"), false);
  });

  it("false without confirmed (未经终审的样本不算)", () => {
    assert.equal(isConfirmed({ verdict: "false" }, "false"), false);
    assert.equal(isConfirmed({}, "false"), false);
  });

  it("无 final 参数时，只认 confirmed.final 为 true/false", () => {
    assert.equal(isConfirmed({ confirmed: { final: "false" } }), true);
    assert.equal(isConfirmed({ confirmed: { final: "true" } }), true);
    assert.equal(isConfirmed({ confirmed: { final: "uncertain" } }), false);
    assert.equal(isConfirmed({ verdict: "false" }), false);
    assert.equal(isConfirmed(null), false);
  });

  it("两步 confirmed（含 independent/comparison）不影响判定", () => {
    const twoStep = {
      confirmed: {
        final: "true",
        reason: "终判",
        independent: { final: "false", reason: "独立判" },
        comparison: "分歧",
        confirmedAt: "t",
      },
    };
    assert.equal(isConfirmed(twoStep), true);
    assert.equal(isConfirmed({ ...twoStep, confirmed: { ...twoStep.confirmed, final: "false" } }), true);
  });

  it("safe as Array.filter callback (index 不得污染 final 参数)", () => {
    const log = [{ confirmed: { final: "true" } }, { confirmed: { final: "false" } }];
    assert.equal(log.filter(isConfirmed).length, 2, "filter 直传时 index 不得误判为 final");
  });
});

describe("hashContent", () => {
  it("returns a stable sha256 hex digest", () => {
    const a = hashContent("const x = 1;");
    const b = hashContent("const x = 1;");
    assert.equal(a, b);
    assert.match(a, /^[a-f0-9]{64}$/);
  });

  it("differs when content changes", () => {
    assert.notEqual(hashContent("a"), hashContent("b"));
  });

  it("treats non-string input as empty", () => {
    assert.equal(hashContent(null), hashContent(""));
  });
});

describe("verdictKey", () => {
  it("keys by file + line + finding", () => {
    const k = verdictKey({ file: "a.js", line: 3, finding: "x" });
    assert.ok(typeof k === "string" && k.length > 0, "应返回非空字符串");
  });

  it("相同输入产生相同 key", () => {
    const a = verdictKey({ file: "a.js", line: 3, finding: "x" });
    const b = verdictKey({ file: "a.js", line: 3, finding: "x" });
    assert.equal(a, b);
  });

  it("分量含冒号时不碰撞", () => {
    const k1 = verdictKey({ file: "a", line: "b:c", finding: "d" });
    const k2 = verdictKey({ file: "a", line: "b", finding: "c:d" });
    assert.notEqual(k1, k2, "两个不同 tuple 不得产生相同 key");
  });

  it("空分量不抛错", () => {
    const k = verdictKey({ file: "", line: null, finding: "" });
    assert.ok(typeof k === "string", "空分量应返回字符串而非抛错");
  });
});

describe("dedupeVerdicts", () => {
  it("keeps only the latest verdict per key", () => {
    const v1 = { file: "a.js", line: 1, finding: "f", verdict: "true", ts: 1 };
    const v2 = { file: "a.js", line: 1, finding: "f", verdict: "false", ts: 2 };
    const out = dedupeVerdicts([v1, v2]);
    assert.equal(out.length, 1);
    assert.equal(out[0].verdict, "false");
  });
});

describe("persistVerdicts / loadVerdicts", () => {
  it("persists and reloads verdicts atomically", async () => {
    const dir = await mkdtemp(join(tmpdir(), "verdict-"));
    const p = join(dir, "verdict-log.json");
    await persistVerdicts(
      [{ file: "a.js", line: 1, finding: "f", verdict: "true", codeHash: "h1" }],
      p
    );
    const log = await loadVerdicts(p);
    assert.equal(log.length, 1);
    assert.equal(log[0].verdict, "true");
  });

  it("dedupes when appending existing entries", async () => {
    const dir = await mkdtemp(join(tmpdir(), "verdict-"));
    const p = join(dir, "verdict-log.json");
    await persistVerdicts([{ file: "a.js", line: 1, finding: "f", verdict: "true" }], p);
    await persistVerdicts([{ file: "a.js", line: 1, finding: "f", verdict: "false" }], p);
    const log = await loadVerdicts(p);
    assert.equal(log.length, 1, "同一条 finding 应只留最新 verdict");
    assert.equal(log[0].verdict, "false");
  });

  it("重新持久化保留已 fixed 的标记", async () => {
    const dir = await mkdtemp(join(tmpdir(), "verdict-"));
    const p = join(dir, "verdict-log.json");
    await persistVerdicts([{ file: "a.js", line: 1, finding: "f", verdict: "true", fixed: { commit: "c1", testEvidence: "t" } }], p);
    await persistVerdicts([{ file: "a.js", line: 1, finding: "f", verdict: "true", codeHash: "h2" }], p);
    const log = await loadVerdicts(p);
    assert.equal(log.length, 1);
    assert.ok(log[0].fixed, "重新裁决不得抹掉 fixed 标记");
    assert.equal(log[0].fixed.commit, "c1");
  });
});

describe("loadVerdicts", () => {
  it("文件缺失返回空数组", async () => {
    assert.deepEqual(await loadVerdicts("/nonexistent/verdict-log.json"), []);
  });

  it("文件损坏时抛错（而非静默返回空导致数据被覆盖）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "verdict-"));
    const p = join(dir, "bad.json");
    await writeFile(p, "{ not json", "utf8");
    await assert.rejects(loadVerdicts(p), /corrupt|损坏|JSON/i);
  });
});

describe("getActionableFindings", () => {
  it("filters only verdict === true", () => {
    const log = [
      { file: "a.js", finding: "real", verdict: "true" },
      { file: "b.js", finding: "false positive", verdict: "false" },
      { file: "c.js", finding: "maybe", verdict: "uncertain" },
    ];
    const out = getActionableFindings(log);
    assert.equal(out.length, 1);
    assert.equal(out[0].finding, "real");
  });

  it("排除已 fixed 的条目", () => {
    const log = [
      { file: "a.js", finding: "real", verdict: "true" },
      { file: "b.js", finding: "done", verdict: "true", fixed: { commit: "c1" } },
    ];
    const out = getActionableFindings(log);
    assert.equal(out.length, 1);
    assert.equal(out[0].finding, "real");
  });

  it("排除已终审判 false 的条目（假阳不进待修清单）", () => {
    const log = [
      { file: "a.js", finding: "real", verdict: "true" },
      { file: "b.js", finding: "confirmed false", verdict: "true", confirmed: { final: "false" } },
      { file: "c.js", finding: "confirmed true", verdict: "true", confirmed: { final: "true" } },
    ];
    const out = getActionableFindings(log);
    assert.deepEqual(out.map((v) => v.finding).sort(), ["confirmed true", "real"]);
  });

  it("按 projectDir 过滤只返回该项目的可修 finding", () => {
    const log = [
      { file: "a.js", finding: "in A", verdict: "true", projectDir: "/proj/a" },
      { file: "b.js", finding: "in B", verdict: "true", projectDir: "/proj/b" },
      { file: "c.js", finding: "false positive", verdict: "false", projectDir: "/proj/a" },
    ];
    const out = getActionableFindings(log, { projectDir: "/proj/a" });
    assert.equal(out.length, 1);
    assert.equal(out[0].finding, "in A");
  });

  it("不传 projectDir 时返回全部可修 finding（兼容旧行为）", () => {
    const log = [
      { file: "a.js", finding: "in A", verdict: "true", projectDir: "/proj/a" },
      { file: "b.js", finding: "in B", verdict: "true", projectDir: "/proj/b" },
    ];
    const out = getActionableFindings(log);
    assert.equal(out.length, 2);
  });

  it("旧数据无 projectDir 时，传 projectDir 不返回", () => {
    const log = [{ file: "a.js", finding: "legacy", verdict: "true" }];
    const out = getActionableFindings(log, { projectDir: "/proj/a" });
    assert.equal(out.length, 0);
  });

  it("空账本返回空", () => {
    assert.deepEqual(getActionableFindings([], { projectDir: "/proj/a" }), []);
  });

  it("projectDir 无匹配时返回空", () => {
    const log = [{ file: "a.js", finding: "in A", verdict: "true", projectDir: "/proj/a" }];
    const out = getActionableFindings(log, { projectDir: "/nonexist" });
    assert.equal(out.length, 0);
  });
});

describe("getFixContext", () => {
  const base = [
    { file: "/proj/a.js", line: 1, finding: "本轮真", verdict: "true", auditCommit: "HEAD1", projectDir: "/proj" },
    { file: "/proj/b.js", line: 1, finding: "上一轮", verdict: "true", auditCommit: "HEAD0", projectDir: "/proj" },
    { file: "/proj/c.js", line: 1, finding: "已修", verdict: "true", auditCommit: "HEAD1", projectDir: "/proj", fixed: { commit: "c1" } },
    { file: "/proj/d.js", line: 1, finding: "判假", verdict: "false", auditCommit: "HEAD1", projectDir: "/proj" },
    { file: "/proj/e.js", line: 1, finding: "终审判假", verdict: "true", auditCommit: "HEAD1", projectDir: "/proj", confirmed: { final: "false" } },
    { file: "/proj/f.js", line: 1, finding: "无commit旧数据", verdict: "true", projectDir: "/proj" },
    { file: "/proj/g.js", line: 1, finding: "别项目", verdict: "true", auditCommit: "HEAD1", projectDir: "/other" },
  ];

  it("只返回本轮(actionable)的 finding", () => {
    const out = getFixContext(base, { projectDir: "/proj", headCommit: "HEAD1" });
    assert.deepEqual(out.map((v) => v.finding), ["本轮真"]);
  });

  it("headCommit 为 null → 全排除（fail-closed，无法关联轮次）", () => {
    assert.deepEqual(getFixContext(base, { projectDir: "/proj", headCommit: null }), []);
  });

  it("旧数据无 auditCommit → 排除（undefined !== headCommit）", () => {
    const out = getFixContext(base, { projectDir: "/proj", headCommit: "HEAD1" });
    assert.ok(!out.some((v) => v.finding === "无commit旧数据"));
  });

  it("changedFiles 相对路径按 projectDir 归一后匹配绝对 file", () => {
    const out = getFixContext(base, { projectDir: "/proj", headCommit: "HEAD1", changedFiles: ["a.js", "b.js"] });
    assert.deepEqual(out.map((v) => v.finding), ["本轮真"]);
  });

  it("changedFiles 不含某 file → 排除（即便 auditCommit 命中）", () => {
    const out = getFixContext(base, { projectDir: "/proj", headCommit: "HEAD1", changedFiles: ["zzz.js"] });
    assert.deepEqual(out, []);
  });

  it("changedFiles 为 null/undefined → 不过滤 file（仅 commit 隔离）", () => {
    const out = getFixContext(base, { projectDir: "/proj", headCommit: "HEAD1", changedFiles: null });
    assert.deepEqual(out.map((v) => v.finding), ["本轮真"]);
  });

  it("v.file 为相对路径时按 projectDir 对称归一后仍能匹配", () => {
    const log = [
      { file: "a.js", line: 1, finding: "相对file", verdict: "true", auditCommit: "HEAD1", projectDir: "/proj" },
    ];
    const out = getFixContext(log, { projectDir: "/proj", headCommit: "HEAD1", changedFiles: ["a.js"] });
    assert.deepEqual(out.map((v) => v.finding), ["相对file"]);
  });

  it("空账本 / projectDir 无匹配 → 空", () => {
    assert.deepEqual(getFixContext([], { projectDir: "/proj", headCommit: "HEAD1" }), []);
    assert.deepEqual(getFixContext(base, { projectDir: "/none", headCommit: "HEAD1" }), []);
  });
});

describe("getUncertainFindings", () => {
  it("只返回 verdict 非 true/false 的条目（uncertain/undefined/未裁决）", () => {
    const log = [
      { file: "a.js", finding: "real", verdict: "true" },
      { file: "b.js", finding: "false positive", verdict: "false" },
      { file: "c.js", finding: "uncertain", verdict: "uncertain" },
      { file: "d.js", finding: "undefined", verdict: "undefined" },
      { file: "e.js", finding: "unadjudicated" },
    ];
    const out = getUncertainFindings(log);
    assert.deepEqual(out.map((v) => v.finding).sort(), ["uncertain", "unadjudicated", "undefined"].sort());
  });

  it("按 projectDir 过滤", () => {
    const log = [
      { file: "a.js", finding: "uA", verdict: "uncertain", projectDir: "/proj/a" },
      { file: "b.js", finding: "uB", verdict: "uncertain", projectDir: "/proj/b" },
    ];
    const out = getUncertainFindings(log, { projectDir: "/proj/a" });
    assert.equal(out.length, 1);
    assert.equal(out[0].finding, "uA");
  });

  it("全 true/false 时返回空", () => {
    const log = [
      { file: "a.js", finding: "t", verdict: "true" },
      { file: "b.js", finding: "f", verdict: "false" },
    ];
    assert.deepEqual(getUncertainFindings(log), []);
  });
});

describe("isVerdictStale", () => {
  it("returns false when current content matches codeHash", () => {
    const content = "const x = 1;";
    const v = { codeHash: hashContent(content) };
    assert.equal(isVerdictStale(v, content), false);
  });

  it("returns true when content changed since verdict", () => {
    const v = { codeHash: hashContent("old code") };
    assert.equal(isVerdictStale(v, "new code"), true);
  });

  it("returns true when verdict has no codeHash (legacy)", () => {
    assert.equal(isVerdictStale({ verdict: "true" }, "anything"), true);
  });

  it("throws when currentContent is missing (缺参 fail-closed)", () => {
    const v = { codeHash: hashContent("old") };
    assert.throws(() => isVerdictStale(v), /currentContent/);
    assert.throws(() => isVerdictStale(v, undefined), /currentContent/);
    assert.throws(() => isVerdictStale(v, null), /currentContent/);
  });
});

describe("persistVerdicts 并发安全", () => {
  it("并发调用不丢失更新（进程内串行化）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "verdict-"));
    const p = join(dir, "log.json");
    await Promise.all([
      persistVerdicts([{ file: "a.js", line: 1, finding: "f1", verdict: "true" }], p),
      persistVerdicts([{ file: "b.js", line: 1, finding: "f2", verdict: "true" }], p),
      persistVerdicts([{ file: "c.js", line: 1, finding: "f3", verdict: "false" }], p),
    ]);
    const log = await loadVerdicts(p);
    assert.equal(log.length, 3, "三次并发写入都应保留");
  });

  it("写入后不残留 tmp 文件", async () => {
    const dir = await mkdtemp(join(tmpdir(), "verdict-"));
    const p = join(dir, "log.json");
    await persistVerdicts([{ file: "a.js", line: 1, finding: "f", verdict: "true" }], p);
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(dir);
    const tmps = files.filter((f) => f.includes(".verdict-") && f.endsWith(".tmp"));
    assert.equal(tmps.length, 0, "不应残留 .tmp 文件");
  });
});

describe("markFixed / getTrace", () => {
  it("markFixed 给匹配 finding 追加 fixed 字段", async () => {
    const dir = await mkdtemp(join(tmpdir(), "verdict-"));
    const p = join(dir, "log.json");
    await persistVerdicts([{ file: "a.js", line: 1, finding: "f", verdict: "true", codeHash: "h1" }], p);
    const r = await markFixed("a.js", 1, "f", { commit: "c1", testEvidence: "test:foo" }, p);
    assert.ok(r, "应找到匹配条目");
    assert.equal(r.fixed.commit, "c1");
    assert.equal(r.fixed.testEvidence, "test:foo");
    const log = await loadVerdicts(p);
    assert.equal(log[0].fixed.commit, "c1", "持久化后 fixed 字段应存在");
  });

  it("markFixed 匹配不上返回 null", async () => {
    const dir = await mkdtemp(join(tmpdir(), "verdict-"));
    const p = join(dir, "log.json");
    const r = await markFixed("x.js", 1, "不存在", { commit: "c1" }, p);
    assert.equal(r, null);
  });

  it("markFixed finding 为 null 安全返回 null", async () => {
    const dir = await mkdtemp(join(tmpdir(), "verdict-"));
    const p = join(dir, "log.json");
    const r = await markFixed("a.js", 1, null, { commit: "c1" }, p);
    assert.equal(r, null);
  });

  it("getTrace 返回完整链路", async () => {
    const dir = await mkdtemp(join(tmpdir(), "verdict-"));
    const p = join(dir, "log.json");
    await persistVerdicts([{ file: "a.js", line: 1, finding: "f", verdict: "true", evidence: "e", codeHash: "h1" }], p);
    await markFixed("a.js", 1, "f", { commit: "c1", testEvidence: "t" }, p);
    const trace = await getTrace("a.js", 1, "f", p);
    assert.equal(trace.verdict, "true");
    assert.equal(trace.evidence, "e");
    assert.equal(trace.codeHash, "h1");
    assert.equal(trace.fixed.commit, "c1");
    assert.equal(trace.fixed.testEvidence, "t");
  });

  it("getTrace 无记录返回 null", async () => {
    const dir = await mkdtemp(join(tmpdir(), "verdict-"));
    const p = join(dir, "log.json");
    const trace = await getTrace("不存在", 1, "f", p);
    assert.equal(trace, null);
  });
});

describe("markFixed 并发安全", () => {
  it("markFixed 与 persistVerdicts 并发不丢数据", async () => {
    const dir = await mkdtemp(join(tmpdir(), "verdict-"));
    const p = join(dir, "log.json");
    await persistVerdicts([{ file: "a.js", line: 1, finding: "f", verdict: "true" }], p);
    await Promise.all([
      markFixed("a.js", 1, "f", { commit: "c1", testEvidence: "t" }, p),
      persistVerdicts([{ file: "b.js", line: 1, finding: "g", verdict: "true" }], p),
    ]);
    const log = await loadVerdicts(p);
    assert.equal(log.length, 2, "并发后两条都应保留");
    const a = log.find((v) => v.file === "a.js");
    assert.equal(a.fixed.commit, "c1", "markFixed 的 fixed 字段应存在");
  });
});

describe("markFixed rootCause", () => {
  it("markFixed 传 rootCause 写入 fixed 对象", async () => {
    const dir = await mkdtemp(join(tmpdir(), "verdict-"));
    const p = join(dir, "log.json");
    await persistVerdicts([{ file: "a.js", line: 1, finding: "f", verdict: "true" }], p);
    const r = await markFixed("a.js", 1, "f", { commit: "c1", testEvidence: "t", rootCause: "边界条件" }, p);
    assert.equal(r.fixed.rootCause, "边界条件");
  });

  it("markFixed 不传 rootCause 不报错（可选字段）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "verdict-"));
    const p = join(dir, "log.json");
    await persistVerdicts([{ file: "a.js", line: 1, finding: "f", verdict: "true" }], p);
    const r = await markFixed("a.js", 1, "f", { commit: "c1", testEvidence: "t" }, p);
    assert.equal(r.fixed.rootCause, undefined);
  });

  it("getTrace 透传 rootCause", async () => {
    const dir = await mkdtemp(join(tmpdir(), "verdict-"));
    const p = join(dir, "log.json");
    await persistVerdicts([{ file: "a.js", line: 1, finding: "f", verdict: "true" }], p);
    await markFixed("a.js", 1, "f", { commit: "c1", testEvidence: "t", rootCause: "信任边界" }, p);
    const trace = await getTrace("a.js", 1, "f", p);
    assert.equal(trace.fixed.rootCause, "信任边界");
  });
});

describe("confirmVerdict", () => {
  it("给匹配 finding 追加 confirmed 终审标签（两步）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "verdict-"));
    const p = join(dir, "log.json");
    await persistVerdicts([{ file: "a.js", line: 1, finding: "f", verdict: "false" }], p);
    const r = await confirmVerdict("a.js", 1, "f", {
      final: "false", reason: "代码级核实：已有守卫",
      independent: { final: "false", reason: "独立判：已有守卫" },
      comparison: "一致",
    }, p);
    assert.ok(r, "应找到匹配条目");
    assert.equal(r.confirmed.final, "false");
    assert.ok(r.confirmed.reason.includes("守卫"));
    assert.equal(r.confirmed.independent.final, "false");
    assert.equal(r.confirmed.independent.reason, "独立判：已有守卫");
    assert.equal(r.confirmed.comparison, "一致");
    const log = await loadVerdicts(p);
    assert.equal(log[0].confirmed.final, "false", "持久化后 confirmed 应存在");
  });

  it("final 非 true/false 时抛错", async () => {
    const dir = await mkdtemp(join(tmpdir(), "verdict-"));
    const p = join(dir, "log.json");
    await persistVerdicts([{ file: "a.js", line: 1, finding: "f", verdict: "false" }], p);
    await assert.rejects(confirmVerdict("a.js", 1, "f", { final: "maybe" }, p), /true|false/i);
  });

  it("reason 空时抛错（终审依据不能为空）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "verdict-"));
    const p = join(dir, "log.json");
    await persistVerdicts([{ file: "a.js", line: 1, finding: "f", verdict: "false" }], p);
    await assert.rejects(confirmVerdict("a.js", 1, "f", { final: "false", reason: "  " }, p), /reason/i);
  });

  it("缺 independent 抛错（两步终审必须落实）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "verdict-"));
    const p = join(dir, "log.json");
    await persistVerdicts([{ file: "a.js", line: 1, finding: "f", verdict: "false" }], p);
    await assert.rejects(confirmVerdict("a.js", 1, "f", { final: "false", reason: "r" }, p), /independent/i);
  });

  it("匹配不上返回 null", async () => {
    const dir = await mkdtemp(join(tmpdir(), "verdict-"));
    const p = join(dir, "log.json");
    const r = await confirmVerdict("x.js", 1, "不存在", { final: "false", reason: "r", independent: { final: "false", reason: "i" }, comparison: "c" }, p);
    assert.equal(r, null);
  });

  it("final=false 传合法 mistakeType 落库", async () => {
    const dir = await mkdtemp(join(tmpdir(), "verdict-"));
    const p = join(dir, "log.json");
    await persistVerdicts([{ file: "a.js", line: 1, finding: "f", verdict: "false" }], p);
    const r = await confirmVerdict("a.js", 1, "f", {
      final: "false", reason: "r", independent: { final: "false", reason: "i" }, comparison: "c", mistakeType: "path-normalized",
    }, p);
    assert.equal(r.confirmed.mistakeType, "path-normalized");
    const log = await loadVerdicts(p);
    assert.equal(log[0].confirmed.mistakeType, "path-normalized", "持久化后 mistakeType 应存在");
  });

  it("final=false 不传/null/undefined mistakeType 不存该字段", async () => {
    for (const mt of [undefined, null]) {
      const dir = await mkdtemp(join(tmpdir(), "verdict-"));
      const p = join(dir, "log.json");
      await persistVerdicts([{ file: "a.js", line: 1, finding: "f", verdict: "false" }], p);
      const r = await confirmVerdict("a.js", 1, "f", {
        final: "false", reason: "r", independent: { final: "false", reason: "i" }, comparison: "c", mistakeType: mt,
      }, p);
      assert.ok(!("mistakeType" in r.confirmed), "mistakeType 为 null/undefined 不应落字段");
    }
  });

  it("final=false 非法 mistakeType 抛错", async () => {
    const dir = await mkdtemp(join(tmpdir(), "verdict-"));
    const p = join(dir, "log.json");
    await persistVerdicts([{ file: "a.js", line: 1, finding: "f", verdict: "false" }], p);
    await assert.rejects(
      confirmVerdict("a.js", 1, "f", { final: "false", reason: "r", independent: { final: "false", reason: "i" }, comparison: "c", mistakeType: "foo" }, p),
      /mistakeType/
    );
  });

  it("final=false 非字符串 mistakeType 抛错", async () => {
    const dir = await mkdtemp(join(tmpdir(), "verdict-"));
    const p = join(dir, "log.json");
    await persistVerdicts([{ file: "a.js", line: 1, finding: "f", verdict: "false" }], p);
    await assert.rejects(
      confirmVerdict("a.js", 1, "f", { final: "false", reason: "r", independent: { final: "false", reason: "i" }, comparison: "c", mistakeType: 123 }, p),
      /mistakeType/
    );
  });

  it("final=false 空串/带空白 mistakeType 抛错", async () => {
    for (const mt of ["", " path-normalized "]) {
      const dir = await mkdtemp(join(tmpdir(), "verdict-"));
      const p = join(dir, "log.json");
      await persistVerdicts([{ file: "a.js", line: 1, finding: "f", verdict: "false" }], p);
      await assert.rejects(
        confirmVerdict("a.js", 1, "f", { final: "false", reason: "r", independent: { final: "false", reason: "i" }, comparison: "c", mistakeType: mt }, p),
        /mistakeType/
      );
    }
  });

  it("final=true 传 mistakeType 忽略（不落字段）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "verdict-"));
    const p = join(dir, "log.json");
    await persistVerdicts([{ file: "a.js", line: 1, finding: "f", verdict: "true" }], p);
    const r = await confirmVerdict("a.js", 1, "f", {
      final: "true", reason: "r", independent: { final: "true", reason: "i" }, comparison: "c", mistakeType: "by-design",
    }, p);
    assert.ok(!("mistakeType" in r.confirmed), "final=true 不应落 mistakeType");
  });

  it("getTrace 透传 confirmed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "verdict-"));
    const p = join(dir, "log.json");
    await persistVerdicts([{ file: "a.js", line: 1, finding: "f", verdict: "false" }], p);
    await confirmVerdict("a.js", 1, "f", { final: "false", reason: "r", independent: { final: "false", reason: "i" }, comparison: "c" }, p);
    const trace = await getTrace("a.js", 1, "f", p);
    assert.equal(trace.confirmed.final, "false");
  });

  it("getTrace 全链路（报→批→裁→终审两步→修）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "verdict-"));
    const p = join(dir, "log.json");
    await upsertFindings([{ file: "a.js", line: 1, finding: "f", fix: "fix1", chainAnalysis: "ca", models: ["glm-5.2"], source: "audit" }], p);
    await appendCritic([{ file: "a.js", line: 1, finding: "f", agree: false, reason: "已有守卫" }], p);
    await appendVerdicts([{ file: "a.js", line: 1, finding: "f", verdict: "true", evidence: "ev", codeHash: "h" }], p);
    await confirmVerdict("a.js", 1, "f", { final: "true", reason: "r", independent: { final: "true", reason: "i" }, comparison: "一致" }, p);
    await markFixed("a.js", 1, "f", { commit: "c1", testEvidence: "t", rootCause: "边界" }, p);
    const trace = await getTrace("a.js", 1, "f", p);
    assert.equal(trace.finding, "f");
    assert.equal(trace.fix, "fix1");
    assert.equal(trace.chainAnalysis, "ca");
    assert.deepEqual(trace.models, ["glm-5.2"]);
    assert.equal(trace.source, "audit");
    assert.equal(trace.critic.agree, false);
    assert.equal(trace.critic.reason, "已有守卫");
    assert.equal(trace.verdict, "true");
    assert.equal(trace.evidence, "ev");
    assert.equal(trace.confirmed.independent.final, "true");
    assert.equal(trace.confirmed.comparison, "一致");
    assert.equal(trace.fixed.rootCause, "边界");
  });

  it("getTrace 半条记录各环节为 null", async () => {
    const dir = await mkdtemp(join(tmpdir(), "verdict-"));
    const p = join(dir, "log.json");
    await upsertFindings([{ file: "a.js", line: 1, finding: "f", fix: "fix1" }], p);
    const trace = await getTrace("a.js", 1, "f", p);
    assert.equal(trace.finding, "f");
    assert.equal(trace.fix, "fix1");
    assert.equal(trace.critic, null);
    assert.equal(trace.verdict, null);
    assert.equal(trace.confirmed, null);
    assert.equal(trace.fixed, null);
  });
});

describe("acquireLock / releaseLock（租约锁）", () => {
  it("acquire 后 release 可再次 acquire", async () => {
    const dir = await mkdtemp(join(tmpdir(), "verdict-lock-"));
    const lockPath = join(dir, "lock");
    await acquireLock(lockPath, { maxWaitMs: 1000, retryMs: 10 });
    await releaseLock(lockPath);
    await acquireLock(lockPath, { maxWaitMs: 1000, retryMs: 10 });
    await releaseLock(lockPath);
  });

  it("死锁接管：持有者 PID 已死", async () => {
    const dir = await mkdtemp(join(tmpdir(), "verdict-lock-"));
    const lockPath = join(dir, "lock");
    await writeFile(lockPath, JSON.stringify({ pid: 99999999, expiresAt: Date.now() + 60000 }));
    await acquireLock(lockPath, { maxWaitMs: 1000, retryMs: 10 });
    await releaseLock(lockPath);
  });

  it("TTL 过期接管（持有者活着但租约已过）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "verdict-lock-"));
    const lockPath = join(dir, "lock");
    await writeFile(lockPath, JSON.stringify({ pid: process.pid, expiresAt: Date.now() - 1000 }));
    await acquireLock(lockPath, { maxWaitMs: 1000, retryMs: 10 });
    await releaseLock(lockPath);
  });

  it("持有者活着且未过期则超时", async () => {
    const dir = await mkdtemp(join(tmpdir(), "verdict-lock-"));
    const lockPath = join(dir, "lock");
    await writeFile(lockPath, JSON.stringify({ pid: process.pid, expiresAt: Date.now() + 60000 }));
    await assert.rejects(acquireLock(lockPath, { maxWaitMs: 300, retryMs: 10 }), /timeout/i);
  });

  it("releaseLock 只删自己的锁，不删别人的", async () => {
    const dir = await mkdtemp(join(tmpdir(), "verdict-lock-"));
    const lockPath = join(dir, "lock");
    await writeFile(lockPath, JSON.stringify({ pid: 99999999, expiresAt: Date.now() + 60000 }));
    await releaseLock(lockPath);
    const stillThere = await readFile(lockPath, "utf-8").then(() => true).catch(() => false);
    assert.equal(stillThere, true, "别人的锁不得被删除");
  });

  it("releaseLock 删自己的锁", async () => {
    const dir = await mkdtemp(join(tmpdir(), "verdict-lock-"));
    const lockPath = join(dir, "lock");
    await writeFile(lockPath, JSON.stringify({ pid: process.pid, expiresAt: Date.now() + 60000 }));
    await releaseLock(lockPath);
    const gone = await readFile(lockPath, "utf-8").then(() => false).catch(() => true);
    assert.equal(gone, true, "自己的锁应被删除");
  });

  it("corrupt 锁文件能被清理（不卡死到超时）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "verdict-lock-"));
    const lockPath = join(dir, "lock");
    await writeFile(lockPath, "not valid json {{{");
    await acquireLock(lockPath, { maxWaitMs: 2000, retryMs: 10 });
    await releaseLock(lockPath);
  });
});

describe("upsertFindings", () => {
  it("新条目落账（含 fix/chainAnalysis/models/source）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "verdict-"));
    const p = join(dir, "log.json");
    await upsertFindings([{ file: "a.js", line: 1, finding: "f", fix: "fix1", chainAnalysis: "ca", models: ["glm-5.2"], source: "audit" }], p);
    const log = await loadVerdicts(p);
    assert.equal(log.length, 1);
    assert.equal(log[0].fix, "fix1");
    assert.equal(log[0].chainAnalysis, "ca");
    assert.deepEqual(log[0].models, ["glm-5.2"]);
    assert.equal(log[0].source, "audit");
  });

  it("同 key 重复落账不重复建（幂等）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "verdict-"));
    const p = join(dir, "log.json");
    const e = { file: "a.js", line: 1, finding: "f", fix: "fix1", models: ["glm-5.2"], source: "audit" };
    await upsertFindings([e], p);
    await upsertFindings([{ ...e, fix: "fix2" }], p);
    const log = await loadVerdicts(p);
    assert.equal(log.length, 1, "同 key 不得重复建");
  });

  it("fill-missing-only：不覆盖已有 verdict/confirmed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "verdict-"));
    const p = join(dir, "log.json");
    const e = { file: "a.js", line: 1, finding: "f", fix: "fix1", models: ["glm-5.2"], source: "audit" };
    await upsertFindings([e], p);
    // 模拟裁决 + 终审
    await persistVerdicts([{ file: "a.js", line: 1, finding: "f", verdict: "true", evidence: "ev" }], p);
    await confirmVerdict("a.js", 1, "f", { final: "true", reason: "r", independent: { final: "true", reason: "i" }, comparison: "c" }, p);
    // 重跑落账（模拟 runAudit 重跑）
    await upsertFindings([{ ...e, fix: "fix-changed" }], p);
    const log = await loadVerdicts(p);
    assert.equal(log[0].verdict, "true", "重跑落账不得覆盖 verdict");
    assert.equal(log[0].confirmed.final, "true", "重跑落账不得覆盖 confirmed");
  });

  it("models 合并（多模型报同一 finding）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "verdict-"));
    const p = join(dir, "log.json");
    await upsertFindings([{ file: "a.js", line: 1, finding: "f", models: ["glm-5.2"], source: "audit" }], p);
    await upsertFindings([{ file: "a.js", line: 1, finding: "f", models: ["kimi-k2.7-code"], source: "audit" }], p);
    const log = await loadVerdicts(p);
    assert.deepEqual(log[0].models.sort(), ["glm-5.2", "kimi-k2.7-code"].sort());
  });
});

describe("appendCritic", () => {
  it("追加 critic 到匹配条目", async () => {
    const dir = await mkdtemp(join(tmpdir(), "verdict-"));
    const p = join(dir, "log.json");
    await upsertFindings([{ file: "a.js", line: 1, finding: "f", models: ["glm-5.2"], source: "audit" }], p);
    await appendCritic([{ file: "a.js", line: 1, finding: "f", agree: false, reason: "已有守卫" }], p);
    const log = await loadVerdicts(p);
    assert.equal(log[0].critic.agree, false);
    assert.equal(log[0].critic.reason, "已有守卫");
  });

  it("匹配不上跳过不崩", async () => {
    const dir = await mkdtemp(join(tmpdir(), "verdict-"));
    const p = join(dir, "log.json");
    await upsertFindings([{ file: "a.js", line: 1, finding: "f" }], p);
    await appendCritic([{ file: "不存在.js", line: 9, finding: "x", agree: true, reason: "r" }], p);
    const log = await loadVerdicts(p);
    assert.equal(log[0].critic, undefined, "匹配不上不得写 critic");
  });

  it("空 entries 不崩", async () => {
    const dir = await mkdtemp(join(tmpdir(), "verdict-"));
    const p = join(dir, "log.json");
    await appendCritic([], p);
    assert.deepEqual(await loadVerdicts(p), []);
  });
});

describe("appendVerdicts", () => {
  it("追加 verdict 到已有 finding（保留 fix/chainAnalysis/source）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "verdict-"));
    const p = join(dir, "log.json");
    await upsertFindings([{ file: "a.js", line: 1, finding: "f", fix: "fix1", chainAnalysis: "ca", models: ["glm-5.2"], source: "audit" }], p);
    await appendVerdicts([{ file: "a.js", line: 1, finding: "f", verdict: "true", evidence: "ev", codeHash: "h1" }], p);
    const log = await loadVerdicts(p);
    assert.equal(log.length, 1, "不得新建重复条目");
    assert.equal(log[0].verdict, "true");
    assert.equal(log[0].evidence, "ev");
    assert.equal(log[0].fix, "fix1", "必须保留找 bug 阶段的 fix");
    assert.equal(log[0].chainAnalysis, "ca");
    assert.equal(log[0].source, "audit");
  });

  it("找不到时新建条目", async () => {
    const dir = await mkdtemp(join(tmpdir(), "verdict-"));
    const p = join(dir, "log.json");
    await appendVerdicts([{ file: "x.js", line: 1, finding: "f", verdict: "false", evidence: "e" }], p);
    const log = await loadVerdicts(p);
    assert.equal(log.length, 1);
    assert.equal(log[0].verdict, "false");
  });

  it("重跑覆盖 verdict/evidence（更新）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "verdict-"));
    const p = join(dir, "log.json");
    await upsertFindings([{ file: "a.js", line: 1, finding: "f" }], p);
    await appendVerdicts([{ file: "a.js", line: 1, finding: "f", verdict: "true", evidence: "old" }], p);
    await appendVerdicts([{ file: "a.js", line: 1, finding: "f", verdict: "false", evidence: "new" }], p);
    const log = await loadVerdicts(p);
    assert.equal(log[0].verdict, "false", "重跑应覆盖 verdict");
    assert.equal(log[0].evidence, "new");
  });

  it("透传 requiresManualVerify（新条目 + 已有条目）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "verdict-"));
    const p = join(dir, "log.json");
    await upsertFindings([{ file: "a.js", line: 1, finding: "f" }], p);
    await appendVerdicts([{ file: "a.js", line: 1, finding: "f", verdict: "true", requiresManualVerify: true }], p);
    let log = await loadVerdicts(p);
    assert.equal(log[0].requiresManualVerify, true, "已有条目应写入 requiresManualVerify");

    await appendVerdicts([{ file: "b.js", line: 1, finding: "g", verdict: "false", requiresManualVerify: false }], p);
    log = await loadVerdicts(p);
    const b = log.find((v) => v.file === "b.js");
    assert.equal(b.requiresManualVerify, false, "新条目应透传 requiresManualVerify=false");
  });
});

describe("isValidMistakeType", () => {
  it("合法枚举返回 true", () => {
    for (const t of MISTAKE_TYPES) {
      assert.equal(isValidMistakeType(t), true, `${t} 应合法`);
    }
  });

  it("prompt-injection-misattributed 是合法枚举", () => {
    assert.equal(isValidMistakeType("prompt-injection-misattributed"), true);
    assert.ok(MISTAKE_TYPES.includes("prompt-injection-misattributed"));
  });

  it("非法字符串返回 false", () => {
    assert.equal(isValidMistakeType("foo"), false);
    assert.equal(isValidMistakeType(""), false);
    assert.equal(isValidMistakeType("path-normalized "), false);
  });

  it("null/undefined/非字符串返回 false", () => {
    assert.equal(isValidMistakeType(null), false);
    assert.equal(isValidMistakeType(undefined), false);
    assert.equal(isValidMistakeType(123), false);
    assert.equal(isValidMistakeType({}), false);
  });

  it("大小写变体不合法（严格 kebab-case）", () => {
    assert.equal(isValidMistakeType("Path-Normalized"), false);
    assert.equal(isValidMistakeType("BY_DESIGN"), false);
  });
});
