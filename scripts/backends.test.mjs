import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildCommand, READ_ONLY_DECLARATION } from "./backends.mjs";

describe("buildCommand", () => {
  it("codebuddy passes prompt via stdin with --model", () => {
    const cmd = buildCommand("codebuddy", { model: "glm-5.2", prompt: "review this" });
    assert.equal(cmd.command, "codebuddy");
    assert.deepEqual(cmd.args, ["--model", "glm-5.2", "--print", "--output-format", "text"]);
    assert.equal(cmd.stdin, "review this");
  });

  it("kimi passes prompt via -p argument, no stdin", () => {
    const cmd = buildCommand("kimi", { model: "kimi-k2.7-code", prompt: "review this" });
    assert.equal(cmd.command, "kimi");
    assert.deepEqual(cmd.args, ["-p", "review this"]);
    assert.equal(cmd.stdin, null);
  });

  it("qwen passes prompt via -p argument, no stdin", () => {
    const cmd = buildCommand("qwen", { model: "qwen3-coder-plus", prompt: "review this" });
    assert.equal(cmd.command, "qwen");
    assert.deepEqual(cmd.args, ["-p", "review this"]);
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
