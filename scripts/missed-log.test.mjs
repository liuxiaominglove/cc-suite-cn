import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { missedKey, dedupeMissed, persistMissed, loadMissed } from "./missed-log.mjs";

describe("missedKey / dedupeMissed", () => {
  it("keys by file+line+finding", () => {
    assert.equal(missedKey({ file: "a", line: 1, finding: "f" }), missedKey({ file: "a", line: 1, finding: "f" }));
    assert.notEqual(missedKey({ file: "a", line: 1, finding: "f" }), missedKey({ file: "a", line: 2, finding: "f" }));
  });

  it("dedupes duplicates keeping latest", () => {
    const out = dedupeMissed([
      { file: "a", line: 1, finding: "f", ts: 1 },
      { file: "a", line: 1, finding: "f", ts: 2 },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].ts, 2);
  });
});

describe("persistMissed / loadMissed", () => {
  it("persists and reloads", async () => {
    const dir = await mkdtemp(join(tmpdir(), "missed-"));
    const p = join(dir, "missed.json");
    await persistMissed([{ file: "a.js", line: 1, finding: "f", source: "qwen-critic", timestamp: "2026-01-01T00:00:00Z" }], p);
    const log = await loadMissed(p);
    assert.equal(log.length, 1);
    assert.equal(log[0].source, "qwen-critic");
  });

  it("dedupes on append", async () => {
    const dir = await mkdtemp(join(tmpdir(), "missed-"));
    const p = join(dir, "missed.json");
    await persistMissed([{ file: "a", line: 1, finding: "f" }], p);
    await persistMissed([{ file: "a", line: 1, finding: "f" }], p);
    assert.equal((await loadMissed(p)).length, 1);
  });

  it("file missing returns empty", async () => {
    assert.deepEqual(await loadMissed("/nonexistent/missed.json"), []);
  });

  it("写入后不残留 tmp 文件", async () => {
    const dir = await mkdtemp(join(tmpdir(), "missed-"));
    const p = join(dir, "missed.json");
    await persistMissed([{ file: "a", line: 1, finding: "f" }], p);
    const files = await readdir(dir);
    const tmps = files.filter((f) => f.includes(".missed-") && f.endsWith(".tmp"));
    assert.equal(tmps.length, 0);
  });
});
