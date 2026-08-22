import { buildCommand } from "./backends.mjs";
import { CRITIC_MODEL } from "./models.mjs";
import { CRITIC_PROMPT, SELF_CHECK_PROMPT } from "./review-prompts.mjs";
import { frameCode, runModel, extractJson, DEFAULT_TIMEOUT } from "./review-tools.mjs";
import { buildLessonsSection } from "./review-context.mjs";

export function buildCriticPrompt(findings, code, lessons = "") {
  const list = (findings ?? [])
    .map((f, i) => `[${i}] ${f.file ?? ""}:${f.line ?? ""} — ${f.finding ?? ""}`)
    .join("\n");
  const lessonsSection = buildLessonsSection(lessons);
  return `${CRITIC_PROMPT}${lessonsSection}\n\nFINDINGS:\n${list || "（空清单）"}\n\nCODE:\n${frameCode(code ?? "")}`;
}

export async function criticize({ findings, code, model = CRITIC_MODEL, backend = "qwen", timeout = DEFAULT_TIMEOUT, spawn = null, retries = 0, lessons = "" }) {
  const prompt = buildCriticPrompt(findings, code, lessons);
  const { command, args, stdin } = buildCommand(backend, { model, prompt });

  const stdout = await runModel({ command, args, stdin, timeout, spawn, backend, retries });

  const parsed = extractJson(stdout);
  if (!parsed || typeof parsed !== "object") {
    return { verdicts: [], missed: [] };
  }
  return {
    verdicts: Array.isArray(parsed.verdicts) ? parsed.verdicts : [],
    missed: Array.isArray(parsed.missed) ? parsed.missed : [],
  };
}

export function parseCriticArgs(args) {
  const fileIdx = args.indexOf("--file");
  const findingsIdx = args.indexOf("--findings-file");
  return {
    file: fileIdx !== -1 ? args[fileIdx + 1] : null,
    findingsFile: findingsIdx !== -1 ? args[findingsIdx + 1] : null,
  };
}

export function mapCriticVerdicts(verdicts, findings) {
  return (verdicts ?? [])
    .map((v) => {
      const f = (findings ?? [])[Number(v?.index)];
      if (!f) return null;
      return { file: f.file ?? "", line: f.line ?? null, finding: f.finding ?? "", agree: v.agree === true, reason: v.reason ?? "" };
    })
    .filter(Boolean);
}

export function buildMissedFindings(missed, file, { projectDir = process.cwd(), model = CRITIC_MODEL } = {}) {
  return (missed ?? []).map((m) => ({
    file: m.file ?? file,
    line: m.line ?? null,
    finding: m.finding ?? "",
    chainAnalysis: m.reason ?? "",
    source: "qwen-critic",
    models: [model],
    projectDir,
  }));
}


export function buildSelfCheckPrompt(findings, code, lessons = "") {
  const list = (findings ?? [])
    .map((f, i) => `[${i}] ${f.file ?? ""}:${f.line ?? ""} — ${f.finding ?? ""}`)
    .join("\n");
  const lessonsSection = buildLessonsSection(lessons);
  return `${SELF_CHECK_PROMPT}${lessonsSection}\n\nFINDINGS:\n${list || "（空清单）"}\n\nCODE:\n${frameCode(code ?? "")}`;
}

export async function selfCheck({ findings, code, model, backend = "codebuddy", timeout = DEFAULT_TIMEOUT, spawn = null, retries = 0, lessons = "" }) {
  const prompt = buildSelfCheckPrompt(findings, code, lessons);
  const { command, args, stdin } = buildCommand(backend, { model, prompt });

  const stdout = await runModel({ command, args, stdin, timeout, spawn, backend, retries });

  const parsed = extractJson(stdout);
  if (!parsed || !Array.isArray(parsed.survivors)) {
    return { survivors: [] };
  }
  return { survivors: parsed.survivors };
}

export function applySelfCheck(findings, survivors) {
  const keep = new Set(
    (survivors ?? [])
      .filter((s) => s && s.keep === true)
      .map((s) => Number(s.index))
      .filter((n) => Number.isInteger(n) && n >= 0)
  );
  return (findings ?? []).filter((_, i) => keep.has(i));
}


