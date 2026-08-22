import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { decide, isCodeFile, markReviewed, stageHashes, loadGate, verdictFromFindings, isDiffUnchanged, downgradeKnownLowRisk, isKnownLowRiskFinding } from "./review-gate.mjs";
import { hashContent } from "./verdict-log.mjs";

const GATE = fileURLToPath(new URL("./review-gate.mjs", import.meta.url));

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "cc-gate-"));
  spawnSync("git", ["init", "-q"], { cwd: dir });
  spawnSync("git", ["config", "user.email", "t@t"], { cwd: dir });
  spawnSync("git", ["config", "user.name", "t"], { cwd: dir });
  writeFileSync(join(dir, "a.mjs"), "export const x = 1;\n");
  spawnSync("git", ["add", "a.mjs"], { cwd: dir });
  spawnSync("git", ["commit", "-qm", "init"], { cwd: dir });
  return dir;
}

function runGate(args, cwd, gatePath) {
  return spawnSync(process.execPath, [GATE, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CC_REVIEW_GATE_PATH: gatePath },
  });
}

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

  it("复审后文件读失败(unreadable) → confirm（fail-closed，不许 pass）", () => {
    const gate = { files: { "a.mjs": "h1" }, verdict: "clean" };
    const r = decide(gate, { "a.mjs": "unreadable" });
    assert.equal(r.action, "confirm");
    assert.equal(r.reason, "changed-since-review");
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

  it("git show 超限读失败 → hash 'unreadable'（不静默当删除）", async () => {
    const err = new Error("stdout maxBuffer length exceeded");
    err.code = "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
    const hashes = await stageHashes(["a.mjs"], { gitShow: async () => { throw err; } });
    assert.equal(hashes["a.mjs"], "unreadable");
  });

  it("git show 超限读失败（仅 message 含 maxBuffer、无 code）→ 'unreadable'", async () => {
    const err = new Error("stdout maxBuffer length exceeded");
    const hashes = await stageHashes(["a.mjs"], { gitShow: async () => { throw err; } });
    assert.equal(hashes["a.mjs"], "unreadable");
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

describe("verdictFromFindings", () => {
  it("空 / 全 low → clean", () => {
    assert.equal(verdictFromFindings([]), "clean");
    assert.equal(verdictFromFindings([{ severity: "low" }, { severity: "low" }]), "clean");
  });

  it("有 high → high（取最高）", () => {
    assert.equal(verdictFromFindings([{ severity: "medium" }, { severity: "high" }]), "high");
  });

  it("有 medium 无 high → medium", () => {
    assert.equal(verdictFromFindings([{ severity: "low" }, { severity: "medium" }]), "medium");
  });

  it("有 unknown/缺失 severity → 保守 medium（不静默 clean 放行）", () => {
    assert.equal(verdictFromFindings([{ severity: "unknown" }]), "medium");
    assert.equal(verdictFromFindings([{}]), "medium");
  });

  it("任意异常 severity（error/failed/意外字符串）→ 保守 medium", () => {
    assert.equal(verdictFromFindings([{ severity: "error" }]), "medium");
    assert.equal(verdictFromFindings([{ severity: "failed" }]), "medium");
    assert.equal(verdictFromFindings([{ severity: "critical" }]), "medium");
  });
});

describe("isDiffUnchanged", () => {
  it("无标记 → false（可审）", () => {
    assert.equal(isDiffUnchanged(null, { "a.mjs": "h1" }), false);
  });

  it("hash 一致 → true（拒绝重审）", () => {
    const gate = { files: { "a.mjs": "h1" }, verdict: "clean" };
    assert.equal(isDiffUnchanged(gate, { "a.mjs": "h1" }), true);
  });

  it("hash 不同 → false（可审）", () => {
    const gate = { files: { "a.mjs": "h1" }, verdict: "clean" };
    assert.equal(isDiffUnchanged(gate, { "a.mjs": "h2" }), false);
  });

  it("新增文件（集合不同）→ false（可审）", () => {
    const gate = { files: { "a.mjs": "h1" }, verdict: "clean" };
    assert.equal(isDiffUnchanged(gate, { "a.mjs": "h1", "b.mjs": "h2" }), false);
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

describe("CLI --check-stale 集成", () => {
  it("无标记 → stale=false exit 0", () => {
    const dir = makeRepo();
    try {
      const r = runGate(["--check-stale"], dir, join(dir, "gate.json"));
      assert.equal(r.status, 0, r.stderr);
      assert.ok(r.stdout.includes("stale=false"), r.stdout);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("有标记 + 改动未变 → stale=true exit 1", () => {
    const dir = makeRepo();
    try {
      const gp = join(dir, "gate.json");
      const m = runGate(["--mark", "--verdict", "clean"], dir, gp);
      assert.equal(m.status, 0, m.stderr);
      const r = runGate(["--check-stale"], dir, gp);
      assert.equal(r.status, 1, r.stdout);
      assert.ok(r.stdout.includes("stale=true"), r.stdout);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("有标记 + 改动变化 → stale=false exit 0", () => {
    const dir = makeRepo();
    try {
      const gp = join(dir, "gate.json");
      const m = runGate(["--mark", "--verdict", "clean"], dir, gp);
      assert.equal(m.status, 0, m.stderr);
      writeFileSync(join(dir, "a.mjs"), "export const x = 2;\n");
      const r = runGate(["--check-stale"], dir, gp);
      assert.equal(r.status, 0, r.stdout);
      assert.ok(r.stdout.includes("stale=false"), r.stdout);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("downgradeKnownLowRisk", () => {
  const pi = (file = "scripts/evaluate-models.mjs") => ({ file, line: 1, finding: "lessons parameter not sanitized for prompt injection" });

  it("全低风险 medium 降为 low", () => {
    const out = downgradeKnownLowRisk([{ severity: "medium", issues: [pi(), pi()] }]);
    assert.equal(out[0].severity, "low");
    assert.equal(out[0].downgraded, true, "降级应带 downgraded 标记");
  });

  it("不降级不带 downgraded 字段", () => {
    const out = downgradeKnownLowRisk([
      { severity: "medium", issues: [pi(), { file: "a.js", line: 2, finding: "null deref crash" }] },
    ]);
    assert.equal(out[0].severity, "medium");
    assert.ok(!("downgraded" in out[0]), "不降级不应带 downgraded 字段");
  });

  it("high 绝不降且不带 downgraded", () => {
    const out = downgradeKnownLowRisk([{ severity: "high", issues: [pi()] }]);
    assert.equal(out[0].severity, "high");
    assert.ok(!("downgraded" in out[0]), "high 不降级不应带 downgraded");
  });

  it("low 不碰", () => {
    const out = downgradeKnownLowRisk([{ severity: "low", issues: [pi()] }]);
    assert.equal(out[0].severity, "low");
  });

  it("unknown/缺 severity 不碰", () => {
    assert.equal(downgradeKnownLowRisk([{ severity: "unknown", issues: [pi()] }])[0].severity, "unknown");
    assert.equal(downgradeKnownLowRisk([{ issues: [pi()] }])[0].severity, undefined);
  });

  it("无 issues 不降", () => {
    const out = downgradeKnownLowRisk([{ severity: "medium", issues: [] }]);
    assert.equal(out[0].severity, "medium");
  });

  it("file 不匹配不降", () => {
    const out = downgradeKnownLowRisk([{ severity: "medium", issues: [{ file: "scripts/other.mjs", finding: "prompt injection" }] }]);
    assert.equal(out[0].severity, "medium");
  });

  it("workers null/空 不崩", () => {
    assert.deepEqual(downgradeKnownLowRisk(null), []);
    assert.deepEqual(downgradeKnownLowRisk([]), []);
  });
});

describe("isKnownLowRiskFinding", () => {
  it("file + prompt injection 关键词 → true", () => {
    assert.equal(isKnownLowRiskFinding({ file: "scripts/evaluate-models.mjs", finding: "prompt injection" }), true);
    assert.equal(isKnownLowRiskFinding({ file: "scripts/review-critic.mjs", finding: "not sanitized" }), true);
  });

  it("dependency injection 不误匹配", () => {
    assert.equal(isKnownLowRiskFinding({ file: "scripts/evaluate-models.mjs", finding: "dependency injection" }), false);
  });

  it("file 不匹配 → false", () => {
    assert.equal(isKnownLowRiskFinding({ file: "scripts/other.mjs", finding: "prompt injection" }), false);
  });

  it("null/缺字段 → false 不崩", () => {
    assert.equal(isKnownLowRiskFinding(null), false);
    assert.equal(isKnownLowRiskFinding(undefined), false);
    assert.equal(isKnownLowRiskFinding({}), false);
    assert.equal(isKnownLowRiskFinding({ file: "scripts/evaluate-models.mjs" }), false);
  });
});
