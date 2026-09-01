import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  STEPS,
  stateFile,
  createEmptyState,
  markStepDone,
  isStepDone,
  loadState,
  saveState,
} from "./fix-state.mjs";

describe("createEmptyState / isStepDone", () => {
  it("空 state 五步全未完成", () => {
    const s = createEmptyState("/p");
    for (const step of STEPS) {
      assert.equal(isStepDone(s, step), false);
    }
  });

  it("STEPS 恰为五步", () => {
    assert.deepEqual(STEPS, ["step1", "step2", "step3", "step4", "step5"]);
  });
});

describe("markStepDone / isStepDone", () => {
  it("标记一步后该步 done，其余仍 false", () => {
    let s = createEmptyState("/p");
    s = markStepDone(s, "step2");
    assert.equal(isStepDone(s, "step2"), true);
    assert.equal(isStepDone(s, "step1"), false);
    assert.equal(isStepDone(s, "step5"), false);
  });

  it("非法 step 抛错", () => {
    const s = createEmptyState("/p");
    assert.throws(() => markStepDone(s, "stepX"));
  });

  it("markStepDone 不可变，不修改原 state", () => {
    const s = createEmptyState("/p");
    markStepDone(s, "step1");
    assert.equal(isStepDone(s, "step1"), false);
  });
});

describe("loadState / saveState", () => {
  async function tempDir() {
    return mkdtemp(join(tmpdir(), "fix-state-"));
  }

  it("往返：save 后 load 一致", async () => {
    const dir = await tempDir();
    try {
      let s = createEmptyState("/proj");
      s = markStepDone(s, "step3");
      await saveState(dir, s);
      const loaded = await loadState(dir, "/proj");
      assert.equal(isStepDone(loaded, "step3"), true);
      assert.equal(isStepDone(loaded, "step1"), false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("无 state 文件 → 回退空 state", async () => {
    const dir = await tempDir();
    try {
      const s = await loadState(dir, "/proj");
      for (const step of STEPS) assert.equal(isStepDone(s, step), false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("损坏 state 文件 → 回退空 state，不抛", async () => {
    const dir = await tempDir();
    try {
      await writeFile(join(dir, stateFile("/proj")), "not valid json", "utf-8");
      const s = await loadState(dir, "/proj");
      for (const step of STEPS) assert.equal(isStepDone(s, step), false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("不同 projectDir 状态隔离", async () => {
    const dir = await tempDir();
    try {
      let s = createEmptyState("/a");
      s = markStepDone(s, "step1");
      await saveState(dir, s);
      const sb = await loadState(dir, "/b");
      assert.equal(isStepDone(sb, "step1"), false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
