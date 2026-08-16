import { runProcess, RunnerError, TimeoutError, isMainModule } from "./runner-core.mjs";
import { buildCommand } from "./backends.mjs";
import { frameCode, extractJson, withRetry, collectProjectRules, collectImportContext, collectStackContext } from "./review-runner.mjs";
import { hashContent } from "./verdict-log.mjs";
import { dirname } from "node:path";

export function normalizeFinding(text) {
  if (typeof text !== "string" || text.trim() === "") {
    return [];
  }
  const lower = text.toLowerCase();
  const tokens = [];
  const ascii = lower.match(/[a-z0-9]+/g) || [];
  tokens.push(...ascii);
  const cjk = lower.match(/[\u4e00-\u9fff]/g) || [];
  for (let i = 0; i + 1 < cjk.length; i++) {
    tokens.push(cjk[i] + cjk[i + 1]);
  }
  return tokens;
}

export function extractContext(code, line, { contextLines = 40 } = {}) {
  if (typeof code !== "string" || code === "") return "";
  if (!Number.isInteger(line) || line < 1) return code;
  const lines = code.split("\n");
  const start = Math.max(1, line - contextLines);
  if (start > lines.length) return code;
  const end = Math.min(lines.length, line + contextLines);
  return lines.slice(start - 1, end).join("\n");
}

export function dice(a, b) {
  if (a.length === 0 && b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  for (const t of setA) {
    if (setB.has(t)) inter += 1;
  }
  return (2 * inter) / (setA.size + setB.size);
}

export function findingMatches(textA, textB, { threshold = 0.5 } = {}) {
  return dice(normalizeFinding(textA), normalizeFinding(textB)) >= threshold;
}

export function sameLocation(a, b) {
  if (!a || !b) return false;
  return a.file === b.file && a.line != null && b.line != null && a.line === b.line;
}

export function classifyConsensus(results) {
  const items = [];
  for (const r of results) {
    if (!r || !r.success) continue;
    const model = r.model;
    for (const issue of r.issues || []) {
      items.push({ model, issue });
    }
  }

  const groups = [];
  for (const item of items) {
    const text = item.issue?.finding || "";
    let matched = null;
    for (const g of groups) {
      const repIssue = g.items[0].issue;
      if (sameLocation(item.issue, repIssue)) {
        matched = g;
        break;
      }
      if (findingMatches(text, repIssue?.finding || "")) {
        matched = g;
        break;
      }
    }
    if (matched) {
      matched.items.push(item);
    } else {
      groups.push({ items: [item] });
    }
  }

  const perModel = {};
  for (const r of results) {
    if (r && r.model && !(r.model in perModel)) {
      perModel[r.model] = { consensusCount: 0, uniqueCount: 0, totalFindings: 0, consensusRate: 0 };
    }
  }

  for (const g of groups) {
    const models = new Set(g.items.map((i) => i.model));
    g.type = models.size >= 2 ? "consensus" : "unique";
    g.size = g.items.length;
    for (const item of g.items) {
      const m = perModel[item.model];
      if (!m) continue;
      m.totalFindings += 1;
      if (g.type === "consensus") m.consensusCount += 1;
      else m.uniqueCount += 1;
    }
  }

  for (const m of Object.values(perModel)) {
    m.consensusRate = m.totalFindings === 0 ? 0 : m.consensusCount / m.totalFindings;
  }

  return { groups, perModel };
}

export function buildAdjudicatorPrompt(finding, code, rules = "", relatedCode = "", stackContext = "") {
  const rulesSection = (rules ?? "").trim() ? `\n\n[项目规则]\n${rules}` : "";
  const relatedSection = (relatedCode ?? "").trim() ? `\n\n[相关模块源码]（本文件 import 的本地模块，判断 finding 时请查阅其中函数的真实实现）\n${relatedCode}` : "";
  const stackSection = (stackContext ?? "").trim() ? `\n\n[技术栈] ${stackContext}` : "";
  return `你是独立代码审计裁决员（验证审计员）。你的唯一职责：判断下面这条 finding 是不是真的 bug。只读代码，不修代码、不另找新 bug、不给修复建议。下方 CODE 就是完整的被审内容，若附有相关模块源码段，请核对被调用函数的真实实现——若该函数已处理了 finding 所说的问题（如 ~ 展开、路径归一化、null 守卫），则判 false。不要声称搜索了仓库或文件系统（你无权访问它们）。输出 JSON：{"verdict":"true|false|uncertain","evidence":"一句证据"}\n\nFINDING: ${finding}${rulesSection}${stackSection}${relatedSection}\n\nCODE:\n${frameCode(code)}`;
}

export function parseVerdict(text) {
  const parsed = extractJson(text);
  if (!parsed || typeof parsed !== "object") {
    return { verdict: "uncertain", evidence: "unparseable output" };
  }
  const vs = typeof parsed.verdict === "string" ? parsed.verdict.trim().toLowerCase() : String(parsed.verdict).toLowerCase();
  if (vs === "true" || vs === "false" || vs === "uncertain") {
    return { verdict: vs, evidence: typeof parsed.evidence === "string" ? parsed.evidence : "" };
  }
  return { verdict: "uncertain", evidence: "missing or invalid verdict" };
}

export const ADJUDICATE_TIMEOUT = 900000;
export const ADJUDICATE_CONCURRENCY = 4;

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const workers = [];
  for (let i = 0; i < workerCount; i++) {
    workers.push(
      (async () => {
        while (true) {
          const idx = next;
          next += 1;
          if (idx >= items.length) break;
          results[idx] = await fn(items[idx], idx);
        }
      })()
    );
  }
  await Promise.all(workers);
  return results;
}

