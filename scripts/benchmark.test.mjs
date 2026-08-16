import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runBenchmark, parseBenchmarkArgs, saveBaseline } from "./benchmark.mjs";

describe("runBenchmark", () => {
  it("runs each worker per fixture and scores against the manifest", async () => {
    const manifest = JSON.stringify({
      fixtures: [
        { file: "fixtures/a.js", expected: [{ line: 2 }] },
        { file: "fixtures/b.js", expected: [] },
      ],
    });
    const readFileFn = async () => manifest;
    const workers = [
      { backend: "codebuddy", model: "glm-5.2" },
      { backend: "kimi", model: "kimi-k2.7-code" },
    ];
    const reviewFn = async ({ file }) => {
      if (file.endsWith("a.js")) return { success: true, issues: [{ line: 2, finding: "bug" }] };
      return { success: true, issues: [] };
    };
    const { runs, perModel } = await runBenchmark({ manifestPath: "/tmp/m.json", workers, reviewFn, readFileFn });
    assert.equal(runs.length, 4, "2 fixtures × 2 workers");
    assert.equal(perModel["glm-5.2"].tp, 1);
    assert.equal(perModel["glm-5.2"].fp, 0);
    assert.equal(perModel["glm-5.2"].fn, 0);
    assert.equal(perModel["glm-5.2"].precision, 1);
    assert.equal(perModel["kimi-k2.7-code"].tp, 1);
  });

  it("returns empty perModel when manifest has no fixtures", async () => {
    const readFileFn = async () => JSON.stringify({ fixtures: [] });
    const workers = [{ backend: "codebuddy", model: "glm-5.2" }];
    const reviewFn = async () => ({ success: true, issues: [] });
    const { runs, perModel } = await runBenchmark({ manifestPath: "/tmp/m.json", workers, reviewFn, readFileFn });
    assert.equal(runs.length, 0);
    assert.deepEqual(perModel, {});
  });

  it("单个 worker 抛错不拖垮整个基准（记录 success=false）", async () => {
    const manifest = JSON.stringify({ fixtures: [{ file: "fixtures/a.js", expected: [{ line: 2 }] }] });
    const readFileFn = async () => manifest;
    const workers = [
      { backend: "codebuddy", model: "glm-5.2" },
      { backend: "kimi", model: "kimi-k2.7-code" },
    ];
    const reviewFn = async ({ model }) => {
      if (model === "kimi-k2.7-code") throw new Error("kimi down");
      return { success: true, issues: [{ line: 2 }] };
    };
    const { runs, perModel } = await runBenchmark({ manifestPath: "/tmp/m.json", workers, reviewFn, readFileFn });
    assert.equal(runs.length, 2);
    const kimi = runs.find((r) => r.model === "kimi-k2.7-code");
    assert.equal(kimi.success, false);
    assert.ok(kimi.error.includes("kimi down"));
    assert.equal(perModel["glm-5.2"].tp, 1);
  });
});

describe("parseBenchmarkArgs", () => {
  it("默认用 find 施工队（glm+kimi）+ 并发 4", () => {
    const { workers, concurrency } = parseBenchmarkArgs([]);
    assert.equal(workers.length, 2);
    assert.equal(concurrency, 4);
  });

  it("--workers all 用全部 4 模型", () => {
    const { workers } = parseBenchmarkArgs(["--workers", "all"]);
    assert.equal(workers.length, 4);
  });

  it("--workers find 显式用 2 模型", () => {
    const { workers } = parseBenchmarkArgs(["--workers", "find"]);
    assert.equal(workers.length, 2);
  });

  it("--concurrency 解析正整数", () => {
    assert.equal(parseBenchmarkArgs(["--concurrency", "2"]).concurrency, 2);
  });

  it("--concurrency 非数字/非正回退默认 4", () => {
    assert.equal(parseBenchmarkArgs(["--concurrency", "abc"]).concurrency, 4);
    assert.equal(parseBenchmarkArgs(["--concurrency", "-1"]).concurrency, 4);
  });
});

describe("saveBaseline", () => {
  it("写入 perModel + manifestHash + savedAt", async () => {
    let written = null;
    let writtenPath = null;
    const writeFileFn = async (p, content) => { writtenPath = p; written = JSON.parse(content); };
    const mkdirFn = async () => {};
    const result = {
      manifest: { fixtures: [] },
      perModel: { "glm-5.2": { tp: 1, fp: 0, fn: 0, precision: 1, recall: 1, f1: 1, runs: 1 } },
      runs: [{ model: "glm-5.2", file: "a.js", success: true, score: { tp: 1, fp: 0, fn: 0, precision: 1, recall: 1, f1: 1 } }],
    };
    await saveBaseline(result, { baselinePath: "/tmp/base.json", writeFileFn, mkdirFn });
    assert.equal(writtenPath, "/tmp/base.json");
    assert.ok(written.savedAt);
    assert.ok(written.manifestHash);
    assert.equal(written.perModel["glm-5.2"].tp, 1);
    assert.equal(written.runs[0].tp, 1);
  });
});

