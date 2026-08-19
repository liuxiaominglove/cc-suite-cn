import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { decide, isCodeFile, markReviewed, stageHashes, loadGate } from "./review-gate.mjs";
import { hashContent } from "./verdict-log.mjs";

const GATE = fileURLToPath(new URL("./review-gate.mjs", import.meta.url));

describe("isCodeFile", () => {
  it("代码扩展名为 true", () => {
    assert.equal(isCodeFile("scripts/foo.mjs"), true);
    assert.equal(isCodeFile("a.js"), true);
    assert.equal(isCodeFile("a.ts"), true);
    assert.equal(isCodeFile("a.py"), true);
  });

  it("hook 脚本（无扩展名）也算代码", () => {
    assert.equal(isCodeFile(".githooks/pre-commit"), true);
  });

  it("非代码扩展名为 false", () => {
    assert.equal(isCodeFile("a.md"), false);
    assert.equal(isCodeFile("a.json"), false);
    assert.equal(isCodeFile("docs/x.txt"), false);
  });
});

describe("decide", () => {
  it("无代码改动 → pass", () => {
    assert.deepEqual(decide(null, {}), { action: "pass", reason: "no-code-changes", files: [] });
  });

  it("无标记 + 有代码 → confirm unreviewed", () => {
    const r = decide(null, { "a.mjs": "h1" });
    assert.equal(r.action, "confirm");
    assert.equal(r.reason, "unreviewed");
    assert.deepEqual(r.files, ["a.mjs"]);
  });

  it("hash 匹配 + clean → pass", () => {
    const gate = { files: { "a.mjs": "h1" }, verdict: "clean" };
    assert.equal(decide(gate, { "a.mjs": "h1" }).action, "pass");
  });

  it("hash 匹配 + medium → confirm", () => {
    const gate = { files: { "a.mjs": "h1" }, verdict: "medium" };
    const r = decide(gate, { "a.mjs": "h1" });
    assert.equal(r.action, "confirm");
    assert.equal(r.reason, "medium-unfixed");
  });

  it("hash 匹配 + high → block（硬拦）", () => {
    const gate = { files: { "a.mjs": "h1" }, verdict: "high" };
    const r = decide(gate, { "a.mjs": "h1" });
    assert.equal(r.action, "block");
    assert.equal(r.reason, "high-unfixed");
  });

  it("high + 复审后改动 → 仍 block（不降级为 confirm 绕过）", () => {
    const gate = { files: { "a.mjs": "h1" }, verdict: "high" };
    const r = decide(gate, { "a.mjs": "h2" });
    assert.equal(r.action, "block");
    assert.equal(r.reason, "high-unfixed");
  });

  it("verdict 未知 → confirm（保守，不 fall-through 放行）", () => {
    const gate = { files: { "a.mjs": "h1" }, verdict: "whatever" };
    const r = decide(gate, { "a.mjs": "h1" });
    assert.equal(r.action, "confirm");
    assert.equal(r.reason, "unknown-verdict");
  });

  it("复审后改动（hash 不匹配）→ confirm changed-since-review", () => {
    const gate = { files: { "a.mjs": "h1" }, verdict: "clean" };
    const r = decide(gate, { "a.mjs": "h2" });
    assert.equal(r.action, "confirm");
    assert.equal(r.reason, "changed-since-review");
    assert.deepEqual(r.files, ["a.mjs"]);
  });

  it("复审后新增代码文件 → confirm changed-since-review", () => {
    const gate = { files: { "a.mjs": "h1" }, verdict: "clean" };
    const r = decide(gate, { "a.mjs": "h1", "b.mjs": "h2" });
    assert.equal(r.action, "confirm");
    assert.equal(r.reason, "changed-since-review");
    assert.deepEqual(r.files, ["b.mjs"]);
  });
});

describe("markReviewed", () => {
  it("写 files hash + verdict（原子写 tmp+rename）", async () => {
    let written = null;
    let renamed = null;
    const r = await markReviewed({
      files: ["a.mjs"],
      verdict: "medium",
      filePath: "/tmp/rg.json",
      readFile: async () => "code-content",
      writeFile: async (p, d) => { written = d; },
      mkdir: async () => {},
      rename: async (a, b) => { renamed = [a, b]; },
    });
    assert.equal(r.files["a.mjs"], hashContent("code-content"), "应记录文件内容 hash");
    assert.equal(r.verdict, "medium");
    assert.ok(written.includes('"verdict": "medium"'), written);
    assert.ok(written.includes('"a.mjs"'), written);
    assert.deepEqual(renamed, ["/tmp/rg.json.tmp", "/tmp/rg.json"]);
  });
});

describe("stageHashes", () => {
  it("用 git show 读 staged 内容算 hash", async () => {
    const hashes = await stageHashes(["a.mjs"], { gitShow: async () => "code" });
    assert.equal(hashes["a.mjs"], hashContent("code"));
  });

  it("git show 读不到 → hash 'deleted'（与 markReviewed 删除语义对齐）", async () => {
    const hashes = await stageHashes(["a.mjs"], { gitShow: async () => { throw new Error("fail"); } });
    assert.equal(hashes["a.mjs"], "deleted");
  });
});

describe("loadGate", () => {
  it("有效标记 → 返回对象", async () => {
    const gate = await loadGate({ filePath: "/tmp/rg.json", readFile: async () => '{"files":{},"verdict":"clean"}' });
    assert.deepEqual(gate, { files: {}, verdict: "clean" });
  });

  it("文件不存在 → null", async () => {
    const gate = await loadGate({ filePath: "/tmp/rg.json", readFile: async () => { throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); } });
    assert.equal(gate, null);
  });

  it("损坏 JSON → null", async () => {
    const gate = await loadGate({ filePath: "/tmp/rg.json", readFile: async () => "not json" });
    assert.equal(gate, null);
  });
});

describe("CLI", () => {
  it("--mark 拒绝非法 verdict（exit 1，不写标记）", () => {
    const r = spawnSync(process.execPath, [GATE, "--mark", "--verdict", "bogus"], { encoding: "utf8" });
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes("clean|medium|high"), r.stderr);
  });

  it("--mark 缺 --verdict 报错（禁止默认 clean 静默放行）", () => {
    const r = spawnSync(process.execPath, [GATE, "--mark"], { encoding: "utf8" });
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes("--verdict 必填"), r.stderr);
  });

  it("缺少 --mark 报用法（exit 1）", () => {
    const r = spawnSync(process.execPath, [GATE], { encoding: "utf8" });
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes("Usage"), r.stderr);
  });
});
