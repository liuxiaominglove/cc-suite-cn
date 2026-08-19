import { basename } from "node:path";
import { tmpdir } from "node:os";
import { jsonrepair } from "jsonrepair";
import { runProcess, TimeoutError, RunnerError } from "./runner-core.mjs";

export const DEFAULT_TIMEOUT = 900000;

export const SOURCE_IMPORT_EXTS = [".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".tsx", ".jsx"];

const DEFAULT_RETRY_BACKOFF_MS = [10000, 30000];
let _retryBackoffMs = DEFAULT_RETRY_BACKOFF_MS;

export function setRetryBackoffMs(ms) {
  _retryBackoffMs = ms ?? DEFAULT_RETRY_BACKOFF_MS;
}

export async function withRetry(fn, { maxRetries = 0, backoffMs = _retryBackoffMs } = {}) {
  const attempts = Number.isFinite(maxRetries) && maxRetries > 0 ? Math.floor(maxRetries) : 0;
  let lastErr;
  for (let attempt = 0; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const retryable = err instanceof TimeoutError || err instanceof RunnerError;
      if (!retryable || attempt >= attempts) throw err;
      const delay = backoffMs[attempt] ?? backoffMs[backoffMs.length - 1] ?? 0;
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastErr ?? new Error("withRetry: fn was never called");
}

export class AuthError extends Error {
  constructor(message = "Authentication failed") {
    super(message);
    this.name = "AuthError";
  }
}

export function isAuthError(stderr) {
  const lower = String(stderr ?? "").toLowerCase();
  if (lower.includes("unauthorized") || lower.includes("invalid api key")) return true;
  return /(?:^|[\s=(])(?:HTTP[\s/]*)?401\b(?![:\d])/.test(lower);
}

// 所有 backend 的子进程 cwd 统一隔离到 tmpdir（code 与项目规则已内联进 prompt，评审员无需项目 cwd）。
export function resolveReviewCwd() {
  return tmpdir();
}

export async function runModel({ command, args, stdin, timeout, spawn, backend, retries }) {
  const { stdout } = await withRetry(async () => {
    const { exitCode, signal, stdout, stderr, timedOut } = await runProcess({
      command,
      args,
      stdin,
      timeout,
      spawn,
      cwd: resolveReviewCwd(backend),
    });
    if (timedOut) throw new TimeoutError();
    const failed = exitCode !== 0 || (exitCode === null && signal !== null);
    if (failed && isAuthError(stderr)) throw new AuthError();
    if (failed) throw new RunnerError(`${command} exited with code ${exitCode}, signal ${signal}`, { exitCode, stderr });
    if (!stdout || !stdout.trim()) throw new RunnerError(`${command} returned empty output (possible rate limit)`, { exitCode, stderr });
    return { stdout };
  }, { maxRetries: retries });
  return stdout;
}

export function extractJson(text) {
  if (typeof text !== "string" || !text.trim()) return null;

  const candidates = [];
  const push = (c) => {
    const t = (c ?? "").trim();
    if (t && !candidates.includes(t)) candidates.push(t);
  };

  push(text);

  const jsonBlock = text.match(/```json\s*([\s\S]*?)```\s*$/m);
  if (jsonBlock) push(jsonBlock[1]);

  const anyBlock = text.match(/```\s*([\s\S]*?)```\s*$/m);
  if (anyBlock) push(anyBlock[1]);

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    push(text.substring(firstBrace, lastBrace + 1));
  }

  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {}
  }

  for (const c of candidates) {
    if (!/[{[[]/.test(c)) continue;
    try {
      return JSON.parse(jsonrepair(c));
    } catch {}
  }

  return null;
}

export function frameCode(code) {
  let maxRun = 0;
  let cur = 0;
  for (const ch of code) {
    if (ch === "`") {
      cur += 1;
      if (cur > maxRun) maxRun = cur;
    } else {
      cur = 0;
    }
  }
  const fence = "`".repeat(Math.max(3, maxRun + 1));
  return `${fence}\n${code}\n${fence}`;
}

export function chunkCode(code, { chunkSize = 800, overlap = 10 } = {}) {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new Error("chunkSize must be a positive integer");
  }
  if (!Number.isInteger(overlap) || overlap < 0 || overlap >= chunkSize) {
    throw new Error("overlap must be a non-negative integer less than chunkSize");
  }
  const text = typeof code === "string" ? code : "";
  const lines = text.split("\n");
  if (lines.length <= chunkSize) {
    return [{ code: text, startLine: 1 }];
  }
  const chunks = [];
  let start = 0;
  while (start < lines.length) {
    const end = Math.min(start + chunkSize, lines.length);
    chunks.push({ code: lines.slice(start, end).join("\n"), startLine: start + 1 });
    if (end >= lines.length) break;
    start = end - overlap;
  }
  return chunks;
}

export function offsetFindings(chunkResults) {
  const all = [];
  for (const { startLine, result } of chunkResults) {
    if (!result || result.success === false) continue;
    for (const issue of result.issues || []) {
      const line = typeof issue.line === "number" ? issue.line + startLine - 1 : issue.line;
      all.push({ ...issue, line });
    }
  }
  return all;
}

export function isNLArtifact(file) {
  if (typeof file !== "string" || !file) return false;
  const f = file.toLowerCase();
  if (!f.endsWith(".md")) return false;
  const bn = basename(f);
  return (
    f.includes("/commands/") ||
    f.includes("/skills/") ||
    f.includes("/agents/") ||
    f.includes("/rules/") ||
    bn === "skill.md" ||
    bn === "agents.md" ||
    bn === "claude.md"
  );
}
