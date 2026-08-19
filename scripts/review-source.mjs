import { spawn as nodeSpawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { join, resolve, sep } from "node:path";
import { RunnerError } from "./runner-core.mjs";
import { hashContent } from "./verdict-log.mjs";

export const DEFAULT_EXTS = [".swift", ".js", ".ts", ".tsx", ".jsx", ".py", ".go", ".rs", ".java", ".kt", ".c", ".cpp", ".h", ".m", ".mm"];
const SKIP_DIRS = new Set(["node_modules", ".git", ".build", "DerivedData", "Pods", "__pycache__", "dist", "build", ".next", ".turbo"]);

let _gitSpawn = null;

export function setGitSpawn(fn) {
  _gitSpawn = fn;
}

export class SourceTamperedError extends Error {
  constructor(message = "Reviewed source files were modified during review") {
    super(message);
    this.name = "SourceTamperedError";
  }
}

export async function collectSourceFiles(dirPath, exts = DEFAULT_EXTS) {
  const { readdir } = await import("node:fs/promises");

  const files = [];
  const entries = await readdir(dirPath, { withFileTypes: true });

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith(".")) continue;

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const sub = await collectSourceFiles(join(dirPath, entry.name), exts);
      files.push(...sub);
    } else if (entry.isFile()) {
      if (exts.some((e) => entry.name.endsWith(e))) {
        files.push(join(dirPath, entry.name));
      }
    }
  }

  return files;
}

export function validateFilePath(filePath, baseDir = process.cwd(), opts = {}) {
  if (opts.allowExternal) return resolve(baseDir, filePath);

  const resolved = resolve(baseDir, filePath);
  const resolvedBase = resolve(baseDir);
  const basePrefix = resolvedBase.endsWith(sep) ? resolvedBase : resolvedBase + sep;
  if (resolved !== resolvedBase && !resolved.startsWith(basePrefix)) {
    throw new RunnerError("File path is outside project directory", { exitCode: -1, stderr: "Invalid file path" });
  }
  return resolved;
}

export async function snapshotSourceHashes(paths, { readFile = null } = {}) {
  const read = readFile ?? (async (p) => (await import("node:fs/promises")).readFile(p));
  const hashes = {};
  for (const p of paths ?? []) {
    if (!p || typeof p !== "string") continue;
    try {
      const content = await read(p);
      hashes[p] = hashContent(content);
    } catch {
      // 读不到的文件跳过（文件可能不存在，如 code 内联但 file 只是标签）
    }
  }
  return hashes;
}

// 只检测「被审文件被修改」：只遍历 before 的 key。
// 评审期间新建的文件不在被审集合内，其风险已由 cwd 隔离（tmpdir）兜底，故不在此检测。
export function hashesDiffer(before, after) {
  for (const [p, h] of Object.entries(before ?? {})) {
    if ((after ?? {})[p] !== h) return true;
  }
  return false;
}

export function getDiff({ cwd = process.cwd(), spawn } = {}) {
  const gitSpawn = spawn ?? _gitSpawn ?? nodeSpawn;

  return new Promise((resolve, reject) => {
    let proc;
    try {
      proc = gitSpawn("git", ["diff", "HEAD"], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      if (err.code === "ENOENT") {
        reject(new RunnerError("git not found", { exitCode: -1, stderr: err.message }));
      } else {
        reject(err);
      }
      return;
    }

    const stdout = [];
    const stderr = [];
    proc.stdout.on("data", (c) => stdout.push(Buffer.from(c)));
    proc.stderr.on("data", (c) => stderr.push(Buffer.from(c)));
    proc.on("error", (err) => {
      if (err.code === "ENOENT") {
        reject(new RunnerError("git not found", { exitCode: -1, stderr: err.message }));
      } else {
        reject(err);
      }
    });
    proc.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString("utf-8"));
      } else {
        reject(new RunnerError(`git exited with code ${code}`, { exitCode: code, stderr: Buffer.concat(stderr).toString("utf-8") }));
      }
    });
  });
}