export const ADJUDICATE_MAX_CTX_LINES = 800;

export async function adjudicate({ finding, code, line = null, contextLines = 40, model = "hy3", backend = "codebuddy", timeout = ADJUDICATE_TIMEOUT, spawn = null, rules = "", relatedCode = "", stackContext = "", retries = 0 }) {
  const lineCount = code ? String(code).split("\n").length : 0;
  const ctx = line && lineCount > ADJUDICATE_MAX_CTX_LINES ? extractContext(code, line, { contextLines }) : code;
  const prompt = buildAdjudicatorPrompt(finding, ctx, rules, relatedCode, stackContext);
  const { command, args, stdin } = buildCommand(backend, { model, prompt });

  let stdout;
  try {
    ({ stdout } = await withRetry(async () => {
      const { exitCode, stdout, stderr, timedOut } = await runProcess({ command, args, stdin, timeout, spawn });
      if (timedOut) throw new TimeoutError("adjudication timed out");
      if (exitCode !== 0) throw new RunnerError(`adjudicator exited with code ${exitCode}`, { exitCode, stderr });
      return { stdout };
    }, { maxRetries: retries }));
  } catch (err) {
    return { verdict: "uncertain", evidence: err instanceof TimeoutError ? "timeout" : err.message };
  }

  if (!stdout || !stdout.trim()) {
    return { verdict: "uncertain", evidence: "no output" };
  }
  return parseVerdict(stdout);
}

const MIN_SAMPLES = 5;

