import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

describe("模型 ID 一致性（WI-1）", () => {
  it("kimi.md 无 kimi-k2.6 残留（统一到 k2.7-code）", () => {
    const c = readFileSync(join(ROOT, ".opencode/agents/kimi.md"), "utf8");
    assert.doesNotMatch(c, /kimi-k2\.6/, "kimi.md 仍含旧模型 kimi-k2.6");
  });

  it("kimi.md 走 Moonshot 渠道（moonshotai-cn，非 alibaba-cn）", () => {
    const c = readFileSync(join(ROOT, ".opencode/agents/kimi.md"), "utf8");
    assert.match(c, /moonshotai-cn\/kimi-k2\.7-code/, "kimi.md 应走 Moonshot 渠道");
    assert.doesNotMatch(c, /alibaba-cn\/kimi/, "阿里百炼没有 Kimi，不应走 alibaba-cn");
  });

  it("AGENTS.md 无 kimi-k2.6 残留", () => {
    const c = readFileSync(join(ROOT, "AGENTS.md"), "utf8");
    assert.doesNotMatch(c, /kimi-k2\.6/, "AGENTS.md 仍含旧模型 kimi-k2.6");
  });

  it("models.json 无 qwen-coder-plus 旧名（统一到 qwen3-coder-plus）", () => {
    const c = readFileSync(join(process.env.HOME, ".codebuddy/models.json"), "utf8");
    assert.doesNotMatch(c, /qwen-coder-plus/, "models.json 仍含旧名 qwen-coder-plus");
  });

  it("AGENTS.md 架构图 kimi 走 Moonshot（无 alibaba-cn/kimi）", () => {
    const c = readFileSync(join(ROOT, "AGENTS.md"), "utf8");
    assert.match(c, /moonshotai-cn\/kimi/, "架构图应走 Moonshot 渠道");
    assert.doesNotMatch(c, /alibaba-cn\/kimi/, "阿里没有 Kimi，架构图不应走 alibaba-cn/kimi");
  });

  it("AGENTS.md MOONSHOT_API_KEY 标必需（非可选）", () => {
    const c = readFileSync(join(ROOT, "AGENTS.md"), "utf8");
    const m = c.match(/\| `MOONSHOT_API_KEY` \| ([^|]+) \|/);
    assert.ok(m, "应有 MOONSHOT_API_KEY 行");
    assert.doesNotMatch(m[1], /可选/, "MOONSHOT 应标必需而非可选");
  });
});

describe("AGENTS.md 文档（WI-3）", () => {
  it("无幽灵路径 ~/.config/opencode/skills/cc-review/SKILL.md", () => {
    const c = readFileSync(join(ROOT, "AGENTS.md"), "utf8");
    assert.doesNotMatch(c, /~\/\.config\/opencode\/skills\/cc-review\/SKILL\.md/, "仍含幽灵 skill 路径");
  });

  it("Key Files 表含 backends.mjs + preflight.mjs", () => {
    const c = readFileSync(join(ROOT, "AGENTS.md"), "utf8");
    assert.match(c, /backends\.mjs/, "Key Files 漏 backends.mjs");
    assert.match(c, /preflight\.mjs/, "Key Files 漏 preflight.mjs");
  });

  it("常量名 CRITIC_MODEL / VERIFIER_MODEL 正确（非 CRITIC/VERIFIER）", () => {
    const c = readFileSync(join(ROOT, "AGENTS.md"), "utf8");
    assert.match(c, /CRITIC_MODEL/, "应写 CRITIC_MODEL");
    assert.match(c, /VERIFIER_MODEL/, "应写 VERIFIER_MODEL");
  });

  it("models.json 描述澄清（glm-5.2/hy3 走平台，不属自定义 endpoint）", () => {
    const c = readFileSync(join(ROOT, "AGENTS.md"), "utf8");
    assert.match(c, /glm-5\.2\/hy3 走 codebuddy 平台/, "models.json 描述未澄清 glm-5.2/hy3 走平台");
  });
});

describe("角色概念（WI-4）", () => {
  it("4 个 agent 无「施工队分身」混淆（B 分身可改修，施工队只读）", () => {
    for (const name of ["glm", "kimi", "qwen", "hy3"]) {
      const c = readFileSync(join(ROOT, `.opencode/agents/${name}.md`), "utf8");
      assert.doesNotMatch(c, /施工队分身/, `${name}.md 不应有「施工队分身」混淆`);
    }
  });
});

describe("命令/规格（WI-5）", () => {
  it("verify.md 无「四施工队」/「4 评审员」/「四模型」", () => {
    const c = readFileSync(join(process.env.HOME, ".config/opencode/commands/verify.md"), "utf8");
    assert.doesNotMatch(c, /四施工队/, "verify.md 仍写四施工队");
    assert.doesNotMatch(c, /4 评审员/, "verify.md 仍写 4 评审员");
    assert.doesNotMatch(c, /四模型/, "verify.md 仍写四模型");
  });

  it("review.md 命令文件存在（/audit 别名）", () => {
    assert.ok(existsSync(join(process.env.HOME, ".config/opencode/commands/review.md")), "review.md 应存在");
  });

  it("specs/orchestrator.spec.md 已删除", () => {
    assert.ok(!existsSync(join(ROOT, "specs", "orchestrator.spec.md")), "specs 应已删除");
  });
});

describe("打分 finding（WI-6）", () => {
  it("cc-review SKILL.md 含 <example> 触发块", () => {
    const c = readFileSync(join(ROOT, ".opencode/skills/cc-review/SKILL.md"), "utf8");
    assert.match(c, /<example>/, "cc-review skill 缺 <example> 块");
  });

  it("path-rename-safety.md 含 rationale（机制/为什么）", () => {
    const c = readFileSync(join(process.env.HOME, ".config/opencode/rules/path-rename-safety.md"), "utf8");
    assert.match(c, /因为|为什么|机制|导致/, "path-rename 缺 rationale");
  });

  it("no-silent-thinking.md 含加粗祈使句", () => {
    const c = readFileSync(join(process.env.HOME, ".config/opencode/rules/no-silent-thinking.md"), "utf8");
    assert.match(c, /\*\*[^*]*(先|必须|应当|不要|禁止|输出)[^*]*\*\*/, "no-silent 缺加粗祈使句");
  });
});
