import { runProcess, RunnerError, TimeoutError, isMainModule } from "./runner-core.mjs";
import { buildCommand } from "./backends.mjs";
import { frameCode, extractJson, withRetry } from "./review-tools.mjs";
import { collectProjectRules, collectImportContext, collectStackContext, collectWorkerLessons, buildLessonsSection } from "./review-context.mjs";
import { hashContent, confirmVerdict, modelsOf } from "./verdict-log.mjs";
import { VERIFIER_MODEL } from "./models.mjs";
import { buildOrchestratorPreflight } from "./feedback.mjs";
import { dirname } from "node:path";

// UI/窗口/权限/快捷键类 finding 需要真机点验（单测覆盖不到渲染与系统授权）。
// 只扫 file/finding/fix 三个信号（模型自己的描述 + 文件路径），不扫整份 code——
// 否则 AppKit 文件里处处是 NSWindow，会让标退化成一个「所有 Swift finding 都打」的无用噪音。
export const MANUAL_VERIFY_TOKENS = [
  // AppKit/UIKit 窗口与控件
  "nswindow", "nspanel", "nsscreen", "nsview", "nsalert", "nsbutton", "nstextfield", "nstextview",
  "nsapplication", "nsresponder", "nsworkspace", "nsopenpanel", "nssavepanel", "nsmenu", "nssplitview", "nstableview",
  "uiwindow", "uiview", "uialert", "webview",
  // UI 框架
  "swiftui", "appkit", "uikit",
  // 权限
  "permission", "authorization", "authorize", "tcc", "accessibility",
  "screen recording", "camera", "microphone", "input monitoring", "avcapture",
  // 快捷键 / 全局事件
  "cgevent", "nsevent", "keydown", "keyup", "keycode", "hotkey", "shortcut",
  "addglobalmonitor", "cgeventtap", "eventtap", "globalmonitor",
  // 通用窗口/界面
  // 召回优先（by-design）：这些裸词可能误报（如算法语境的 "time window"），
  // 但误报方向是「多标真机」= 误拦可逆（安全）；漏报（真 UI bug 没标）才不可逆。
  // 对 AppKit/UIKit 应用，window/alert/menu/dialog 恰是正确高频信号，删掉会砍召回。
  "window", "alert", "dialog", "popover", "toolbar", "menu",
];

export function detectManualVerify({ file = "", finding = "", fix = "" } = {}) {
  const haystack = `${file}\n${finding}\n${fix}`.toLowerCase();
  return MANUAL_VERIFY_TOKENS.some((t) => haystack.includes(t));
}

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

export function buildAdjudicatorPrompt(finding, code, rules = "", relatedCode = "", stackContext = "", lessons = "") {
  const rulesSection = (rules ?? "").trim() ? `\n\n[项目规则]\n${rules}` : "";
  const relatedSection = (relatedCode ?? "").trim() ? `\n\n[相关模块源码]（本文件 import 的本地模块，判断 finding 时请查阅其中函数的真实实现）\n${relatedCode}` : "";
  const stackSection = (stackContext ?? "").trim() ? `\n\n[技术栈] ${stackContext}` : "";
  const lessonsSection = buildLessonsSection(lessons);
  return `你是独立代码审计裁决员（验证审计员）。你的唯一职责：判断下面这条 finding 是不是真的 bug。只读代码，不修代码、不另找新 bug、不给修复建议。盲评纪律：上游批判员和评审员的结论与理由均未附给你，你必须只凭代码本身独立判断。下方 CODE 就是完整的被审内容，若附有相关模块源码段，请核对被调用函数的真实实现——若该函数已处理了 finding 所说的问题（如 ~ 展开、路径归一化、null 守卫），则判 false。不要声称搜索了仓库或文件系统（你无权访问它们）。输出 JSON：{"verdict":"true|false|uncertain","evidence":"一句证据"}\n\nFINDING: ${finding}${rulesSection}${lessonsSection}${stackSection}${relatedSection}\n\nCODE:\n${frameCode(code)}`;
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

export async function adjudicate({ finding, code, line = null, contextLines = 40, model = VERIFIER_MODEL, backend = "codebuddy", timeout = ADJUDICATE_TIMEOUT, spawn = null, rules = "", relatedCode = "", stackContext = "", retries = 0, lessons = "" }) {
  const lineCount = code ? String(code).split("\n").length : 0;
  const ctx = line && lineCount > ADJUDICATE_MAX_CTX_LINES ? extractContext(code, line, { contextLines }) : code;
  const prompt = buildAdjudicatorPrompt(finding, ctx, rules, relatedCode, stackContext, lessons);
  const { command, args, stdin } = buildCommand(backend, { model, prompt });

  let stdout;
  try {
    ({ stdout } = await withRetry(async () => {
      const { exitCode, stdout, stderr, timedOut } = await runProcess({ command, args, stdin, timeout, spawn });
      if (timedOut) throw new TimeoutError("adjudication timed out");
      if (exitCode !== 0) throw new RunnerError(`adjudicator exited with code ${exitCode}`, { exitCode, stderr });
      if (!stdout || !stdout.trim()) throw new RunnerError("adjudicator returned empty output (possible rate limit)", { exitCode, stderr });
      return { stdout };
    }, { maxRetries: retries }));
  } catch (err) {
    return { verdict: "uncertain", evidence: err instanceof TimeoutError ? "timeout" : err.message };
  }

  return parseVerdict(stdout);
}

const MIN_SAMPLES = 5;

export async function evaluateModels({ audits }) {
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
        if (g.type === "consensus") {
          m.consensusCount += 1;
        } else {
          m.uniqueCount += 1;
        }
        allFindings.push({ model: item.model, issue: item.issue, auditFile: audit.file || null, isConsensus: g.type === "consensus", m });
      }
    }
  }

  for (const m of Object.values(perModel)) {
    m.avgIssuesPerRun = m.runs === 0 ? 0 : m.totalIssues / m.runs;
    m.consensusRate = m.totalIssues === 0 ? 0 : m.consensusCount / m.totalIssues;
    m.sampleInsufficient = m.runs < MIN_SAMPLES;
  }

  return { perModel, minSamples: MIN_SAMPLES };
}

