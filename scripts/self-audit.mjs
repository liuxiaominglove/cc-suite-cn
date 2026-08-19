import { pathToFileURL } from "node:url";
import { runAudit, summarizeWorkers } from "./jobs.mjs";

const CORE_SCRIPTS = [
  "review-runner",
  "review-tools",
  "review-critic",
  "review-context",
  "review-source",
  "review-prompts",
  "evaluate-models",
  "jobs",
  "backends",
  "runner-core",
  "guard",
  "models",
  "preflight",
  "audit-baseline",
  "verdict-log",
];

export function coreScriptPaths() {
  return CORE_SCRIPTS.map((name) => `scripts/${name}.mjs`);
}

export async function selfAudit({ runAuditFn = runAudit, scripts = CORE_SCRIPTS } = {}) {
  const results = [];
  for (const name of scripts) {
    const file = `scripts/${name}.mjs`;
    const { workers } = await runAuditFn({ file });
    const count = workers.reduce((s, w) => s + (w.success ? w.issues?.length ?? 0 : 0), 0);
    results.push({ file, workers, count });
  }
  return results;
}

async function main() {
  console.log(`自审 ${CORE_SCRIPTS.length} 个核心脚本（glm+kimi 找 bug）...\n`);
  const results = await selfAudit();
  let total = 0;
  for (const r of results) {
    total += r.count;
    console.log(`${r.file}  ${summarizeWorkers(r.workers)}`);
  }
  console.log(`\n合计 ${total} 条 finding。下一步：/evaluate --arbitrate 裁决 → /fix 修复（TDD）。`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
