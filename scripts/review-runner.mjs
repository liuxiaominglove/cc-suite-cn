import { relative, dirname } from "node:path";
import { buildCommand, READ_ONLY_DECLARATION } from "./backends.mjs";
import { setSpawn, RunnerError, TimeoutError, isMainModule } from "./runner-core.mjs";
import { CRITIC_MODEL } from "./models.mjs";
import {
  runModel,
  frameCode,
  extractJson,
  isNLArtifact,
  AuthError,
  chunkCode,
  offsetFindings,
  DEFAULT_TIMEOUT,
} from "./review-tools.mjs";
import {
  REVIEW_PROMPT,
  NL_REVIEW_PROMPT,
  VERIFY_PROMPT,
} from "./review-prompts.mjs";
import {
  collectProjectRules,
  buildRulesSection,
  collectWorkerLessons,
  buildLessonsSection,
  collectImportContext,
  collectStackContext,
} from "./review-context.mjs";
import {
  getDiff,
  validateFilePath,
  DEFAULT_EXTS,
  collectSourceFiles,
  snapshotSourceHashes,
  hashesDiffer,
  SourceTamperedError,
} from "./review-source.mjs";
import { criticize, parseCriticArgs, mapCriticVerdicts, buildMissedFindings } from "./review-critic.mjs";
import { findProjectRoot } from "./audit-baseline.mjs";

export { setSpawn, RunnerError, TimeoutError, AuthError, SourceTamperedError };

const MAX_FILES_WARN = 50;






export async function review({ model, code, customPrompt, timeout = DEFAULT_TIMEOUT, file, dir, exts, allowExternal = false, backend = "codebuddy", diff = false, retries = 0, cwd = process.cwd(), projectRules = null, fileName = null, feedbackPreamble = null, workerLessons = null }) {

  let ruleCwd = cwd;
  let importContext = "";
  let stackContext = "";
  let sourcePaths = [];

  if (!model || typeof model !== "string") {
    throw new RunnerError("model is required", { exitCode: -1, stderr: "model parameter is required" });
  }

  if (model.startsWith("-")) {
    throw new RunnerError("invalid model name", { exitCode: -1, stderr: "model must not start with -" });
  }

  if (diff) {
    if (code || file || dir) {
      throw new RunnerError("diff is mutually exclusive with code, file, and dir", { exitCode: -1, stderr: "Cannot combine diff with code/file/dir" });
    }
    const diffText = await getDiff({ cwd });
    if (!diffText.trim()) {
      return { model, success: false, summary: "no changes to verify (git diff HEAD is empty)", issues: [] };
    }
    code = diffText;
  }

  if (!Number.isFinite(timeout) || timeout <= 0) {
    timeout = DEFAULT_TIMEOUT;
  }

  if (dir != null && typeof dir !== "string") {
    throw new RunnerError("dir must be a string", { exitCode: -1, stderr: "Invalid dir type" });
  }

  if (dir) {
    if (code || file) {
      throw new RunnerError("dir is mutually exclusive with code and file", { exitCode: -1, stderr: "Cannot combine dir with code/file" });
    }

    const { readFile } = await import("node:fs/promises");
    const resolvedDir = validateFilePath(dir, cwd, { allowExternal });
    ruleCwd = resolvedDir;
    stackContext = await collectStackContext(resolvedDir);
    const resolvedExts = exts ?? DEFAULT_EXTS;
    const srcFiles = await collectSourceFiles(resolvedDir, resolvedExts);
    sourcePaths = srcFiles;

    if (srcFiles.length === 0) {
      return {
        model,
        success: false,
        summary: `No source files found in ${dir} (exts: ${resolvedExts.join(",")})`,
        issues: [],
        dir,
        fileCount: 0,
      };
    }

    const parts = [];
    for (const f of srcFiles) {
      const relPath = relative(resolvedDir, f);
      const content = await readFile(f, "utf-8");
      parts.push(`// === File: ${relPath} ===\n${content}`);
    }
    code = parts.join("\n\n");

    if (srcFiles.length > MAX_FILES_WARN) {
      process.stderr.write(`Warning: ${srcFiles.length} source files found — review may hit token limits\n`);
    }
  }

  if (!code && !file) {
    throw new RunnerError("code or file or dir is required", { exitCode: -1, stderr: "No code content provided" });
  }

  if (code !== undefined && typeof code !== "string") {
    throw new RunnerError("code must be a string", { exitCode: -1, stderr: "Invalid code type" });
  }

  if (customPrompt != null && typeof customPrompt !== "string") {
    throw new RunnerError("customPrompt must be a string", { exitCode: -1, stderr: "Invalid customPrompt type" });
  }

  if (file !== undefined && file !== null && typeof file !== "string") {
    throw new RunnerError("file must be a string", { exitCode: -1, stderr: "Invalid file type" });
  }

  if (file) {
    const resolved = validateFilePath(file, cwd, { allowExternal });
    ruleCwd = dirname(resolved);
    sourcePaths = [resolved];
    if (!isNLArtifact(fileName ?? file)) {
      importContext = await collectImportContext(resolved, { rootDir: findProjectRoot(resolved) ?? cwd });
      stackContext = await collectStackContext(ruleCwd);
    }
    if (typeof code !== "string" || code === "") {
      const { readFile } = await import("node:fs/promises");
      code = await readFile(resolved, "utf-8");
    }
  }

  const prompt = customPrompt ?? (diff ? VERIFY_PROMPT : (isNLArtifact(fileName ?? file) ? NL_REVIEW_PROMPT : REVIEW_PROMPT));

  const readOnlyPrefix = `${READ_ONLY_DECLARATION}\n\n`;
  const feedbackSection = feedbackPreamble ? `${feedbackPreamble}\n\n` : "";
  const rules = projectRules ?? (await collectProjectRules({ cwd: ruleCwd }));
  const lessons = workerLessons ?? (await collectWorkerLessons());
  const fileLabel = fileName ? `\n\nFILE: ${fileName}` : "";
  const importSection = importContext ? `\n\n[项目上下文] 本文件 import 的本地模块：\n${importContext}` : "";
  const stackSection = stackContext ? `\n\n[技术栈] ${stackContext}` : "";
  const fullPrompt = `${readOnlyPrefix}${feedbackSection}${prompt}${buildRulesSection(rules)}${buildLessonsSection(lessons)}${stackSection}${importSection}${fileLabel}\n\nCODE:\n${frameCode(code)}`;

  const beforeHashes = await snapshotSourceHashes(sourcePaths);

  const { command, args, stdin } = buildCommand(backend, { model, prompt: fullPrompt });

  const stdout = await runModel({ command, args, stdin, timeout, backend, retries });

  const afterHashes = await snapshotSourceHashes(sourcePaths);
  if (hashesDiffer(beforeHashes, afterHashes)) {
    throw new SourceTamperedError();
  }

  const parsed = extractJson(stdout);
  if (parsed) {
    return {
      model,
      success: true,
      severity: parsed.severity ?? "unknown",
      issues: parsed.issues ?? [],
      summary: parsed.summary ?? "",
      chainAnalysis: parsed.chain_analysis ?? "",
    };
  }

  return {
    model,
    success: true,
    severity: "unknown",
    issues: [],
    summary: stdout.trim(),
    chainAnalysis: "",
    parseError: true,
  };
}

