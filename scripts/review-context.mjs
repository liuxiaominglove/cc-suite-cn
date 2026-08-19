import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SOURCE_IMPORT_EXTS } from "./review-tools.mjs";

const RULE_FILES = ["AGENTS.md", "CLAUDE.md"];
const RULES_MAX_LINES = 400;

function truncateLines(text, maxLines) {
  const lines = text.split("\n");
  return lines.length <= maxLines ? text : lines.slice(0, maxLines).join("\n");
}

export async function collectProjectRules({ cwd = process.cwd(), readFile = null, ruleFiles = RULE_FILES, maxLines = RULES_MAX_LINES } = {}) {
  const read = readFile ?? (async (p) => (await import("node:fs/promises")).readFile(p, "utf-8"));
  const sections = [];
  for (const name of ruleFiles) {
    let dir = cwd;
    for (;;) {
      const filePath = join(dir, name);
      try {
        const raw = await read(filePath);
        if (typeof raw === "string" && raw.trim()) {
          sections.push(`=== ${name} ===\n${truncateLines(raw, maxLines)}`);
          break;
        }
      } catch {
        // 规则文件不存在或不可读：向上一级目录继续找
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return sections.join("\n\n");
}

export function buildRulesSection(rules) {
  const text = (rules ?? "").trim();
  return text ? `\n\n[项目规则]\n${text}` : "";
}

export const WORKER_LESSONS_FILE = fileURLToPath(new URL("./worker-lessons.md", import.meta.url));

export function stripMarkdownComments(text) {
  return String(text ?? "").replace(/<!--[\s\S]*?-->/g, "");
}

export async function collectWorkerLessons({ readFile = null, filePath = WORKER_LESSONS_FILE, maxLines = 200 } = {}) {
  const read = readFile ?? (async (p) => (await import("node:fs/promises")).readFile(p, "utf-8"));
  try {
    const raw = await read(filePath);
    if (typeof raw === "string" && raw.trim()) {
      return truncateLines(stripMarkdownComments(raw), maxLines);
    }
  } catch {
    // 教训书不存在或不可读：不注入，静默跳过
  }
  return "";
}

export function buildLessonsSection(lessons) {
  const text = (lessons ?? "").trim();
  return text ? `\n\n[评审教训]\n${text}` : "";
}

function extractExports(content) {
  const names = [];
  const declRe = /export\s+(?:async\s+)?(?:function|const|class|let|var)\s+([\w$]+)/g;
  let m;
  while ((m = declRe.exec(content)) !== null) {
    names.push(m[1]);
  }
  const namedRe = /export\s*\{([^}]+)\}/g;
  while ((m = namedRe.exec(content)) !== null) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) names.push(name);
    }
  }
  return [...new Set(names)];
}

export async function collectImportContext(filePath, { readFile = null } = {}) {
  const read = readFile ?? (async (p) => (await import("node:fs/promises")).readFile(p, "utf-8"));
  const content = await read(filePath).catch(() => "");
  if (!content) return "";

  const baseDir = dirname(filePath);
  const patterns = [
    /import[^;'"]*?from\s*['"](\.[^'"]+)['"]/g,
    /import\s*['"](\.[^'"]+)['"]/g,
    /require\(\s*['"](\.[^'"]+)['"]/g,
  ];
  const localImports = [];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(content)) !== null) {
      localImports.push(m[1]);
    }
  }
  if (localImports.length === 0) return "";

  const parts = [];
  for (const imp of [...new Set(localImports)]) {
    const abs = resolve(baseDir, imp);
    const hasSourceExt = SOURCE_IMPORT_EXTS.some((e) => abs.endsWith(e));
    const indexCandidates = [`${abs}/index.js`, `${abs}/index.mjs`, `${abs}/index.ts`];
    const extCandidates = SOURCE_IMPORT_EXTS.map((e) => `${abs}${e}`);
    const candidates = hasSourceExt ? [abs, ...indexCandidates] : [...extCandidates, ...indexCandidates];
    let modContent = null;
    for (const c of candidates) {
      const r = await read(c).catch(() => null);
      if (r != null) {
        modContent = r;
        break;
      }
    }
    if (modContent == null) continue;
    if (modContent.split("\n").length <= 80) {
      parts.push(`${imp}:\n${modContent}`);
    } else {
      const exports = extractExports(modContent);
      if (exports.length) parts.push(`${imp} 导出: ${exports.join(", ")}`);
    }
  }
  return parts.length ? parts.join("\n\n") : "";
}

function summarizeStack(filename, content) {
  if (filename === "package.json") {
    try {
      const pkg = JSON.parse(content);
      if (!pkg || typeof pkg !== "object") return "";
      const parts = [];
      const engine = pkg.engines?.node;
      parts.push(`Node.js${engine ? ` (node ${engine})` : ""}`);
      const deps = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];
      if (deps.length) parts.push(`deps: ${deps.slice(0, 10).join(", ")}`);
      if (pkg.scripts?.test) {
        const t = String(pkg.scripts.test);
        parts.push(`test: ${t.length > 60 ? t.slice(0, 60) + "…" : t}`);
      }
      return parts.join(" | ");
    } catch {
      return "";
    }
  }
  if (filename === "requirements.txt") {
    const deps = content
      .split("\n")
      .map((l) => l.trim().split(/[<>=!~\s\[]/)[0])
      .filter((d) => d && !d.startsWith("#") && !d.startsWith("-"))
      .slice(0, 10);
    return `Python${deps.length ? ` | deps: ${deps.join(", ")}` : ""}`;
  }
  if (filename === "pyproject.toml") {
    return "Python";
  }
  if (filename === "go.mod") {
    const m = content.match(/^go (\d+\.\d+)/m);
    return `Go${m ? ` (go ${m[1]})` : ""}`;
  }
  if (filename === "Cargo.toml") {
    return "Rust";
  }
  return "";
}

export async function collectStackContext(dir, { readFile = null } = {}) {
  const read = readFile ?? (async (p) => (await import("node:fs/promises")).readFile(p, "utf-8"));
  const stackFiles = ["package.json", "requirements.txt", "pyproject.toml", "go.mod", "Cargo.toml"];
  let cur = dir;
  for (;;) {
    for (const f of stackFiles) {
      const content = await read(join(cur, f)).catch(() => null);
      if (content != null) {
        const summary = summarizeStack(f, content);
        if (summary) return summary;
      }
    }
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return "";
}
