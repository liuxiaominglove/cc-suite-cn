import { runProcess, RunnerError, TimeoutError } from "./runner-core.mjs";
import { buildCommand } from "./backends.mjs";
import { frameCode, extractJson, withRetry, collectProjectRules } from "./review-runner.mjs";

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
      const rep = g.items[0].issue?.finding || "";
      if (findingMatches(text, rep)) {
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
    g.type = g.items.length >= 2 ? "consensus" : "unique";
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

export function buildAdjudicatorPrompt(finding, code, rules = "") {
  const rulesSection = (rules ?? "").trim() ? `\n\n[项目规则]\n${rules}` : "";
  return `你是独立代码审计裁决员（验证审计员）。你的唯一职责：判断下面这条 finding 是不是真的 bug。只读代码，不修代码、不另找新 bug、不给修复建议。下方 CODE 就是完整的被审内容——你只能基于它判断，不要声称搜索了仓库或文件系统（你无权访问它们）。输出 JSON：{"verdict":"true|false|uncertain","evidence":"一句证据"}\n\nFINDING: ${finding}${rulesSection}\n\nCODE:\n${frameCode(code)}`;
}

export function parseVerdict(text) {
  const parsed = extractJson(text);
  if (!parsed || typeof parsed !== "object") {
    return { verdict: "uncertain", evidence: "unparseable output" };
  }
  const v = parsed.verdict;
  if (v === "true" || v === "false" || v === "uncertain") {
    return { verdict: v, evidence: typeof parsed.evidence === "string" ? parsed.evidence : "" };
  }
  return { verdict: "uncertain", evidence: "missing or invalid verdict" };
}

export const ADJUDICATE_TIMEOUT = 900000;

export async function adjudicate({ finding, code, line = null, contextLines = 40, model = "hy3", backend = "codebuddy", timeout = ADJUDICATE_TIMEOUT, spawn = null, rules = "", retries = 0 }) {
  const ctx = line ? extractContext(code, line, { contextLines }) : code;
  const prompt = buildAdjudicatorPrompt(finding, ctx, rules);
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

export async function evaluateModels({ audits, arbitrate = false, adjudicateFn = adjudicate, resolveCode = null, resolveRules = null, retries = 0 }) {
  const perModel = {};
  const allFindings = [];

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
    const results = await Promise.all(
      unique.map(async (f) => {
        const file = f.auditFile || f.issue?.file || "";
        const code = resolveCode ? await resolveCode(file) : "";
        const result = await adjudicateFn({ finding: f.issue?.finding || "", code: code || "", line: f.issue?.line, rules, retries });
        return { f, verdict: result && result.verdict };
      })
    );
    for (const { f, verdict } of results) {
      if (verdict === "true") {
        for (const member of f.cluster ?? [f]) {
          member.m.trueCount += 1;
          if (!member.isConsensus) member.m.uniqueTrue += 1;
        }
      }
    }
  }

  for (const m of Object.values(perModel)) {
    m.precision = m.totalIssues === 0 ? 0 : m.trueCount / m.totalIssues;
    m.sampleInsufficient = m.runs < MIN_SAMPLES;
  }

  return { perModel, minSamples: MIN_SAMPLES, arbitrated: arbitrate };
}

export async function loadAudits() {
  const { defaultStore } = await import("./jobs.mjs");
  const store = defaultStore();
  const jobs = await store.list();
  const completed = jobs.filter((j) => j.type === "audit" && j.status === "completed" && j.result && Array.isArray(j.result.workers));
  return dedupJobsByTask(completed).map((j) => ({ workers: j.result.workers, file: j.task }));
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
    const existing = clusters.find((c) => c.file === file && findingMatches(text, c.representative, { threshold }));
    if (existing) {
      existing.members.push(f);
      continue;
    }
    clusters.push({ file, representative: text, members: [f] });
  }
  return clusters.map((c) => ({ ...c.members[0], cluster: c.members }));
}

export async function cli(args = process.argv.slice(2), { load = loadAudits, stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    const arbitrate = args.includes("--arbitrate");
    const audits = await load();

    if (audits.length === 0) {
      stdout.write("(暂无审计数据，先跑 /audit 积累)\n");
      return 0;
    }

    const resolveCode = async (file) => {
      if (!file) return "";
      const { readFile } = await import("node:fs/promises");
      try {
        return await readFile(file, "utf-8");
      } catch {
        return "";
      }
    };

    const resolveRules = async () => collectProjectRules({ cwd: process.cwd() });

    const { perModel, minSamples, arbitrated } = await evaluateModels({ audits, arbitrate, resolveCode, resolveRules, retries: 2 });

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

if (import.meta.url === `file://${process.argv[1]}`) {
  cli().then((code) => { process.exitCode = code; });
}
