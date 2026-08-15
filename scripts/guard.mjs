import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HOME = homedir();

export const CANONICAL_FILES = [
  "scripts/review-runner.mjs",
  ".opencode/skills/cc-review/SKILL.md",
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
  for (const f of files) {
    let content;
    try {
      content = read(f, "utf-8");
    } catch {
      continue;
    }
    for (const stale of STALE_GLOBAL_PATHS) {
      if (content.includes(stale)) {
        problems.push(`${f} references ${stale}`);
      }
    }
  }
  return problems;
}

const DEAD_REF_DIRS = ["scripts", ".opencode/skills/cc-review"];

export function findDeadReferences(skillFiles = [".opencode/skills/cc-review/SKILL.md"], { read = readFileSync, exists = existsSync, root = REPO_ROOT } = {}) {
  const problems = [];
  for (const rel of skillFiles) {
    const content = read(join(root, rel), "utf-8");
    const refs = content.match(/[\w-]+\.(?:mjs|json)\b/g) ?? [];
    for (const ref of new Set(refs)) {
      const found = DEAD_REF_DIRS.some((d) => exists(join(root, d, ref)));
      if (!found) problems.push(`${rel} references ${ref}`);
    }
  }
  return problems;
}

export function runGuard({ copies = COPY_LOCATIONS, canonicals = CANONICAL_FILES, refFiles = GLOBAL_REF_FILES, skillFiles = [".opencode/skills/cc-review/SKILL.md"], exists = existsSync, read = readFileSync, root = REPO_ROOT } = {}) {
  return {
    dupes: findDuplicateCopies(copies, exists),
    missing: findMissingCanonical(canonicals, exists, root),
    staleRefs: findStaleReferences(refFiles, read),
    deadRefs: findDeadReferences(skillFiles, { read, exists, root }),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { dupes, missing, staleRefs, deadRefs } = runGuard();
  const problems = [
    ...dupes.map((p) => `duplicate copy: ${p}`),
    ...missing.map((rel) => `missing canonical: ${rel}`),
    ...staleRefs,
    ...deadRefs,
  ];
  if (problems.length) {
    console.error(`Drift guard FAILED:\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  console.log("Drift guard passed: no duplicate copies, all canonical files present, no stale references.");
}
