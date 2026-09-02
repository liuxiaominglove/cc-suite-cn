import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildCommand, READ_ONLY_DECLARATION, resolveCli } from "./backends.mjs";
import { VERIFIER_MODEL } from "./models.mjs";

describe("resolveCli", () => {
  it("解析到绝对路径（防 PATH 劫持）", () => {
    assert.equal(resolveCli("codebuddy", { which: () => "/usr/local/bin/codebuddy" }), "/usr/local/bin/codebuddy");
  });

  it("找不到时返回裸名（让 spawn 报 ENOENT）", () => {
    assert.equal(resolveCli("codebuddy", { which: () => null }), "codebuddy");
  });
});

describe("buildCommand", () => {
  const WHICH = {
    codebuddy: () => "/usr/local/bin/codebuddy",
    kimi: () => "/usr/local/bin/kimi",
    qwen: () => "/usr/local/bin/qwen",
  };

  it("codebuddy 用绝对路径 + --model + --effort + 只读 denylist，prompt 走 stdin", () => {
    const cmd = buildCommand("codebuddy", { model: "glm-5.3", prompt: "review this" }, { which: WHICH.codebuddy });
    assert.equal(cmd.command, "/usr/local/bin/codebuddy");
    assert.deepEqual(cmd.args, ["--model", "glm-5.3", "--effort", "low", "--print", "--output-format", "text", "--disallowedTools", "Edit Write Bash"]);
    assert.equal(cmd.stdin, "review this");
  });

  it("hy4-preview（验证审计员）不降档，保持默认推理（裁决是修 bug 门槛）", () => {
    const cmd = buildCommand("codebuddy", { model: VERIFIER_MODEL, prompt: "adjudicate" }, { which: WHICH.codebuddy });
    assert.deepEqual(cmd.args, ["--model", VERIFIER_MODEL, "--print", "--output-format", "text", "--disallowedTools", "Edit Write Bash"]);
    assert.equal(cmd.stdin, "adjudicate");
  });

  it("未知模型保守不降档（fail-closed，防未来新增模型被静默降档）", () => {
    const cmd = buildCommand("codebuddy", { model: "some-future-model", prompt: "x" }, { which: WHICH.codebuddy });
    assert.deepEqual(cmd.args, ["--model", "some-future-model", "--print", "--output-format", "text", "--disallowedTools", "Edit Write Bash"]);
  });

  it("kimi 用绝对路径 + --agent-file 只读护栏 + -m 显式指定模型，prompt 走 -p，无 stdin", () => {
    const cmd = buildCommand("kimi", { model: "kimi-k3", prompt: "review this" }, { which: WHICH.kimi });
    assert.equal(cmd.command, "/usr/local/bin/kimi");
    assert.equal(cmd.args[0], "--agent-file");
    assert.match(cmd.args[1], /kimi-readonly-agent\.md$/, "应指向只读 agent 定义文件");
    assert.deepEqual(cmd.args.slice(2), ["-m", "moonshotai-cn/kimi-k3", "-p", "review this"]);
    assert.equal(cmd.stdin, null);
  });

  it("qwen 用绝对路径 + --safe-mode + --sandbox + -m 显式指定模型，无 -y", () => {
    const cmd = buildCommand("qwen", { model: "qwen3.8-max", prompt: "review this" }, { which: WHICH.qwen });
    assert.equal(cmd.command, "/usr/local/bin/qwen");
    assert.deepEqual(cmd.args, ["--safe-mode", "--sandbox", "-m", "qwen3.8-max", "-p", "review this"]);
    assert.ok(!cmd.args.includes("-y"), "qwen must stay read-only (no -y)");
    assert.equal(cmd.stdin, null);
  });

  it("unknown backend throws", () => {
    assert.throws(() => buildCommand("unknown", { model: "x", prompt: "y" }), /unknown backend/i);
  });
});

describe("READ_ONLY_DECLARATION", () => {
  it("contains the read-only constraint", () => {
    assert.ok(READ_ONLY_DECLARATION.includes("禁止"));
    assert.ok(READ_ONLY_DECLARATION.includes("修改"));
    assert.ok(READ_ONLY_DECLARATION.includes("命令"));
  });
});
