import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { DEFAULT_EXTS } from "./review-source.mjs";
import { SOURCE_IMPORT_EXTS } from "./review-tools.mjs";
import { hashContent } from "./verdict-log.mjs";
import { isMainModule } from "./runner-core.mjs";

export const REVIEW_GATE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../.cc-suite-cn/review-gate.json");

// 标记文件路径可注入：默认 REVIEW_GATE_PATH，测试可用 CC_REVIEW_GATE_PATH 指到临时位置隔离。
export function reviewGatePath() {
  return process.env.CC_REVIEW_GATE_PATH ?? REVIEW_GATE_PATH;
}

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

// 从各评审员的顶层 severity 取最高，算出复审结论（健康判定单一真源，不再人工判）。
export function verdictFromFindings(workers) {
  const severities = (workers ?? []).map((w) => w?.severity);
  if (severities.includes("high")) return "high";
  if (severities.includes("medium")) return "medium";
  // 枚举合法值域 {high, medium, low}：凡非 low 的异常值（unknown/undefined/error/意外字符串）→ 保守判 medium，不静默 clean 放行
  if (severities.some((s) => s !== "low")) return "medium";
  return "clean";
}

// 判断当前 diff 的代码文件 hash 是否与上次复审标记一致（一致 = 改动未变，拒绝重复审）。
export function isDiffUnchanged(gate, currentHashes) {
  if (!gate) return false;
  const files = gate.files ?? {};
  const gateKeys = Object.keys(files);
  const curKeys = Object.keys(currentHashes ?? {});
  if (gateKeys.length !== curKeys.length) return false;
  return gateKeys.every((k) => files[k] === currentHashes[k]);
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

// 读工作区文件内容算 hash（读不到 = 删除，记特殊值与 stageHashes 对齐）。
async function workingHashes(files, readFile) {
  const read = readFile ?? (async (p) => (await import("node:fs/promises")).readFile(p, "utf-8"));
  const hashes = {};
  for (const f of files ?? []) {
    if (!f || typeof f !== "string") continue;
    try {
      hashes[f] = hashContent(await read(f));
    } catch {
      hashes[f] = "deleted";
    }
  }
  return hashes;
}

export async function markReviewed({ files, verdict, filePath = REVIEW_GATE_PATH, readFile = null, writeFile = null, mkdir = null, rename = null } = {}) {
  if (verdict !== "clean" && verdict !== "medium" && verdict !== "high") {
    throw new Error(`markReviewed verdict 必填（clean|medium|high），got: ${verdict}`);
  }
  const hashes = await workingHashes(files, readFile);
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

// 区分「读失败（超限/异常）」与「文件已删」——未知状态不静默归入已知的 "deleted"。
function isMaxBufferError(err) {
  return err?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" || /maxBuffer/i.test(err?.message ?? "");
}

// hook 用：读 staged blob 的内容 hash（git show :<path>），而不是工作区文件——
// commit 提交的是 staged 内容，不是工作区。
export async function stageHashes(files, { gitShow = null } = {}) {
  // TODO 后置：改流式 hash 去 64MB 上限；超限读失败已记 "unreadable" 强制 confirm，不静默当删除。
  const show = gitShow ?? ((f) => execFileSync("git", ["show", `:${f}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
  const hashes = {};
  for (const f of files ?? []) {
    if (!f || typeof f !== "string") continue;
    try {
      hashes[f] = hashContent(await show(f));
    } catch (err) {
      // git show 读不到 = 文件在 index 里已删除；读失败（超限）= 文件存在但读不出，两者分开记
      hashes[f] = isMaxBufferError(err) ? "unreadable" : "deleted";
    }
  }
  return hashes;
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);

  if (args.includes("--check-stale")) {
    try {
      process.chdir(execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim());
    } catch {
      console.log("stale=false（无法定位仓库根目录，允许复审）");
      process.exit(0);
    }
    const gate = await loadGate({ filePath: reviewGatePath() });
    if (!gate) {
      console.log("stale=false verdict=（无复审标记，可复审）");
      process.exit(0);
    }
    let files;
    try {
      files = execFileSync("git", ["diff", "HEAD", "--name-only", "-z"], { encoding: "utf8" })
        .split("\0").filter(Boolean);
    } catch {
      console.log("stale=true（git diff 失败，保守拒绝重审）");
      process.exit(1);
    }
    const codeFiles = files.filter(isCodeFile);
    const currentHashes = await workingHashes(codeFiles);
    if (isDiffUnchanged(gate, currentHashes)) {
      console.log(`stale=true（改动未变，上次复审结论 verdict=${gate.verdict} 仍有效，拒绝重复审）`);
      process.exit(1);
    }
    console.log(`stale=false verdict=${gate.verdict}（改动已变化，可复审）`);
    process.exit(0);
  }

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
  await markReviewed({ files: codeFiles, verdict, filePath: reviewGatePath() });
  console.log(`复审标记已写：${codeFiles.length} 个代码文件，verdict=${verdict}`);
  process.exit(0);
}
