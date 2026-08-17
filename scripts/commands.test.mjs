import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const COMMANDS_DIR = join(ROOT, ".opencode", "commands");
const AGENTS_MD = readFileSync(join(ROOT, "AGENTS.md"), "utf8");

const VAGUE_QUANTIFIERS = [
  "尽量", "尽可能", "适当", "酌情", "若干", "大概", "左右",
  "基本上", "差不多", "一些", "某些", "有时", "偶尔", "及时", "快速",
];

function commandFiles() {
  return readdirSync(COMMANDS_DIR).filter((f) => f.endsWith(".md"));
}

function frontmatter(content, key) {
  const m = content.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  return m ? m[1].trim() : null;
}

describe("command frontmatter 校验", () => {
  it("命令目录非空且每个命令都有非空 description", () => {
    const files = commandFiles();
    assert.ok(files.length > 0, "命令目录不应为空");
    for (const f of files) {
      const content = readFileSync(join(COMMANDS_DIR, f), "utf8");
      const desc = frontmatter(content, "description");
      assert.ok(desc && desc.length > 0, `${f} 缺非空 description`);
    }
  });

  it("正文用 $ARGUMENTS 的命令必有 argument-hint", () => {
    for (const f of commandFiles()) {
      const content = readFileSync(join(COMMANDS_DIR, f), "utf8");
      if (!content.includes("$ARGUMENTS")) continue;
      const hint = frontmatter(content, "argument-hint");
      assert.ok(hint && hint.length > 0, `${f} 用 $ARGUMENTS 但缺 argument-hint`);
    }
  });

  it("每个命令在 AGENTS.md 命令表有对应（/命令名）", () => {
    for (const f of commandFiles()) {
      const name = f.replace(/\.md$/, "");
      assert.ok(AGENTS_MD.includes(`/${name}`), `AGENTS.md 命令表缺 /${name}`);
    }
  });

  it("description 无模糊量词", () => {
    for (const f of commandFiles()) {
      const content = readFileSync(join(COMMANDS_DIR, f), "utf8");
      const desc = frontmatter(content, "description") ?? "";
      for (const v of VAGUE_QUANTIFIERS) {
        assert.ok(!desc.includes(v), `${f} 的 description 含模糊量词「${v}」`);
      }
    }
  });
});
