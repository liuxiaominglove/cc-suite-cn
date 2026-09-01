import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, dirname, basename, isAbsolute, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { isMainModule } from "./runner-core.mjs";
import { LOW_RISK_RULE_REF } from "./review-gate.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HOME = homedir();

export const CANONICAL_FILES = [
  "scripts/audit-baseline.mjs",
  "scripts/backends.mjs",
  "scripts/benchmark-core.mjs",
  "scripts/benchmark.mjs",
  "scripts/eval-feedback.mjs",
  "scripts/evaluate-models.mjs",
  "scripts/feedback.mjs",
  "scripts/fix-state.mjs",
  "scripts/guard.mjs",
  "scripts/jobs.mjs",
  "scripts/models.mjs",
  "scripts/preflight.mjs",
  "scripts/progress.mjs",
  "scripts/release-check.mjs",
  "scripts/report-sections.mjs",
  "scripts/review-context.mjs",
  "scripts/review-critic.mjs",
  "scripts/review-gate.mjs",
  "scripts/review-prompts.mjs",
  "scripts/review-runner.mjs",
  "scripts/review-source.mjs",
  "scripts/review-test-helpers.mjs",
  "scripts/review-tools.mjs",
  "scripts/runner-core.mjs",
  "scripts/self-audit.mjs",
  "scripts/verdict-log.mjs",
  "scripts/verify/verify-background.mjs",
  "scripts/verify/verify-kimi-sandbox.mjs",
  "scripts/verify/verify-review.mjs",
  ".githooks/pre-commit",
  ".opencode/skills/cc-review/audit-logger.mjs",
  ".opencode/skills/cc-review/SKILL.md",
  "install.sh",
  "scripts/known-risks.json",
];

export const COPY_LOCATIONS = [
  join(HOME, ".config/opencode/scripts/cc-review/review-runner.mjs"),
  join(HOME, ".config/opencode/scripts/cc-review/audit-log.json"),
  join(HOME, ".config/opencode/skills/cc-review/SKILL.md"),
];

export const GLOBAL_REF_FILES = [
  join(HOME, ".config/opencode/opencode.jsonc"),
];

export const STALE_GLOBAL_PATHS = [
  "~/.config/opencode/scripts/cc-review",
  "~/.config/opencode/skills/cc-review",
];

export function findDuplicateCopies(copies = COPY_LOCATIONS, exists = existsSync) {
  return copies.filter((p) => exists(p));
}

export function findMissingCanonical(files = CANONICAL_FILES, exists = existsSync, root = REPO_ROOT) {
  return files.filter((rel) => !exists(join(root, rel)));
}

export function findStaleReferences(files = GLOBAL_REF_FILES, read = readFileSync) {
  const problems = [];
  const home = homedir();
  for (const f of files) {
    let content;
    try {
      content = read(f, "utf-8");
    } catch {
      continue;
    }
    for (const stale of STALE_GLOBAL_PATHS) {
      const variants = [stale, stale.replace(/^~/, home)];
      for (const v of variants) {
        if (content.includes(v)) {
          problems.push(`${f} references ${v}`);
        }
      }
    }
  }
  return problems;
}

export function collectRepoFiles(root, exts = [".mjs", ".json"], { readdir = readdirSync, skip = new Set(["node_modules", ".git"]) } = {}) {
  const files = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (skip.has(e.name)) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        walk(p);
      } else if (exts.some((x) => e.name.endsWith(x))) {
        files.push(p);
      }
    }
  };
  walk(root);
  return files;
}

export function findDeadReferences(skillFiles = [".opencode/skills/cc-review/SKILL.md"], { read = readFileSync, listFiles = null, root = REPO_ROOT } = {}) {
  const files = listFiles ? listFiles(root) : collectRepoFiles(root);
  const basenames = new Set(files.map((p) => basename(p)));
  const problems = [];
  for (const rel of skillFiles) {
    let content;
    try {
      content = read(join(root, rel), "utf-8");
    } catch {
      continue;
    }
    const refs = content.match(/[\w./-]+\.(?:mjs|json)\b/g) ?? [];
    for (const ref of new Set(refs)) {
      if (!basenames.has(basename(ref))) problems.push(`${rel} references ${ref}`);
    }
  }
  return problems;
}

const INLINE_MAIN_MODULE_RE = /(?:import\.meta\.url\s*===\s*pathToFileURL\(\s*process\.argv\[1\]\s*\)(?:\.href)?|pathToFileURL\(\s*process\.argv\[1\]\s*\)(?:\.href)?\s*===\s*import\.meta\.url)/;

