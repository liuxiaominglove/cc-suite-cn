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
    assert.equal(k, "a.js:3:x");
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
});

describe("loadVerdicts", () => {
  it("returns empty array when file missing or corrupt", async () => {
    assert.deepEqual(await loadVerdicts("/nonexistent/verdict-log.json"), []);
    const dir = await mkdtemp(join(tmpdir(), "verdict-"));
    const p = join(dir, "bad.json");
    await writeFile(p, "{ not json", "utf8");
    assert.deepEqual(await loadVerdicts(p), []);
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