export async function evaluateModels({ audits, arbitrate = false, adjudicateFn = adjudicate, resolveCode = null, resolveRules = null, resolveImportContext = null, resolveStackContext = null, retries = 0, adjudicateConcurrency = ADJUDICATE_CONCURRENCY, projectDir = null }) {
  const perModel = {};
  const allFindings = [];
  let verdicts = [];

  for (const audit of audits) {
    const workers = audit.workers || [];
    const { groups } = classifyConsensus(workers);

    for (const w of workers) {
      if (!w || !w.model) continue;
      if (!perModel[w.model]) {
        perModel[w.model] = {
          runs: 0,
          totalIssues: 0,
          severity: {},
          consensusCount: 0,
          uniqueCount: 0,
          trueCount: 0,
          uniqueTrue: 0,
        };
      }
      const m = perModel[w.model];
      if (w.success) {
        m.runs += 1;
        m.totalIssues += (w.issues || []).length;
        for (const issue of w.issues || []) {
          const sev = (issue.severity || w.severity || "unknown").toLowerCase();
          m.severity[sev] = (m.severity[sev] || 0) + 1;
        }
      }
    }

    for (const g of groups) {
      for (const item of g.items) {
        const m = perModel[item.model];
        if (!m) continue;
        const isConsensus = g.type === "consensus";
        if (isConsensus) {
          m.consensusCount += 1;
        } else {
          m.uniqueCount += 1;
        }
        allFindings.push({ model: item.model, issue: item.issue, auditFile: audit.file || null, isConsensus, m });
      }
    }
  }

  for (const m of Object.values(perModel)) {
    m.avgIssuesPerRun = m.runs === 0 ? 0 : m.totalIssues / m.runs;
    m.consensusRate = m.totalIssues === 0 ? 0 : m.consensusCount / m.totalIssues;
  }

  if (arbitrate) {
    const unique = dedupFindings(allFindings);
    const rules = resolveRules ? await resolveRules() : "";
    const results = await mapLimit(unique, adjudicateConcurrency, async (f) => {
      const file = f.auditFile || f.issue?.file || "";
      const code = resolveCode ? await resolveCode(file) : "";
      const relatedCode = resolveImportContext ? await resolveImportContext(file) : "";
      const stackContext = resolveStackContext ? await resolveStackContext(file) : "";
      const result = await adjudicateFn({ finding: f.issue?.finding || "", code: code || "", line: f.issue?.line, rules, relatedCode, stackContext, retries });
      return {
        f,
        verdict: result && result.verdict,
        evidence: result && result.evidence,
        codeHash: hashContent(code),
      };
    });
    for (const { f, verdict } of results) {
      if (verdict === "true") {
        for (const member of f.cluster ?? [f]) {
          member.m.trueCount += 1;
          if (!member.isConsensus) member.m.uniqueTrue += 1;
        }
      }
    }
    verdicts = results.map((r) => ({
      file: r.f.auditFile || r.f.issue?.file || "",
      line: r.f.issue?.line ?? null,
      finding: r.f.issue?.finding || "",
      verdict: r.verdict,
      evidence: r.evidence ?? "",
      codeHash: r.codeHash,
      timestamp: new Date().toISOString(),
      projectDir: projectDir || process.cwd(),
    }));
  }

  for (const m of Object.values(perModel)) {
    m.precision = m.totalIssues === 0 ? 0 : m.trueCount / m.totalIssues;
    m.sampleInsufficient = m.runs < MIN_SAMPLES;
  }

  return { perModel, minSamples: MIN_SAMPLES, arbitrated: arbitrate, verdicts };
}

export async function loadAudits({ files = null } = {}) {
  const { defaultStore } = await import("./jobs.mjs");
  const store = defaultStore();
  const jobs = await store.list();
  const completed = jobs.filter((j) => j.type === "audit" && j.status === "completed" && j.result && Array.isArray(j.result.workers));
  const audits = dedupJobsByTask(completed).map((j) => ({ workers: j.result.workers, file: j.task }));
  return filterAuditsByFiles(audits, files);
}

export function matchesFileFilter(file, filter) {
  if (!file || !filter) return false;
  return file === filter || file.endsWith(`/${filter}`);
}

export function filterAuditsByFiles(audits, files) {
  if (!files || files.length === 0) return audits ?? [];
  return (audits ?? []).filter((a) => files.some((f) => matchesFileFilter(a.file, f)));
}

export function parseFileFilterArgs(args) {
  const filesIdx = args.indexOf("--files");
  if (filesIdx !== -1 && args[filesIdx + 1] && !args[filesIdx + 1].startsWith("--")) {
    return args[filesIdx + 1].split(",").map((s) => s.trim()).filter(Boolean);
  }
  const fileIdx = args.indexOf("--file");
  if (fileIdx !== -1 && args[fileIdx + 1] && !args[fileIdx + 1].startsWith("--")) {
    return [args[fileIdx + 1]];
  }
  return null;
}

export function dedupJobsByTask(jobs) {
  const latest = new Map();
  for (const j of jobs) {
    const key = j.task ?? j.file ?? "";
    const prev = latest.get(key);
    const ts = j.startedAt ?? "";
    if (!prev || ts >= (prev.startedAt ?? "")) {
      latest.set(key, j);
    }
  }
  return [...latest.values()];
}

