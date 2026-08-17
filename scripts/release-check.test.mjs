import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkRelease } from "./release-check.mjs";

describe("checkRelease", () => {
  it("tag 与 version 一致（v 前缀或无）通过", () => {
    assert.deepEqual(checkRelease({ version: "1.0.0", tag: "v1.0.0" }), []);
    assert.deepEqual(checkRelease({ version: "1.0.0", tag: "1.0.0" }), []);
  });

  it("无 tag 报 release 未完成", () => {
    const p = checkRelease({ version: "1.0.0", tag: null });
    assert.equal(p.length, 1);
    assert.match(p[0], /无 tag/);
  });

  it("tag 与 version 不一致报错", () => {
    const p = checkRelease({ version: "1.0.0", tag: "v2.0.0" });
    assert.equal(p.length, 1);
    assert.match(p[0], /不一致/);
  });
});
