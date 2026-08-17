import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, dirname, basename, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { isMainModule } from "./runner-core.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HOME = homedir();

export const CANONICAL_FILES = [
  "scripts/review-runner.mjs",
  ".opencode/skills/cc-review/SKILL.md",
  "install.sh",
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

export function runGuard({ copies = COPY_LOCATIONS, canonicals = CANONICAL_FILES, refFiles = GLOBAL_REF_FILES, skillFiles = [".opencode/skills/cc-review/SKILL.md"], exists = existsSync, read = readFileSync, root = REPO_ROOT } = {}) {
  return {
    dupes: findDuplicateCopies(copies, exists),
    missing: findMissingCanonical(canonicals, exists, root),
    staleRefs: findStaleReferences(refFiles, read),
    deadRefs: findDeadReferences(skillFiles, { read, root }),
    orphanBaselineKeys: findOrphanBaselineKeys({ baselinePath: join(root, ".cc-suite-cn/audit-baseline.json"), read, exists }),
    orphanGlobalRules: findOrphanGlobalRules({ read }),
    knownRiskDrift: findKnownRiskDrift({ read, root }),
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
  let config;
  try {
    config = read(configPath, "utf-8");
  } catch {
    return [];
  }
  return ruleFiles.filter((name) => !config.includes(name));
}

export function findKnownRiskDrift({ knownRisksPath = join(REPO_ROOT, "scripts/known-risks.json"), verificationPath = join(REPO_ROOT, "docs/verification.md"), read = readFileSync } = {}) {
  let raw;
  try {
    raw = read(knownRisksPath, "utf-8");
  } catch {
    return [];
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
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
      } else if (!readVerification().includes(anchor)) {
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
  const { dupes, missing, staleRefs, deadRefs, orphanBaselineKeys, orphanGlobalRules, knownRiskDrift } = runGuard();
  const problems = [
    ...dupes.map((p) => `duplicate copy: ${p}`),
    ...missing.map((rel) => `missing canonical: ${rel}`),
    ...staleRefs,
    ...deadRefs,
    ...orphanBaselineKeys,
    ...orphanGlobalRules.map((name) => `orphan global rule (未挂载到 opencode.jsonc instructions): ${name}`),
    ...knownRiskDrift,
  ];
  if (problems.length) {
    console.error(`Drift guard FAILED:\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  console.log("Drift guard passed: no duplicate copies, all canonical files present, no stale references.");
}
