import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  hashContent,
  verdictKey,
  dedupeVerdicts,
  persistVerdicts,
  loadVerdicts,
  getActionableFindings,
  isVerdictStale,
  markFixed,
  confirmVerdict,
  getTrace,
} from "./verdict-log.mjs";

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
  it("给匹配 finding 追加 confirmed 终审标签", async () => {
    const dir = await mkdtemp(join(tmpdir(), "verdict-"));
    const p = join(dir, "log.json");
    await persistVerdicts([{ file: "a.js", line: 1, finding: "f", verdict: "false" }], p);
    const r = await confirmVerdict("a.js", 1, "f", { final: "false", reason: "代码级核实：已有守卫" }, p);
    assert.ok(r, "应找到匹配条目");
    assert.equal(r.confirmed.final, "false");
    assert.ok(r.confirmed.reason.includes("守卫"));
    const log = await loadVerdicts(p);
    assert.equal(log[0].confirmed.final, "false", "持久化后 confirmed 应存在");
  });

  it("final 非 true/false 时抛错", async () => {
    const dir = await mkdtemp(join(tmpdir(), "verdict-"));
    const p = join(dir, "log.json");
    await persistVerdicts([{ file: "a.js", line: 1, finding: "f", verdict: "false" }], p);
    await assert.rejects(confirmVerdict("a.js", 1, "f", { final: "maybe" }, p), /true|false/i);
  });

  it("匹配不上返回 null", async () => {
    const dir = await mkdtemp(join(tmpdir(), "verdict-"));
    const p = join(dir, "log.json");
    const r = await confirmVerdict("x.js", 1, "不存在", { final: "false" }, p);
    assert.equal(r, null);
  });

  it("getTrace 透传 confirmed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "verdict-"));
    const p = join(dir, "log.json");
    await persistVerdicts([{ file: "a.js", line: 1, finding: "f", verdict: "false" }], p);
    await confirmVerdict("a.js", 1, "f", { final: "false", reason: "r" }, p);
    const trace = await getTrace("a.js", 1, "f", p);
    assert.equal(trace.confirmed.final, "false");
  });
});