export function findInlineMainModule({ root = REPO_ROOT, read = readFileSync, listFiles = null } = {}) {
  const files = (listFiles ?? ((r) => collectRepoFiles(r, [".mjs"])))(root);
  const problems = [];
  for (const f of files) {
    if (!f.endsWith(".mjs") || f.endsWith(".test.mjs")) continue;
    let content;
    try {
      content = read(f, "utf-8");
    } catch {
      continue;
    }
    if (typeof content === "string" && INLINE_MAIN_MODULE_RE.test(content)) {
      problems.push(f.startsWith(root) ? relative(root, f) : f);
    }
  }
  return problems;
}

// 反向补全棘轮：全仓非 test 的 .mjs（含 scripts/verify、.opencode/skills 等，跳过 node_modules/.git）必须都在 CANONICAL_FILES 里，漏登记当场报。
// 正向 findMissingCanonical 防"删了"，本检查防"漏了加"——两条腿各司其职，不互相替代。
export function findUnlistedCanonical({ root = REPO_ROOT, listFiles = null, canonicals = CANONICAL_FILES } = {}) {
  const files = (listFiles ?? ((r) => collectRepoFiles(r, [".mjs"])))(root);
  const listed = new Set(canonicals);
  const problems = [];
  for (const f of files) {
    if (!f.endsWith(".mjs") || f.endsWith(".test.mjs")) continue;
    const rel = f.startsWith(root) ? relative(root, f) : f;
    if (!listed.has(rel)) problems.push(rel);
  }
  return problems;
}

export function runGuard({ copies = COPY_LOCATIONS, canonicals = CANONICAL_FILES, refFiles = GLOBAL_REF_FILES, skillFiles = [".opencode/skills/cc-review/SKILL.md"], exists = existsSync, read = readFileSync, root = REPO_ROOT, listFiles = null } = {}) {
  return {
    dupes: findDuplicateCopies(copies, exists),
    missing: findMissingCanonical(canonicals, exists, root),
    staleRefs: findStaleReferences(refFiles, read),
    deadRefs: findDeadReferences(skillFiles, { read, root }),
    orphanBaselineKeys: findOrphanBaselineKeys({ baselinePath: join(root, ".cc-suite-cn/audit-baseline.json"), read, exists }),
    orphanGlobalRules: findOrphanGlobalRules({ read }),
    knownRiskDrift: findKnownRiskDrift({ read, root }),
    downgradeRuleDrift: findDowngradeRuleDrift({ knownRisksPath: join(root, "scripts/known-risks.json"), read }),
    inlineMainModule: findInlineMainModule({ root, read }),
    unlistedCanonical: findUnlistedCanonical({ root, listFiles, canonicals }),
  };
}

export function findOrphanGlobalRules({ rulesDir = join(homedir(), ".config/opencode/rules"), configPath = join(homedir(), ".config/opencode/opencode.jsonc"), listDir = readdirSync, read = readFileSync } = {}) {
  let names;
  try {
    names = listDir(rulesDir);
  } catch {
    return [];
  }
  const ruleFiles = names.filter((n) => typeof n === "string" && n.endsWith(".md"));
  if (!ruleFiles.length) return [];
  let config;
  try {
    config = read(configPath, "utf-8");
  } catch {
    return [];
  }
  const mounted = new Set(instructionBasenames(config));
  return ruleFiles.filter((name) => !mounted.has(name));
}

function instructionBasenames(configText) {
  const stripped = stripJsoncComments(configText);
  try {
    const j = JSON.parse(stripped);
    const instrs = Array.isArray(j && j.instructions) ? j.instructions : [];
    return instrs.map((p) => (typeof p === "string" ? basename(p) : null)).filter(Boolean);
  } catch {
    return [];
  }
}

function stripJsoncComments(text) {
  let out = "";
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (inLineComment) {
      if (c === "\n") { inLineComment = false; out += c; }
      continue;
    }
    if (inBlockComment) {
      if (c === "*" && next === "/") { inBlockComment = false; i++; }
      continue;
    }
    if (inString) {
      out += c;
      if (c === "\\") { out += next ?? ""; i++; continue; }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; out += c; continue; }
    if (c === "/" && next === "/") { inLineComment = true; i++; continue; }
    if (c === "/" && next === "*") { inBlockComment = true; i++; continue; }
    out += c;
  }
  return out;
}

