import { review } from "../review-runner.mjs";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const TARGET = process.argv[2] ?? "demos/quick-demo.js";

const BACKENDS = [
  { backend: "codebuddy", model: "glm-5.2" },
  { backend: "codebuddy", model: "hy3" },
  { backend: "kimi", model: "kimi-k2.7-code" },
  { backend: "qwen", model: "qwen3-coder-plus" },
];

function hashFile(p) {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

const targetAbs = resolve(TARGET);
const hashBefore = hashFile(targetAbs);

let pass = 0;
let fail = 0;

for (const { backend, model } of BACKENDS) {
  try {
    const result = await review({ model, backend, file: TARGET, timeout: 120000 });
    if (result.success && result.summary) {
      console.log(`PASS ${backend}/${model}: severity=${result.severity}, issues=${result.issues.length}`);
      pass += 1;
    } else {
      console.log(`FAIL ${backend}/${model}: not successful (${result.summary})`);
      fail += 1;
    }
  } catch (err) {
    console.log(`FAIL ${backend}/${model}: ${err.message}`);
    fail += 1;
  }
}

const hashAfter = hashFile(targetAbs);
if (hashBefore === hashAfter) {
  console.log("PASS read-only: target file hash unchanged");
} else {
  console.log("FAIL read-only: target file was modified!");
  fail += 1;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
