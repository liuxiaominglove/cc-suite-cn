import { execSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const BASELINE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../.cc-suite-pe/audit-baseline.json");

export function gitHead(cwd = process.cwd(), exec = execSync) {
  try {
    return exec("git rev-parse HEAD", { cwd, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

export function gitChangedFiles(baseCommit, cwd = process.cwd(), exec = execSync) {
  if (typeof baseCommit !== "string" || !/^[a-f0-9]{7,40}$/.test(baseCommit)) {
    return [];
  }
  let diff;
  try {
    diff = exec(`git diff --name-only ${baseCommit}..HEAD`, { cwd, encoding: "utf8" });
  } catch {
    return [];
  }
  const files = [];
  for (const line of diff.split("\n")) {
    const f = line.trim();
    if (f) files.push(f);
  }
  try {
    const others = exec("git ls-files --others --exclude-standard", { cwd, encoding: "utf8" });
    for (const line of others.split("\n")) {
      const f = line.trim();
      if (f) files.push(f);
    }
  } catch {
    // untracked 检测失败：忽略
  }
  return files;
}

export async function loadBaseline(path = BASELINE_PATH) {
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

let _writeQueue = Promise.resolve();

export async function saveBaseline(project, record, path = BASELINE_PATH) {
  const run = async () => {
    const baseline = await loadBaseline(path);
    baseline[project] = record;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(baseline, null, 2) + "\n", "utf-8");
    return baseline;
  };
  const result = _writeQueue.then(run, run);
  _writeQueue = result.then(() => {}, () => {});
  return result;
}

export async function detectAuditScope(project, { cwd = process.cwd(), exec = execSync, path = BASELINE_PATH } = {}) {
  const baseline = await loadBaseline(path);
  const prev = baseline[project];
  const head = gitHead(cwd, exec);
  if (!head) {
    return { isGit: false, changed: false, files: [], head: null };
  }
  if (!prev || !prev.commit) {
    return { isGit: true, changed: true, firstAudit: true, files: null, head };
  }
  if (prev.commit === head) {
    return { isGit: true, changed: false, files: [], head };
  }
  const files = gitChangedFiles(prev.commit, cwd, exec);
  return { isGit: true, changed: true, firstAudit: false, files, baseCommit: prev.commit, head };
}

export function parseSaveArgs(args) {
  const project = args[1];
  const commitIdx = args.indexOf("--commit");
  const hasCommitFlag = commitIdx !== -1;
  const raw = hasCommitFlag ? args[commitIdx + 1] : null;
  const commit = raw && !raw.startsWith("--") ? raw : null;
  return { project, commit, hasCommitFlag };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const action = args[0];
  const project = args[1];
  if (action === "--detect" && project) {
    const scope = await detectAuditScope(project, { cwd: project });
    console.log(JSON.stringify(scope, null, 2));
  } else if (action === "--save" && project) {
    const { commit, hasCommitFlag } = parseSaveArgs(args);
    if (hasCommitFlag && !commit) {
      console.error("--commit 需要一个 commit hash 值");
      process.exit(1);
    }
    const head = commit || gitHead(project);
    if (head) {
      await saveBaseline(project, { commit: head, auditedAt: new Date().toISOString() });
      console.log(`已保存审计基线：${project} → ${head}`);
    } else {
      console.error(`无法保存基线：${project} 不是 git 仓库或无 commit`);
      process.exit(1);
    }
  } else {
    console.error("Usage: node audit-baseline.mjs --detect <project-dir> | --save <project-dir> [--commit <hash>]");
    process.exit(1);
  }
}
