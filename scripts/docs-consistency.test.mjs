import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { REPORT_REQUIRED_SECTIONS, REPORT_MARKER, findMissingReportSections } from "./report-sections.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function globalFile(...segments) {
  return process.env.HOME ? join(process.env.HOME, ...segments) : null;
}

function readGlobalOrSkip(t, ...segments) {
  const p = globalFile(...segments);
  if (!p || !existsSync(p)) {
    t.skip(`全局文件 ${segments.join("/")} 不存在（非本机环境）`);
    return null;
  }
  return readFileSync(p, "utf8");
}

describe("模型 ID 一致性（WI-1）", () => {
  it("AGENTS.md 无 kimi-k2.6 残留", () => {
    const c = readFileSync(join(ROOT, "AGENTS.md"), "utf8");
    assert.doesNotMatch(c, /kimi-k2\.6/, "AGENTS.md 仍含旧模型 kimi-k2.6");
  });

  it("models.json 无 qwen-coder-plus 旧名（统一到 qwen3-coder-plus）", (t) => {
    const c = readGlobalOrSkip(t, ".codebuddy", "models.json");
    if (c === null) return;
    assert.doesNotMatch(c, /qwen-coder-plus/, "models.json 仍含旧名 qwen-coder-plus");
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

describe("命令/规格（WI-5）", () => {
  it("verify.md 无「四施工队」/「4 评审员」/「四模型」", () => {
    const c = readFileSync(join(ROOT, ".opencode/commands/verify.md"), "utf8");
    assert.doesNotMatch(c, /四施工队/, "verify.md 仍写四施工队");
    assert.doesNotMatch(c, /4 评审员/, "verify.md 仍写 4 评审员");
    assert.doesNotMatch(c, /四模型/, "verify.md 仍写四模型");
  });

  it("review.md 命令文件存在（/audit 别名）", () => {
    assert.ok(existsSync(join(ROOT, ".opencode/commands/review.md")), "review.md 应存在于 repo .opencode/commands/");
  });

  it("evaluate.md 描述对齐：precision 免费常驻 + --arbitrate=裁决账本（防漂移）", () => {
    const c = readFileSync(join(ROOT, ".opencode/commands/evaluate.md"), "utf8");
    assert.doesNotMatch(c, /precision.*仅 --arbitrate|仅 --arbitrate.*precision/, "evaluate.md 不应再写「precision 仅 --arbitrate」");
    assert.match(c, /免费只读/, "precision 应标免费只读（从账本读，不重新裁决）");
    assert.match(c, /裁决账本/, "应说明 --arbitrate 是裁决账本（/fix 硬门槛）");
  });

  it("audit.md 含基线检测 + 增量审查说明", () => {
    const c = readFileSync(join(ROOT, ".opencode/commands/audit.md"), "utf8");
    assert.match(c, /增量审查/, "audit.md 缺增量审查说明");
    assert.match(c, /audit-baseline\.mjs/, "audit.md 缺基线检测命令");
    assert.match(c, /--save/, "audit.md 缺审完更新基线");
    assert.match(c, /未提交改动|工作区/, "audit.md 缺工作区未提交提示");
  });

  it("audit-full.md Step 2 批判员用 --critic（非单壳找 bug）", () => {
    const c = readFileSync(join(ROOT, ".opencode/commands/audit-full.md"), "utf8");
    assert.match(c, /--critic/, "audit-full.md 缺 --critic 批判命令");
    assert.match(c, /--findings-file/, "audit-full.md 缺 --findings-file 输入");
  });

  it("fix.md 含审计前置两道闸门", () => {
    const c = readFileSync(join(ROOT, ".opencode/commands/fix.md"), "utf8");
    assert.match(c, /审计前置两道闸门/, "fix.md 缺审计前置闸门声明");
    assert.match(c, /可选.*修复计划|修复计划.*可选/, "fix.md 缺可选修复计划提示");
    assert.match(c, /根因/, "fix.md 缺顺手写根因提示");
  });

  it("fix.md 含两步终审（盲判 → 对比）", () => {
    const c = readFileSync(join(ROOT, ".opencode/commands/fix.md"), "utf8");
    assert.match(c, /两步终审/, "fix.md 缺两步终审");
    assert.match(c, /步骤 1 盲判|步骤 1.*盲判|盲判/, "fix.md 缺步骤 1 盲判");
    assert.match(c, /步骤 2 对比|对比终判/, "fix.md 缺步骤 2 对比");
  });

  it("docs/trust-boundary.md 存在且含已落地 + 搁置 + 重新评估条件", () => {
    const p = join(ROOT, "docs", "trust-boundary.md");
    assert.ok(existsSync(p), "trust-boundary.md 应存在");
    const c = readFileSync(p, "utf8");
    assert.match(c, /resolveCli/, "应含已落地项 resolveCli");
    assert.match(c, /prompt injection/, "应含搁置项 prompt injection");
    assert.match(c, /重新评估/, "应含重新评估条件");
  });

  it("SKILL.md 含审计前置两道闸门", () => {
    const c = readFileSync(join(ROOT, ".opencode/skills/cc-review/SKILL.md"), "utf8");
    assert.match(c, /审计前置两道闸门/, "SKILL.md 缺审计前置闸门声明");
  });

  it("trace.md 命令存在（变更追溯）", () => {
    assert.ok(existsSync(join(ROOT, ".opencode/commands/trace.md")), "trace.md 应存在于 repo .opencode/commands/");
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

  it("path-rename-safety.md 含 rationale（机制/为什么）", (t) => {
    const c = readGlobalOrSkip(t, ".config", "opencode", "rules", "path-rename-safety.md");
    if (c === null) return;
    assert.match(c, /因为|为什么|机制|导致/, "path-rename 缺 rationale");
  });

  it("no-silent-thinking.md 含加粗祈使句", (t) => {
    const c = readGlobalOrSkip(t, ".config", "opencode", "rules", "no-silent-thinking.md");
    if (c === null) return;
    assert.match(c, /\*\*[^*]*(先|必须|应当|不要|禁止|输出)[^*]*\*\*/, "no-silent 缺加粗祈使句");
  });

  it("verification-discipline.md 含「修 bug 前实测触发条件」铁律", (t) => {
    const c = readGlobalOrSkip(t, ".config", "opencode", "rules", "verification-discipline.md");
    if (c === null) return;
    assert.match(c, /触发条件/, "全局验证纪律缺「实测触发条件」铁律");
  });

  it("verification-discipline.md 含「修复建议验证所有调用点」铁律", (t) => {
    const c = readGlobalOrSkip(t, ".config", "opencode", "rules", "verification-discipline.md");
    if (c === null) return;
    assert.match(c, /调用点|所有调用方/, "全局验证纪律缺「验证所有调用点」铁律");
  });

  it("AGENTS.md 含触发条件实测 + 调用点验证铁律", () => {
    const c = readFileSync(join(ROOT, "AGENTS.md"), "utf8");
    assert.match(c, /触发条件实测/, "AGENTS.md 缺「触发条件实测」铁律");
    assert.match(c, /调用点/, "AGENTS.md 缺「验证所有调用点」铁律");
  });

  it("AGENTS.md 含施工队串行纪律（单文件内并行保留）", () => {
    const c = readFileSync(join(ROOT, "AGENTS.md"), "utf8");
    assert.match(c, /默认串行/, "AGENTS.md 缺串行纪律");
    assert.match(c, /单文件内.*并行.*保留/, "应保留「单文件内并行」的措辞");
  });

  it("fix.md 含修前分级 + SKILL.md 含假阳终审", () => {
    const fix = readFileSync(join(ROOT, ".opencode/commands/fix.md"), "utf8");
    assert.match(fix, /分级|优先级/, "fix.md 缺修前分级步骤");
    const skill = readFileSync(join(ROOT, ".opencode/skills/cc-review/SKILL.md"), "utf8");
    assert.match(skill, /假阳/, "SKILL.md 缺假阳终审");
    assert.match(skill, /假阴/, "SKILL.md 缺假阴终审");
  });

  it("cli-concurrency.md 已删除（串行纪律唯一源 = AGENTS.md 施工队调用纪律）", (t) => {
    const p = globalFile(".config", "opencode", "rules", "cli-concurrency.md");
    if (p === null) { t.skip("无 HOME"); return; }
    assert.ok(!existsSync(p), "全局 cli-concurrency.md 应已删除，避免与 AGENTS.md 双份漂移");
  });

  it("gate-not-inner-loop.md 含门禁≠内循环 + Don't bypass", (t) => {
    const c = readGlobalOrSkip(t, ".config", "opencode", "rules", "gate-not-inner-loop.md");
    if (c === null) return;
    assert.match(c, /内循环/, "gate-not-inner-loop 缺内循环");
    assert.match(c, /门禁/, "gate-not-inner-loop 缺门禁");
    assert.match(c, /Don't bypass|修 gate|别跳过/, "gate-not-inner-loop 缺 Don't bypass");
  });

  it("AGENTS.md 含「内循环 vs 门禁」表 + 慢内循环金句", () => {
    const c = readFileSync(join(ROOT, "AGENTS.md"), "utf8");
    assert.match(c, /内循环 vs 门禁/, "AGENTS.md 缺内循环 vs 门禁表");
    assert.match(c, /慢内循环.*被禁用的门禁/, "AGENTS.md 缺慢内循环金句");
  });

  it("known-risks.json 是信任边界单一数据源，trust-boundary.md 表格与其一致", () => {
    const json = JSON.parse(readFileSync(join(ROOT, "scripts", "known-risks.json"), "utf8"));
    const md = readFileSync(join(ROOT, "docs", "trust-boundary.md"), "utf8");
    assert.ok(Array.isArray(json.risks), "known-risks.json 缺 risks 数组");
    const resolved = json.risks.filter((r) => r.status === "resolved");
    const open = json.risks.filter((r) => r.status === "open");
    for (const r of resolved) {
      assert.ok(md.includes(r.location), `trust-boundary.md 漏 resolved 位置 ${r.location}`);
    }
    for (const r of open) {
      const token = r.title.split("（")[0].trim();
      assert.ok(md.includes(token), `trust-boundary.md 漏 open 风险 ${token}`);
    }
    // 反向：trust-boundary.md 已落地表里的每个位置都必须在 JSON 里有对应 resolved 项（防手改表漂移）
    const mdLocations = [...md.matchAll(/`(scripts\/[a-z0-9-]+\.mjs)`/g)].map((m) => m[1]);
    const resolvedLocations = new Set(resolved.map((r) => r.location));
    for (const loc of mdLocations) {
      assert.ok(resolvedLocations.has(loc), `trust-boundary.md 有 JSON 里没有的已落地位置 ${loc}（手改表漂移？）`);
    }
  });
});

describe("报告必带项（report-sections 单一数据源）", () => {
  it("SKILL.md Report Template 含全部必带项", () => {
    const c = readFileSync(join(ROOT, ".opencode/skills/cc-review/SKILL.md"), "utf8");
    for (const req of REPORT_REQUIRED_SECTIONS) {
      assert.ok(c.includes(req), `SKILL.md Report Template 缺必带项「${req}」`);
    }
  });

  it("AGENTS.md 汇报惯例含全部必带项", () => {
    const c = readFileSync(join(ROOT, "AGENTS.md"), "utf8");
    for (const req of REPORT_REQUIRED_SECTIONS) {
      assert.ok(c.includes(req), `AGENTS.md 汇报惯例缺必带项「${req}」`);
    }
  });

  it("verification.md 标记之后的报告段落无缺项", () => {
    const c = readFileSync(join(ROOT, "docs/verification.md"), "utf8");
    assert.ok(c.includes(REPORT_MARKER), "verification.md 应有 report-required 标记");
    const problems = findMissingReportSections(c);
    assert.deepEqual(problems, [], `落账报告缺必带项：${JSON.stringify(problems)}`);
  });
});