export function findKnownRiskDrift({ knownRisksPath = join(REPO_ROOT, "scripts/known-risks.json"), verificationPath = join(REPO_ROOT, "docs/verification.md"), read = readFileSync } = {}) {
  let raw;
  try {
    raw = read(knownRisksPath, "utf-8");
  } catch {
    return [`${basename(knownRisksPath)} 缺失或不可读（canonical 文件）`];
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [`${basename(knownRisksPath)} 不是合法 JSON`];
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.risks)) {
    return [`${basename(knownRisksPath)} 应为 { risks: [...] } 结构`];
  }
  const problems = [];
  const seen = new Set();
  let verification = null;
  const readVerification = () => {
    if (verification === null) {
      try {
        verification = read(verificationPath, "utf-8");
      } catch {
        verification = "";
      }
    }
    return verification;
  };
  for (const r of parsed.risks) {
    if (!r || typeof r !== "object") {
      problems.push("risk 条目应为对象");
      continue;
    }
    const id = typeof r.id === "string" ? r.id.trim() : "";
    if (!id) {
      problems.push("risk 条目缺 id");
      continue;
    }
    if (seen.has(id)) {
      problems.push(`重复 id: ${id}`);
    }
    seen.add(id);
    if (r.status === "resolved") {
      const anchor = typeof r.anchor === "string" ? r.anchor.trim() : "";
      if (!anchor) {
        problems.push(`${id}: resolved 缺 anchor`);
      } else if (!anchorInVerification(readVerification(), anchor)) {
        problems.push(`${id}: anchor "${anchor}" 在 verification.md 找不到（死链）`);
      }
    } else if (r.status === "open") {
      for (const field of ["riskLevel", "reassessWhen", "whyDeferred"]) {
        if (typeof r[field] !== "string" || !r[field].trim()) {
          problems.push(`${id}: open 缺 ${field}`);
        }
      }
    } else {
      problems.push(`${id}: status 非法（${r.status}），应为 open|resolved`);
    }
  }
  return problems;
}

function anchorInVerification(text, anchor) {
  const re = new RegExp(`\\b${escapeRegExp(anchor)}\\b`);
  return re.test(text);
}

// 降级规则守门员：校验 review-gate.mjs 的降级规则引用的 KR 项仍存在、仍 open、仍低风险。
// 防 fail-open 漂移——KR-01 一旦被关闭/升级，降级规则还傻傻降级就会漏拦真风险。
export function findDowngradeRuleDrift({ knownRisksPath = join(REPO_ROOT, "scripts/known-risks.json"), read = readFileSync, ruleRef = LOW_RISK_RULE_REF } = {}) {
  let raw;
  try {
    raw = read(knownRisksPath);
  } catch {
    return [`known-risks.json 缺失或不可读，无法校验降级规则（${ruleRef}）`];
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [`known-risks.json 不是合法 JSON，无法校验降级规则（${ruleRef}）`];
  }
  const risks = Array.isArray(parsed?.risks) ? parsed.risks : [];
  const target = risks.find((r) => r?.id === ruleRef);
  if (!target) {
    return [`降级规则引用的 ${ruleRef} 在 known-risks 中不存在（规则漂移）`];
  }
  if (target.status !== "open") {
    return [`降级规则引用的 ${ruleRef} 状态为 ${target.status}（非 open），降级规则可能已失效`];
  }
  if (target.riskLevel !== "低") {
    return [`降级规则引用的 ${ruleRef} 风险等级为 ${target.riskLevel}（非低），不该再降级`];
  }
  return [];
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function findOrphanBaselineKeys({ baselinePath = join(REPO_ROOT, ".cc-suite-cn/audit-baseline.json"), read = readFileSync, exists = existsSync } = {}) {
  let raw;
  try {
    raw = read(baselinePath, "utf-8");
  } catch {
    return [];
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const problems = [];
  for (const key of Object.keys(parsed)) {
    if (basename(key).startsWith("cc-suite")) {
      const abs = isAbsolute(key) ? key : resolve(dirname(baselinePath), key);
      if (!exists(abs)) {
        problems.push(`baseline key ${key} points to a missing directory (renamed?)`);
      }
    }
  }
  return problems;
}

if (isMainModule(import.meta.url)) {
  const { dupes, missing, staleRefs, deadRefs, orphanBaselineKeys, orphanGlobalRules, knownRiskDrift, downgradeRuleDrift, inlineMainModule, unlistedCanonical } = runGuard();
  const problems = [
    ...dupes.map((p) => `duplicate copy: ${p}`),
    ...missing.map((rel) => `missing canonical: ${rel}`),
    ...staleRefs,
    ...deadRefs,
    ...orphanBaselineKeys,
    ...orphanGlobalRules.map((name) => `orphan global rule (未挂载到 opencode.jsonc instructions): ${name}`),
    ...knownRiskDrift,
    ...downgradeRuleDrift.map((p) => `downgrade rule drift: ${p}`),
    ...inlineMainModule.map((p) => `inline isMainModule drift (应改用 runner-core.isMainModule): ${p}`),
    ...unlistedCanonical.map((p) => `unlisted canonical script (漏登记，请加入 CANONICAL_FILES): ${p}`),
  ];
  if (problems.length) {
    console.error(`Drift guard FAILED:\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  console.log("Drift guard passed: no duplicate copies, all canonical files present, no stale references.");
}
