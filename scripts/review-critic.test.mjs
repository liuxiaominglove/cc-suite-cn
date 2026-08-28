import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildMissedFindings } from "./review-critic.mjs";

describe("buildMissedFindings", () => {
  it("归一化相对路径 file 到 projectDir", () => {
    const out = buildMissedFindings(
      [{ file: "server/server.py", line: 1, finding: "f", reason: "r" }],
      "/p/server/test_server.py",
      { projectDir: "/p" }
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].file, "/p/server/server.py");
  });

  it("归一化裸文件名到被审文件目录", () => {
    const out = buildMissedFindings(
      [{ file: "server.py", line: 2, finding: "f", reason: "r" }],
      "/p/server/test_server.py",
      { projectDir: "/p" }
    );
    assert.equal(out[0].file, "/p/server/server.py");
  });

  it("绝对路径原样保留", () => {
    const out = buildMissedFindings(
      [{ file: "/abs/a.py", line: 3, finding: "f", reason: "r" }],
      "/p/server/test.py",
      { projectDir: "/p" }
    );
    assert.equal(out[0].file, "/abs/a.py");
  });

  it("空 file 回退被审文件", () => {
    const out = buildMissedFindings(
      [{ finding: "f", reason: "r" }],
      "/p/server/a.py",
      { projectDir: "/p" }
    );
    assert.equal(out[0].file, "/p/server/a.py");
  });

  it("透传 projectDir", () => {
    const out = buildMissedFindings(
      [{ file: "a.py", finding: "f", reason: "r" }],
      "/p/server/a.py",
      { projectDir: "/p" }
    );
    assert.equal(out[0].projectDir, "/p");
  });

  it("打标 auditCommit，不传时为 null", () => {
    const withCommit = buildMissedFindings(
      [{ file: "a.py", finding: "f", reason: "r" }],
      "/p/a.py",
      { projectDir: "/p", auditCommit: "abc123" }
    );
    assert.equal(withCommit[0].auditCommit, "abc123");

    const without = buildMissedFindings(
      [{ file: "a.py", finding: "f", reason: "r" }],
      "/p/a.py",
      { projectDir: "/p" }
    );
    assert.equal(without[0].auditCommit, null);
  });

  it("source 为 qwen-critic，models 含 critic 模型", () => {
    const out = buildMissedFindings(
      [{ file: "a.py", finding: "f", reason: "r" }],
      "/p/a.py",
      { projectDir: "/p" }
    );
    assert.equal(out[0].source, "qwen-critic");
    assert.ok(Array.isArray(out[0].models) && out[0].models.length > 0);
  });
});
