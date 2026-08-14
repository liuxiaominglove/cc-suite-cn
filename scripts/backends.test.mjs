import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildCommand, READ_ONLY_DECLARATION, resolveCli } from "./backends.mjs";

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

  it("codebuddy 用绝对路径 + --model + 只读 denylist，prompt 走 stdin", () => {
    const cmd = buildCommand("codebuddy", { model: "glm-5.2", prompt: "review this" }, { which: WHICH.codebuddy });
    assert.equal(cmd.command, "/usr/local/bin/codebuddy");
    assert.deepEqual(cmd.args, ["--model", "glm-5.2", "--print", "--output-format", "text", "--disallowedTools", "Edit Write Bash"]);
    assert.equal(cmd.stdin, "review this");
  });

  it("kimi 用绝对路径 + --plan 只读护栏，prompt 走 -p，无 stdin", () => {
    const cmd = buildCommand("kimi", { model: "kimi-k2.7-code", prompt: "review this" }, { which: WHICH.kimi });
    assert.equal(cmd.command, "/usr/local/bin/kimi");
    assert.deepEqual(cmd.args, ["--plan", "-p", "review this"]);
    assert.equal(cmd.stdin, null);
  });

  it("qwen 用绝对路径 + --sandbox，无 -y", () => {
    const cmd = buildCommand("qwen", { model: "qwen3-coder-plus", prompt: "review this" }, { which: WHICH.qwen });
    assert.equal(cmd.command, "/usr/local/bin/qwen");
    assert.deepEqual(cmd.args, ["--sandbox", "-p", "review this"]);
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