export function dedupFindings(findings, { threshold = 0.6 } = {}) {
  const clusters = [];
  for (const f of findings) {
    const file = f.auditFile ?? f.file ?? f.issue?.file ?? "";
    const text = f.issue?.finding ?? f.finding ?? "";
    const line = f.issue?.line ?? f.line ?? null;
    const existing = clusters.find((c) => {
      if (c.file === file && line != null && c.line != null && line === c.line) return true;
      return c.file === file && findingMatches(text, c.representative, { threshold });
    });
    if (existing) {
      existing.members.push(f);
      continue;
    }
    clusters.push({ file, line, representative: text, members: [f] });
  }
  return clusters.map((c) => ({ ...c.members[0], cluster: c.members }));
}

export function makeResolveCode(allowedFiles, readFileFn = null) {
  const read = readFileFn ?? (async (p) => (await import("node:fs/promises")).readFile(p, "utf-8"));
  const allowed = new Set([...(allowedFiles ?? [])].filter(Boolean));
  return async (file) => {
    if (!file) return "";
    // 只读 audit 明确记录的 file，防 LLM 幻觉的 file 字段读取任意文件
    if (!allowed.has(file)) return "";
    try {
      return await read(file);
    } catch {
      return "";
    }
  };
}

export async function cli(args = process.argv.slice(2), { load = loadAudits, stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    const arbitrate = args.includes("--arbitrate");
    const files = parseFileFilterArgs(args);
    const audits = await load({ files });

    if (audits.length === 0) {
      stdout.write("(暂无审计数据，先跑 /audit 积累)\n");
      return 0;
    }

    const allowedFiles = audits.map((a) => a.file).filter(Boolean);
    const resolveCode = makeResolveCode(allowedFiles);

    const resolveImportContext = async (file) => {
      if (!file || !allowedFiles.includes(file)) return "";
      try {
        return await collectImportContext(file);
      } catch {
        return "";
      }
    };

    const resolveStackContext = async (file) => {
      if (!file || !allowedFiles.includes(file)) return "";
      try {
        return await collectStackContext(dirname(file));
      } catch {
        return "";
      }
    };

    const resolveRules = async () => collectProjectRules({ cwd: process.cwd() });

    const { perModel, minSamples, arbitrated, verdicts } = await evaluateModels({ audits, arbitrate, resolveCode, resolveImportContext, resolveStackContext, resolveRules, retries: 2 });

    if (arbitrated && verdicts.length) {
      const { persistVerdicts } = await import("./verdict-log.mjs");
      await persistVerdicts(verdicts);
      stdout.write(`已落库 ${verdicts.length} 条裁决到 .cc-suite-cn/verdict-log.json\n`);
    }

    stdout.write("模型性能评估\n");
    stdout.write("=".repeat(60) + "\n");
    const header = arbitrated
      ? `模型                  run  avg/run  共识率  precision  独有真  样本\n`
      : `模型                  run  avg/run  共识率  样本\n`;
    stdout.write(header);
    for (const [model, m] of Object.entries(perModel)) {
      const flag = m.sampleInsufficient ? "⚠不足" : "OK";
      if (arbitrated) {
        stdout.write(
          `${model.padEnd(20)}  ${String(m.runs).padStart(2)}  ${m.avgIssuesPerRun.toFixed(1).padStart(6)}  ${m.consensusRate.toFixed(2).padStart(6)}  ${m.precision.toFixed(2).padStart(8)}  ${String(m.uniqueTrue).padStart(6)}  ${flag}\n`
        );
      } else {
        stdout.write(
          `${model.padEnd(20)}  ${String(m.runs).padStart(2)}  ${m.avgIssuesPerRun.toFixed(1).padStart(6)}  ${m.consensusRate.toFixed(2).padStart(6)}  ${flag}\n`
        );
      }
    }
    stdout.write(`\n(样本阈值 ${minSamples} run/模型；precision = 验证审计员 hy3 判定为真的比例)\n`);
    return 0;
  } catch (err) {
    stderr.write(err.message + "\n");
    return 1;
  }
}

if (isMainModule(import.meta.url)) {
  cli().then((code) => { process.exitCode = code; });
}