// 从裁决账本算 per-model precision（免费只读，不重新裁决）。
// 只统计 verdict∈{true,false} 且有模型归属的 finding；无归属的 finding 不参与。
// 独有真 = verdict=true 且只有一个模型报它（别人都漏掉的真 bug）。
export function computePrecision(log, { minSamples = 5 } = {}) {
  const perModel = {};
  for (const v of log ?? []) {
    if (v?.verdict !== "true" && v?.verdict !== "false") continue;
    const models = modelsOf(v);
    if (models.length === 0) continue;
    for (const m of models) {
      if (!perModel[m]) perModel[m] = { total: 0, trueCount: 0, uniqueTrue: 0 };
      perModel[m].total += 1;
      if (v.verdict === "true") {
        perModel[m].trueCount += 1;
        if (models.length === 1) perModel[m].uniqueTrue += 1;
      }
    }
  }
  const out = {};
  for (const [m, s] of Object.entries(perModel)) {
    out[m] = {
      precision: s.total === 0 ? null : s.trueCount / s.total,
      uniqueTrue: s.uniqueTrue,
      samples: s.total,
      sampleInsufficient: s.total < minSamples,
    };
  }
  return out;
}

export async function adjudicateLedger({
  load = null,
  resolveCode = null,
  resolveRules = null,
  resolveImportContext = null,
  resolveStackContext = null,
  resolveLessons = null,
  adjudicateFn = adjudicate,
  persist = null,
  retries = 0,
  adjudicateConcurrency = ADJUDICATE_CONCURRENCY,
  projectDir = null,
  files = null,
} = {}) {
  const loadFn = load ?? (async () => (await import("./verdict-log.mjs")).loadVerdicts());
  const persistFn = persist ?? (async (vs) => (await import("./verdict-log.mjs")).appendVerdicts(vs));
  const log = await loadFn();
  let pending = (log ?? []).filter((v) => v && v.verdict !== "true" && v.verdict !== "false");
  if (Array.isArray(files) && files.length) {
    pending = pending.filter((v) => files.some((f) => matchesFileFilter(v.file, f)));
  }
  if (projectDir) {
    pending = pending.filter((v) => (v.projectDir ?? "") === projectDir);
  }
  if (pending.length === 0) return [];
  const rules = resolveRules ? await resolveRules() : "";
  const lessons = resolveLessons ? await resolveLessons() : "";
  const results = await mapLimit(pending, adjudicateConcurrency, async (f) => {
    const file = f.file ?? "";
    const code = resolveCode ? await resolveCode(file) : "";
    const relatedCode = resolveImportContext ? await resolveImportContext(file) : "";
    const stackContext = resolveStackContext ? await resolveStackContext(file) : "";
    const result = await adjudicateFn({ finding: f.finding ?? "", code: code || "", line: f.line ?? null, rules, lessons, relatedCode, stackContext, retries });
    return {
      file,
      line: f.line ?? null,
      finding: f.finding ?? "",
      verdict: result?.verdict,
      evidence: result?.evidence ?? "",
      codeHash: hashContent(code),
      models: f.models ?? [],
      source: f.source ?? null,
      projectDir: f.projectDir ?? projectDir ?? process.cwd(),
      requiresManualVerify: detectManualVerify({ file, finding: f.finding ?? "", fix: f.fix ?? "" }),
      timestamp: new Date().toISOString(),
    };
  });
  await persistFn(results);
  return results;
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

export function parseProjectDirArg(args) {
  const idx = args.indexOf("--project-dir");
  if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith("--")) {
    return args[idx + 1];
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

export async function confirmFindings(entries, { confirmFn = null, now = () => new Date().toISOString() } = {}) {
  const confirm = confirmFn ?? confirmVerdict;
  const batchAt = now();
  const results = [];
  for (const e of entries ?? []) {
    const final = e?.final;
    if (final !== "true" && final !== "false") {
      results.push({ file: e?.file, line: e?.line, finding: e?.finding, ok: false, error: `invalid final: ${final}` });
      continue;
    }
    const reason = typeof e?.reason === "string" ? e.reason.trim() : "";
    if (!reason) {
      results.push({ file: e?.file, line: e?.line, finding: e?.finding, ok: false, error: "missing reason: 终审必须附代码级依据" });
      continue;
    }
    const independent = e?.independent;
    if (!independent || typeof independent !== "object" || (independent.final !== "true" && independent.final !== "false") || typeof independent.reason !== "string" || !independent.reason.trim()) {
      results.push({ file: e?.file, line: e?.line, finding: e?.finding, ok: false, error: "missing independent: 两步终审步骤 1 盲判必须落实" });
      continue;
    }
    const comparison = typeof e?.comparison === "string" ? e.comparison.trim() : "";
    if (!comparison) {
      results.push({ file: e?.file, line: e?.line, finding: e?.finding, ok: false, error: "missing comparison: 两步终审步骤 2 对比必须落实" });
      continue;
    }
    const matched = await confirm(e.file, e.line, e.finding, { final, reason, independent, comparison, confirmedAt: batchAt, mistakeType: e?.mistakeType });
    results.push({ file: e?.file, line: e?.line, finding: e?.finding, ok: matched != null, matched: matched != null });
  }
  return { batchAt, results };
}

export async function confirmCli(args = process.argv.slice(2), { readFile = null, confirmFn = null, stdout = process.stdout, stderr = process.stderr } = {}) {
  const idx = args.indexOf("--confirm");
  if (idx === -1) return null;
  const path = args[idx + 1];
  if (!path || path.startsWith("--")) {
    stderr.write("Usage: node evaluate-models.mjs --confirm <json-file>\n");
    return 1;
  }
  const read = readFile ?? (async (p) => (await import("node:fs/promises")).readFile(p, "utf-8"));
  let entries;
  try {
    entries = JSON.parse(await read(path));
  } catch (err) {
    stderr.write(`确认文件解析失败：${err.message}\n`);
    return 1;
  }
  if (!Array.isArray(entries)) {
    stderr.write("确认文件必须是 JSON 数组 [{file,line,finding,final,reason}]\n");
    return 1;
  }
  const { batchAt, results } = await confirmFindings(entries, { confirmFn });
  const ok = results.filter((r) => r.ok).length;
  const failed = results.length - ok;
  stdout.write(`终审写回 ${ok} 条（未匹配/非法 ${failed} 条），批次 ${batchAt}\n`);
  return 0;
}


export async function cli(args = process.argv.slice(2), { load = loadAudits, stdout = process.stdout, stderr = process.stderr, adjudicateLedgerFn = null, loadLedger = null } = {}) {
  try {
    const arbitrate = args.includes("--arbitrate");
    const files = parseFileFilterArgs(args);
    const projectDir = parseProjectDirArg(args);

    if (args.includes("--preflight")) {
      const ledgerFn = loadLedger ?? (async () => (await import("./verdict-log.mjs")).loadVerdicts());
      let ledger = [];
      try {
        ledger = await ledgerFn();
      } catch (err) {
        stderr.write(`Warning: 账本读取失败（${err?.message ?? String(err)}），防坑清单跳过\n`);
      }
      const text = buildOrchestratorPreflight(ledger, { projectDir });
      stdout.write(text ? `${text}\n` : "（无历史教训，先跑 /fix 积累）\n");
      return 0;
    }

    if (arbitrate) {
      const { loadVerdicts } = await import("./verdict-log.mjs");
      const log = await loadVerdicts();
      const allFiles = [...new Set((log ?? []).map((v) => v.file).filter(Boolean))];
      const resolveCode = makeResolveCode(allFiles);
      const resolveImportContext = async (file) => {
        if (!file || !allFiles.includes(file)) return "";
        try { return await collectImportContext(file); } catch { return ""; }
      };
      const resolveStackContext = async (file) => {
        if (!file || !allFiles.includes(file)) return "";
        try { return await collectStackContext(dirname(file)); } catch { return ""; }
      };
      const resolveRules = async () => collectProjectRules({ cwd: process.cwd() });
      const resolveLessons = async () => collectWorkerLessons();
      const fn = adjudicateLedgerFn ?? adjudicateLedger;
      const results = await fn({ resolveCode, resolveRules, resolveImportContext, resolveStackContext, resolveLessons, files, retries: 2, projectDir });
      if (results.length === 0) {
        stdout.write("(暂无待裁决的 finding)\n");
        return 0;
      }
      const t = results.filter((r) => r.verdict === "true").length;
      const f = results.filter((r) => r.verdict === "false").length;
      const u = results.length - t - f;
      stdout.write(`已裁决 ${results.length} 条到统一账本（真 ${t} / 假 ${f} / 不确定 ${u}）\n`);
      if (u > 0) {
        stdout.write(`⚠️ 不确定 ${u} 条，需 opencode 代码级终审（别当没事）：\n`);
        for (const r of results.filter((r) => r.verdict !== "true" && r.verdict !== "false")) {
          stdout.write(`  ${r.file ?? ""}:${r.line ?? ""} — ${String(r.finding ?? "").slice(0, 60)}\n`);
        }
      }
      return 0;
    }

    const audits = await load({ files });

    if (audits.length === 0) {
      stdout.write("(暂无审计数据，先跑 /audit 积累)\n");
      return 0;
    }

    const { perModel, minSamples } = await evaluateModels({ audits });
    const ledgerFn = loadLedger ?? (async () => (await import("./verdict-log.mjs")).loadVerdicts());
    let ledger = [];
    try {
      ledger = await ledgerFn();
    } catch (err) {
      stderr.write(`Warning: 裁决账本读取失败（${err?.message ?? String(err)}），precision 列跳过\n`);
    }
    const precision = computePrecision(ledger);

    stdout.write("模型性能评估\n");
    stdout.write("=".repeat(60) + "\n");
    stdout.write(`模型                  run  avg/run  共识率  precision  独有真  样本\n`);
    const models = [...new Set([...Object.keys(perModel), ...Object.keys(precision)])].sort();
    for (const model of models) {
      const q = perModel[model];
      const p = precision[model];
      const runs = q ? String(q.runs) : "—";
      const avg = q ? q.avgIssuesPerRun.toFixed(1) : "—";
      const cons = q ? q.consensusRate.toFixed(2) : "—";
      const prec = p && p.precision != null ? p.precision.toFixed(2) : "—";
      const ut = p ? String(p.uniqueTrue) : "—";
      const insufficient = (q?.sampleInsufficient || p?.sampleInsufficient) ? "⚠不足" : "OK";
      stdout.write(
        `${model.padEnd(20)}  ${runs.padStart(2)}  ${avg.padStart(6)}  ${cons.padStart(6)}  ${prec.padStart(8)}  ${ut.padStart(6)}  ${insufficient}\n`
      );
    }
    stdout.write(`\n(样本阈值 ${minSamples} run/模型；precision = 账本中验证审计员判定为真的比例，仅统计有模型归属且已裁决的 finding)\n`);
    return 0;
  } catch (err) {
    stderr.write(err.message + "\n");
    return 1;
  }
}

if (isMainModule(import.meta.url)) {
  confirmCli(process.argv.slice(2)).then((code) => {
    if (code !== null) {
      process.exitCode = code;
      return;
    }
    cli().then((c) => { process.exitCode = c; });
  });
}