export async function reviewFile({ model, backend, file, chunkSize = 800, overlap = 10, timeout = DEFAULT_TIMEOUT, customPrompt = null, allowExternal = false, reviewFn = null, readFn = null, retries = 0, feedbackPreamble = null }) {
  const reviewFnUsed = reviewFn ?? review;
  const read = readFn ?? (async (f) => {
    const { readFile } = await import("node:fs/promises");
    const resolved = validateFilePath(f, process.cwd(), { allowExternal });
    return readFile(resolved, "utf-8");
  });

  let code;
  try {
    code = await read(file);
  } catch (err) {
    return reviewFnUsed({ model, backend, file, timeout, customPrompt, allowExternal, retries, feedbackPreamble });
  }

  const chunks = chunkCode(code, { chunkSize, overlap });
  if (chunks.length === 1) {
    return reviewFnUsed({ model, backend, code, file, timeout, customPrompt, allowExternal, retries, fileName: file, feedbackPreamble });
  }

  const chunkResults = await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const r = await reviewFnUsed({ model, backend, code: chunk.code, file, timeout, customPrompt, allowExternal, retries, fileName: file, feedbackPreamble });
        return { startLine: chunk.startLine, result: r };
      } catch (err) {
        return { startLine: chunk.startLine, result: { success: false, error: err.message } };
      }
    })
  );

  const issues = offsetFindings(chunkResults);
  const SEVERITY_ORDER = { high: 3, medium: 2, low: 1 };
  const severity = chunkResults.reduce((worst, c) => {
    const s = c.result?.severity;
    if (!s) return worst;
    return (SEVERITY_ORDER[s] ?? 0) > (SEVERITY_ORDER[worst] ?? 0) ? s : worst;
  }, "unknown");

  const chunkErrors = chunkResults
    .filter((c) => !c.result?.success)
    .map((c) => ({ startLine: c.startLine, error: c.result?.error ?? "unknown error" }));

  const chainAnalysis = chunkResults
    .map((c) => (typeof c.result?.chainAnalysis === "string" ? c.result.chainAnalysis.trim() : ""))
    .filter(Boolean)
    .join("\n");

  return {
    model,
    success: chunkResults.every((c) => c.result?.success),
    severity,
    issues,
    chunkErrors,
    chainAnalysis,
    summary: `分 ${chunks.length} 块评审`,
    chunkCount: chunks.length,
  };
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  const criticIdx = args.indexOf("--critic");
  if (criticIdx !== -1) {
    const { file, findingsFile } = parseCriticArgs(args);
    const backend = args.indexOf("--backend") !== -1 ? args[args.indexOf("--backend") + 1] : "qwen";
    const model = args.indexOf("--model") !== -1 ? args[args.indexOf("--model") + 1] : CRITIC_MODEL;
    if (!file || !findingsFile) {
      console.error("Usage: node review-runner.mjs --critic --file <path> --findings-file <json-file> [--backend qwen] [--model ...]");
      process.exit(1);
    }
    const { readFile } = await import("node:fs/promises");
    const code = await readFile(file, "utf-8");
    const findings = JSON.parse(await readFile(findingsFile, "utf-8"));
    let result;
    try {
      result = await criticize({ findings, code, model, backend, retries: 2 });
    } catch (err) {
      if (err instanceof AuthError) throw err;
      result = { verdicts: [], missed: [], error: err?.message ?? String(err) };
    }
    try {
      const { appendCritic, upsertFindings } = await import("./verdict-log.mjs");
      const criticEntries = mapCriticVerdicts(result.verdicts, findings);
      if (criticEntries.length) await appendCritic(criticEntries);
      const missedFindings = buildMissedFindings(result.missed, file);
      if (missedFindings.length) await upsertFindings(missedFindings);
    } catch {
      // 落账失败不阻断批判输出
    }
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }

  const modelIdx = args.indexOf("--model");
  const fileIdx = args.indexOf("--file");
  const dirIdx = args.indexOf("--dir");
  const extsIdx = args.indexOf("--exts");
  const promptIdx = args.indexOf("--prompt");
  const timeoutIdx = args.indexOf("--timeout");
  const backendIdx = args.indexOf("--backend");
  const allowExternal = args.includes("--allow-external");
  const diff = args.includes("--diff");

  if (modelIdx === -1) {
    console.error("Usage: node review-runner.mjs --model <model> --file <path> [--prompt <text>] [--timeout <ms>]");
    console.error("       node review-runner.mjs --model <model> --dir <path> --exts <.ext1,.ext2> [--prompt <text>] [--timeout <ms>]");
    console.error("       node review-runner.mjs --model <model> --diff [--backend <name>]");
    process.exit(1);
  }

  const model = args[modelIdx + 1];
  if (!model || model.startsWith("--")) {
    console.error("--model requires a valid model name");
    process.exit(1);
  }

  const file = fileIdx !== -1 ? args[fileIdx + 1] : null;
  const dir = dirIdx !== -1 ? args[dirIdx + 1] : null;
  const extsRaw = extsIdx !== -1 ? args[extsIdx + 1] : null;
  const exts = extsRaw ? extsRaw.split(",").map((e) => e.trim()) : null;
  const customPrompt = promptIdx !== -1 ? args[promptIdx + 1] : null;

  const rawTimeout = timeoutIdx !== -1 ? parseInt(args[timeoutIdx + 1], 10) : DEFAULT_TIMEOUT;
  const timeout = Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : DEFAULT_TIMEOUT;
  const backend = backendIdx !== -1 ? args[backendIdx + 1] : "codebuddy";
  if (!backend || backend.startsWith("--")) {
    console.error("--backend requires a value (codebuddy/kimi/qwen)");
    process.exit(1);
  }

  if (file && dir) {
    console.error("--file and --dir are mutually exclusive");
    process.exit(1);
  }

  if (!file && !dir && !diff) {
    console.error("Either --file, --dir, or --diff is required");
    process.exit(1);
  }

  const useChunking = !!(file && !dir && !diff);
  let result;
  try {
    result = useChunking
      ? await reviewFile({ model, backend, file, customPrompt, allowExternal, timeout, retries: 2 })
      : await review({ model, file, dir, exts, customPrompt, timeout, allowExternal, backend, diff, retries: 2 });
  } catch (err) {
    result = { model, success: false, error: err?.message ?? String(err), issues: [] };
  }
  console.log(JSON.stringify(result, null, 2));
  if (!result.success) process.exit(1);
}
