import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WORKERS, FIND_BUG_WORKERS } from "./models.mjs";
import { review } from "./review-runner.mjs";
import { scoreFindings, aggregateByModel, parseManifest } from "./benchmark-core.mjs";
import { hashContent } from "./verdict-log.mjs";

const DEFAULT_MANIFEST = fileURLToPath(new URL("./benchmark/manifest.json", import.meta.url));
const BASELINE_PATH = fileURLToPath(new URL("../.cc-suite-cn/benchmark-baseline.json", import.meta.url));

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const workers = [];
  for (let i = 0; i < workerCount; i++) {
    workers.push(
      (async () => {
        while (true) {
          const idx = next;
          next += 1;
          if (idx >= items.length) break;
          results[idx] = await fn(items[idx], idx);
        }
      })()
    );
  }
  await Promise.all(workers);
  return results;
}

export function parseBenchmarkArgs(args) {
  const a = args ?? [];
  const manifestIdx = a.indexOf("--manifest");
  const manifestPath =
    manifestIdx !== -1 && a[manifestIdx + 1] && !a[manifestIdx + 1].startsWith("--")
      ? a[manifestIdx + 1]
      : DEFAULT_MANIFEST;
  const concurrencyIdx = a.indexOf("--concurrency");
  let concurrency = 4;
  if (concurrencyIdx !== -1 && a[concurrencyIdx + 1]) {
    const n = parseInt(a[concurrencyIdx + 1], 10);
    if (Number.isFinite(n) && n > 0) concurrency = n;
  }
  const workersIdx = a.indexOf("--workers");
  const workersFlag = workersIdx !== -1 ? a[workersIdx + 1] : "find";
  const workers = workersFlag === "all" ? WORKERS : FIND_BUG_WORKERS;
  return { manifestPath, concurrency, workers };
}

export async function runBenchmark({ manifestPath = DEFAULT_MANIFEST, workers = FIND_BUG_WORKERS, reviewFn = review, readFileFn = readFile, lineTolerance = 3, concurrency = 4 } = {}) {
  const raw = await readFileFn(manifestPath, "utf-8");
  const manifest = parseManifest(raw);
  const baseDir = dirname(manifestPath);

  const jobs = [];
  for (const fixture of manifest.fixtures) {
    for (const { backend, model } of workers) {
      jobs.push({ fixture, backend, model, filePath: resolve(baseDir, fixture.file) });
    }
  }

  const runs = await mapLimit(jobs, concurrency, async ({ fixture, backend, model, filePath }) => {
    let r;
    try {
      r = await reviewFn({ model, backend, file: filePath, allowExternal: true });
    } catch (err) {
      return {
        model,
        backend,
        file: fixture.file,
        found: [],
        expected: fixture.expected,
        score: scoreFindings([], fixture.expected, { lineTolerance }),
        success: false,
        error: err?.message ?? String(err),
      };
    }
    const found = (r.issues ?? []).map((i) => ({ line: i.line ?? null, finding: i.finding ?? "" }));
    const score = scoreFindings(found, fixture.expected, { lineTolerance });
    return { model, backend, file: fixture.file, found, expected: fixture.expected, score, success: r.success };
  });

  const perModel = aggregateByModel(
    runs.map(({ model, found, expected }) => ({ model, found, expected })),
    { lineTolerance }
  );
  return { manifest, runs, perModel };
}

export async function saveBaseline(result, { baselinePath = BASELINE_PATH, writeFileFn = writeFile, mkdirFn = mkdir } = {}) {
  const payload = {
    savedAt: new Date().toISOString(),
    manifestHash: hashContent(JSON.stringify(result.manifest)),
    perModel: result.perModel,
    runs: result.runs.map((r) => ({
      model: r.model,
      file: r.file,
      success: r.success,
      tp: r.score.tp,
      fp: r.score.fp,
      fn: r.score.fn,
      precision: r.score.precision,
      recall: r.score.recall,
      f1: r.score.f1,
    })),
  };
  await mkdirFn(dirname(baselinePath), { recursive: true });
  await writeFileFn(baselinePath, JSON.stringify(payload, null, 2) + "\n", "utf-8");
  return payload;
}

function fmt(v, w = 8) {
  return (Number.isFinite(v) ? v.toFixed(2) : "0.00").padStart(w);
}

async function main() {
  const { manifestPath, concurrency, workers } = parseBenchmarkArgs(process.argv.slice(2));
  console.log(`基准：${workers.length} 模型 × ${10} fixture，并发 ${concurrency}...\n`);

  const result = await runBenchmark({ manifestPath, workers, concurrency });

  console.log("=".repeat(72));
  console.log("模型                  precision  recall    f1       TP/FP/FN");
  for (const [model, m] of Object.entries(result.perModel)) {
    console.log(`${model.padEnd(20)}  ${fmt(m.precision)}  ${fmt(m.recall, 6)}  ${fmt(m.f1, 6)}  ${m.tp}/${m.fp}/${m.fn}`);
  }
  console.log("=".repeat(72));
  console.log("\n明细：");
  for (const r of result.runs) {
    const status = r.success ? "OK" : `FAIL(${r.error ?? "unknown"})`;
    console.log(
      `  ${r.model.padEnd(20)} @ ${r.file.padEnd(26)} [${status}]  p/r=${r.score.precision.toFixed(2)}/${r.score.recall.toFixed(2)}  found=${r.found.length} expected=${r.expected.length}`
    );
  }
  console.log("\n（precision/recall 对标注真值算，非共识口径；用于 A/B prompt 与回归）");

  await saveBaseline(result);
  console.log(`\n基线已落库：.cc-suite-cn/benchmark-baseline.json`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
