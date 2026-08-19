import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { DEFAULT_EXTS } from "./review-source.mjs";
import { SOURCE_IMPORT_EXTS } from "./review-tools.mjs";
import { hashContent } from "./verdict-log.mjs";
import { isMainModule } from "./runner-core.mjs";

export const REVIEW_GATE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../.cc-suite-cn/review-gate.json");

export const CODE_EXTS = [...new Set([...DEFAULT_EXTS, ...SOURCE_IMPORT_EXTS])];

const HOOK_PATHS = [".githooks/pre-commit"];

export function isCodeFile(path) {
  if (HOOK_PATHS.some((h) => (path ?? "").endsWith(h))) return true;
  return CODE_EXTS.some((e) => (path ?? "").endsWith(e));
}

// 纯逻辑：给定复审标记（可能 null）+ staged 代码文件的当前 hash，决定放行/拦。
// 返回 { action: "pass" | "confirm" | "block", reason, files }。
export function decide(gate, stagedHashes) {
  const paths = Object.keys(stagedHashes ?? {});
  if (paths.length === 0) {
    return { action: "pass", reason: "no-code-changes", files: [] };
  }
  if (!gate) {
    return { action: "confirm", reason: "unreviewed", files: paths };
  }
  // high 优先级最高：无论 hash 是否匹配，high 都硬拦（防"复审后又改"把 high 降级成 confirm 绕过）
  if (gate.verdict === "high") {
    return { action: "block", reason: "high-unfixed", files: paths };
  }
  const files = gate.files ?? {};
  const unmatched = paths.filter((p) => files[p] !== stagedHashes[p]);
  if (unmatched.length > 0) {
    return { action: "confirm", reason: "changed-since-review", files: unmatched };
  }
  if (gate.verdict === "medium") {
    return { action: "confirm", reason: "medium-unfixed", files: paths };
  }
  if (gate.verdict === "clean") {
    return { action: "pass", reason: "clean", files: [] };
  }
  // verdict 未知（损坏/旧格式）→ 保守 confirm，不 fall-through 放行
  return { action: "confirm", reason: "unknown-verdict", files: paths };
}

export async function loadGate({ filePath = REVIEW_GATE_PATH, readFile = null } = {}) {
  const read = readFile ?? (async (p) => (await import("node:fs/promises")).readFile(p, "utf-8"));
  try {
    const raw = await read(filePath);
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    return null;
  } catch {
    return null;
  }
}

export async function markReviewed({ files, verdict, filePath = REVIEW_GATE_PATH, readFile = null, writeFile = null, mkdir = null, rename = null } = {}) {
  if (verdict !== "clean" && verdict !== "medium" && verdict !== "high") {
    throw new Error(`markReviewed verdict 必填（clean|medium|high），got: ${verdict}`);
  }
  const read = readFile ?? (async (p) => (await import("node:fs/promises")).readFile(p, "utf-8"));
  const hashes = {};
  for (const f of files ?? []) {
    if (!f || typeof f !== "string") continue;
    try {
      hashes[f] = hashContent(await read(f));
    } catch {
      // 读不到 = 文件已删除；记录特殊值，与 stageHashes 的删除语义对齐
      hashes[f] = "deleted";
    }
  }
  const gate = { files: hashes, verdict };
  const mk = mkdir ?? (async (p) => (await import("node:fs/promises")).mkdir(p, { recursive: true }));
  const wr = writeFile ?? (async (p, d) => (await import("node:fs/promises")).writeFile(p, d, "utf-8"));
  const rn = rename ?? (async (a, b) => (await import("node:fs/promises")).rename(a, b));
  await mk(dirname(filePath));
  const tmp = `${filePath}.tmp`;
  await wr(tmp, JSON.stringify(gate, null, 2) + "\n");
  await rn(tmp, filePath);
  return gate;
}

// hook 用：读 staged blob 的内容 hash（git show :<path>），而不是工作区文件——
// commit 提交的是 staged 内容，不是工作区。
export async function stageHashes(files, { gitShow = null } = {}) {
  const show = gitShow ?? ((f) => execFileSync("git", ["show", `:${f}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
  const hashes = {};
  for (const f of files ?? []) {
    if (!f || typeof f !== "string") continue;
    try {
      hashes[f] = hashContent(await show(f));
    } catch {
      // git show 读不到 = 文件在 index 里已删除；记特殊值与 markReviewed 对齐
      hashes[f] = "deleted";
    }
  }
  return hashes;
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  if (!args.includes("--mark")) {
    console.error("Usage: node review-gate.mjs --mark --verdict <clean|medium|high>");
    process.exit(1);
  }
  const verdictArg = args.find((a) => a === "--verdict" || a.startsWith("--verdict="));
  const verdict = verdictArg
    ? (verdictArg.startsWith("--verdict=") ? verdictArg.slice("--verdict=".length) : args[args.indexOf(verdictArg) + 1])
    : null;
  if (verdict !== "clean" && verdict !== "medium" && verdict !== "high") {
    console.error("--verdict 必填（clean|medium|high）——禁止缺省默认 clean 静默放行");
    process.exit(1);
  }
  try {
    process.chdir(execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim());
  } catch {
    console.error("无法定位仓库根目录，不写标记");
    process.exit(1);
  }
  let files;
  try {
    files = execFileSync("git", ["diff", "HEAD", "--name-only", "-z"], { encoding: "utf8" })
      .split("\0").filter(Boolean);
  } catch (err) {
    console.error(`git diff HEAD 失败，无法收集复审文件，不写标记：${err?.message ?? err}`);
    process.exit(1);
  }
  const codeFiles = files.filter(isCodeFile);
  await markReviewed({ files: codeFiles, verdict });
  console.log(`复审标记已写：${codeFiles.length} 个代码文件，verdict=${verdict}`);
  process.exit(0);
}
