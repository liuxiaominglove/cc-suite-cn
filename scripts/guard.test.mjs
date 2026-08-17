import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { findDuplicateCopies, findMissingCanonical, findStaleReferences, runGuard, findDeadReferences, findOrphanBaselineKeys, findOrphanGlobalRules, findKnownRiskDrift, COPY_LOCATIONS, CANONICAL_FILES, STALE_GLOBAL_PATHS } from "./guard.mjs";
import { homedir } from "node:os";

function fakeExists(present) {
  return (p) => present.has(p);
}

function fakeRead(map) {
  return (f) => (map[f] ?? "");
}

describe("findDuplicateCopies", () => {
  it("returns [] when no copies exist", () => {
    const exists = fakeExists(new Set());
    assert.deepEqual(findDuplicateCopies(COPY_LOCATIONS, exists), []);
  });

  it("detects a runner copy", () => {
    const exists = fakeExists(new Set([COPY_LOCATIONS[0]]));
    assert.deepEqual(findDuplicateCopies(COPY_LOCATIONS, exists), [COPY_LOCATIONS[0]]);
  });

  it("detects an audit-log copy", () => {
    const exists = fakeExists(new Set([COPY_LOCATIONS[1]]));
    assert.deepEqual(findDuplicateCopies(COPY_LOCATIONS, exists), [COPY_LOCATIONS[1]]);
  });

  it("detects a SKILL copy", () => {
    const exists = fakeExists(new Set([COPY_LOCATIONS[2]]));
    assert.deepEqual(findDuplicateCopies(COPY_LOCATIONS, exists), [COPY_LOCATIONS[2]]);
  });

  it("COPY_LOCATIONS targets the global ~/.config/opencode copies", () => {
    assert.ok(COPY_LOCATIONS.some((p) => p.endsWith(".config/opencode/scripts/cc-review/review-runner.mjs")));
    assert.ok(COPY_LOCATIONS.some((p) => p.endsWith(".config/opencode/scripts/cc-review/audit-log.json")));
    assert.ok(COPY_LOCATIONS.some((p) => p.endsWith(".config/opencode/skills/cc-review/SKILL.md")));
  });
});

describe("findMissingCanonical", () => {
  it("returns [] when all canonical files present", () => {
    const present = new Set(CANONICAL_FILES.map((rel) => `/repo/${rel}`));
    const exists = fakeExists(present);
    assert.deepEqual(findMissingCanonical(CANONICAL_FILES, exists, "/repo"), []);
  });

  it("reports a missing canonical file", () => {
    const present = new Set(["/repo/scripts/review-runner.mjs"]);
    const exists = fakeExists(present);
    const missing = findMissingCanonical(CANONICAL_FILES, exists, "/repo");
    assert.ok(missing.includes(".opencode/skills/cc-review/SKILL.md"));
  });
});

describe("findStaleReferences", () => {
  it("returns [] when references are clean", () => {
    const read = fakeRead({
      "audit.md": "/repo/scripts/review-runner.mjs",
      "opencode.jsonc": "/repo/.opencode/skills/cc-review",
    });
    assert.deepEqual(findStaleReferences(["audit.md", "opencode.jsonc"], read), []);
  });

  it("detects a stale scripts path in audit.md", () => {
    const read = fakeRead({ "audit.md": "~/.config/opencode/scripts/cc-review/review-runner.mjs" });
    const problems = findStaleReferences(["audit.md", "opencode.jsonc"], read);
    assert.equal(problems.length, 1);
    assert.ok(problems[0].includes("audit.md"));
    assert.ok(problems[0].includes(STALE_GLOBAL_PATHS[0]));
  });

  it("detects a stale skill path in opencode.jsonc", () => {
    const read = fakeRead({ "opencode.jsonc": '"~/.config/opencode/skills/cc-review"' });
    const problems = findStaleReferences(["audit.md", "opencode.jsonc"], read);
    assert.equal(problems.length, 1);
    assert.ok(problems[0].includes("opencode.jsonc"));
  });

  it("skips missing reference files instead of crashing", () => {
    const read = (f) => { throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); };
    const problems = findStaleReferences(["audit.md", "opencode.jsonc"], read);
    assert.deepEqual(problems, []);
  });

  it("检测绝对路径形式的 stale 引用", () => {
    const read = fakeRead({ "opencode.jsonc": `${homedir()}/.config/opencode/skills/cc-review` });
    const problems = findStaleReferences(["opencode.jsonc"], read);
    assert.equal(problems.length, 1, "绝对路径形式的 stale 引用也应被检测");
  });
});

describe("runGuard", () => {
  it("returns no problems for a clean state", () => {
    const present = new Set(CANONICAL_FILES.map((rel) => `/repo/${rel}`));
    const exists = fakeExists(present);
    const read = fakeRead({});
    const { dupes, missing, staleRefs } = runGuard({
      copies: [],
      canonicals: CANONICAL_FILES,
      refFiles: ["audit.md", "opencode.jsonc"],
      exists,
      read,
      root: "/repo",
    });
    assert.deepEqual(dupes, []);
    assert.deepEqual(missing, []);
    assert.deepEqual(staleRefs, []);
  });

  it("returns duplicate, missing, and stale problems together", () => {
    const present = new Set(["/repo/scripts/review-runner.mjs", COPY_LOCATIONS[1]]);
    const exists = fakeExists(present);
    const read = fakeRead({ "audit.md": "~/.config/opencode/scripts/cc-review/audit-log.json" });
    const { dupes, missing, staleRefs } = runGuard({
      copies: COPY_LOCATIONS,
      canonicals: CANONICAL_FILES,
      refFiles: ["audit.md", "opencode.jsonc"],
      exists,
      read,
      root: "/repo",
    });
    assert.deepEqual(dupes, [COPY_LOCATIONS[1]]);
    assert.ok(missing.includes(".opencode/skills/cc-review/SKILL.md"));
    assert.equal(staleRefs.length, 1);
  });
});

describe("findDeadReferences", () => {
  it("returns [] when SKILL.md only references existing files", () => {
    const read = fakeRead({ "/repo/.opencode/skills/cc-review/SKILL.md": "uses review-runner.mjs and evaluate-models.mjs" });
    const listFiles = () => ["/repo/scripts/review-runner.mjs", "/repo/scripts/evaluate-models.mjs"];
    const problems = findDeadReferences([".opencode/skills/cc-review/SKILL.md"], { read, listFiles, root: "/repo" });
    assert.deepEqual(problems, []);
  });

  it("reports references to nonexistent files", () => {
    const read = fakeRead({ "/repo/.opencode/skills/cc-review/SKILL.md": "uses weight-analyzer.mjs and weights.json" });
    const listFiles = () => [];
    const problems = findDeadReferences([".opencode/skills/cc-review/SKILL.md"], { read, listFiles, root: "/repo" });
    assert.equal(problems.length, 2);
    assert.ok(problems.some((p) => p.includes("weight-analyzer.mjs")));
    assert.ok(problems.some((p) => p.includes("weights.json")));
  });

  it("SKILL.md 缺失时不崩溃", () => {
    const read = (f) => { throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); };
    const listFiles = () => [];
    const problems = findDeadReferences([".opencode/skills/cc-review/SKILL.md"], { read, listFiles, root: "/repo" });
    assert.deepEqual(problems, [], "SKILL.md 缺失应跳过而非崩溃");
  });

  it("根目录合法引用不误报（package.json）", () => {
    const read = fakeRead({ "/repo/.opencode/skills/cc-review/SKILL.md": "see package.json for deps" });
    const listFiles = () => ["/repo/package.json"];
    const problems = findDeadReferences([".opencode/skills/cc-review/SKILL.md"], { read, listFiles, root: "/repo" });
    assert.deepEqual(problems, [], "根目录存在的文件不得误报为死引用");
  });

  it("匹配含点号的文件名", () => {
    const read = fakeRead({ "/repo/.opencode/skills/cc-review/SKILL.md": "uses self-audit.test.mjs" });
    const listFiles = () => ["/repo/scripts/self-audit.test.mjs"];
    const problems = findDeadReferences([".opencode/skills/cc-review/SKILL.md"], { read, listFiles, root: "/repo" });
    assert.deepEqual(problems, [], "含点号的文件名应完整匹配");
  });

  it("子目录引用不误报（scripts/verify/foo.mjs）", () => {
    const read = fakeRead({ "/repo/.opencode/skills/cc-review/SKILL.md": "uses scripts/verify/foo.mjs" });
    const listFiles = () => ["/repo/scripts/verify/foo.mjs"];
    const problems = findDeadReferences([".opencode/skills/cc-review/SKILL.md"], { read, listFiles, root: "/repo" });
    assert.deepEqual(problems, [], "子目录文件不得误报为死引用");
  });
});

describe("findOrphanBaselineKeys", () => {
  it("基线键目录都存在时返回 []", () => {
    const read = fakeRead({ "/repo/.cc-suite-cn/audit-baseline.json": JSON.stringify({ "/Users/x/project/cc-suite-cn": { commit: "c1" } }) });
    const exists = fakeExists(new Set(["/Users/x/project/cc-suite-cn"]));
    const problems = findOrphanBaselineKeys({ baselinePath: "/repo/.cc-suite-cn/audit-baseline.json", read, exists });
    assert.deepEqual(problems, []);
  });

  it("重命名漂移（cc-suite 键目录消失）被检出", () => {
    const read = fakeRead({ "/repo/.cc-suite-cn/audit-baseline.json": JSON.stringify({ "/Users/x/project/cc-suite-pe": { commit: "c1" } }) });
    const exists = fakeExists(new Set());
    const problems = findOrphanBaselineKeys({ baselinePath: "/repo/.cc-suite-cn/audit-baseline.json", read, exists });
    assert.equal(problems.length, 1);
    assert.ok(problems[0].includes("cc-suite-pe"));
  });

  it("无关项目目录消失不误报", () => {
    const read = fakeRead({ "/repo/.cc-suite-cn/audit-baseline.json": JSON.stringify({ "/Users/x/project/learnunk": { commit: "c1" } }) });
    const exists = fakeExists(new Set());
    const problems = findOrphanBaselineKeys({ baselinePath: "/repo/.cc-suite-cn/audit-baseline.json", read, exists });
    assert.deepEqual(problems, [], "只 scoped 到 cc-suite 家族，不误报无关项目");
  });

  it("基线文件缺失/损坏返回 [] 不抛", () => {
    const throwing = () => { throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); };
    assert.deepEqual(findOrphanBaselineKeys({ baselinePath: "/nonexistent.json", read: throwing, exists: () => false }), []);
    const read = fakeRead({ "/repo/bad.json": "{ bad json" });
    assert.deepEqual(findOrphanBaselineKeys({ baselinePath: "/repo/bad.json", read, exists: () => false }), []);
  });

  it("相对基线键按基线文件目录解析（不依赖 process.cwd()）", () => {
    const read = fakeRead({ "/repo/.cc-suite-cn/audit-baseline.json": JSON.stringify({ "cc-suite-cn": { commit: "c1" } }) });
    const exists = fakeExists(new Set(["/repo/.cc-suite-cn/cc-suite-cn"]));
    const problems = findOrphanBaselineKeys({ baselinePath: "/repo/.cc-suite-cn/audit-baseline.json", read, exists });
    assert.deepEqual(problems, [], "相对键应按基线文件目录解析，而非 process.cwd()");
  });
});

describe("findOrphanGlobalRules", () => {
  it("所有规则都被挂载时返回 []", () => {
    const listDir = () => ["path-rename-safety.md", "verification-discipline.md", "no-silent-thinking.md"];
    const read = fakeRead({
      "opencode.jsonc": JSON.stringify({ instructions: [
        "~/.config/opencode/rules/path-rename-safety.md",
        "~/.config/opencode/rules/verification-discipline.md",
        "~/.config/opencode/rules/no-silent-thinking.md",
      ] }),
    });
    const problems = findOrphanGlobalRules({ rulesDir: "/rules", configPath: "opencode.jsonc", listDir, read });
    assert.deepEqual(problems, []);
  });

  it("检测未挂载的孤儿规则（文件名未出现在 instructions）", () => {
    const listDir = () => ["path-rename-safety.md", "swift-safety.md"];
    const read = fakeRead({ "opencode.jsonc": JSON.stringify({ instructions: ["~/.config/opencode/rules/path-rename-safety.md"] }) });
    const problems = findOrphanGlobalRules({ rulesDir: "/rules", configPath: "opencode.jsonc", listDir, read });
    assert.deepEqual(problems, ["swift-safety.md"]);
  });

  it("忽略非 .md 文件", () => {
    const listDir = () => ["foo.md", "README.txt", ".DS_Store"];
    const read = fakeRead({ "opencode.jsonc": JSON.stringify({ instructions: ["~/.config/opencode/rules/foo.md"] }) });
    const problems = findOrphanGlobalRules({ rulesDir: "/rules", configPath: "opencode.jsonc", listDir, read });
    assert.deepEqual(problems, []);
  });

  it("规则目录缺失时返回 [] 不崩", () => {
    const listDir = () => { throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); };
    const read = fakeRead({});
    assert.deepEqual(findOrphanGlobalRules({ rulesDir: "/nonexistent", configPath: "opencode.jsonc", listDir, read }), []);
  });

  it("配置文件缺失时返回 [] 不崩", () => {
    const listDir = () => ["foo.md"];
    const read = () => { throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); };
    assert.deepEqual(findOrphanGlobalRules({ rulesDir: "/rules", configPath: "opencode.jsonc", listDir, read }), []);
  });

  it("JSONC 带注释也能解析出 instructions", () => {
    const listDir = () => ["path-rename-safety.md", "verification-discipline.md"];
    const read = fakeRead({
      "opencode.jsonc": `{\n  "$schema": "https://opencode.ai/config.json", // URL 里的 // 不该被当注释\n  "instructions": [\n    "~/.config/opencode/rules/path-rename-safety.md",\n    /* 块注释 */ "~/.config/opencode/rules/verification-discipline.md"\n  ]\n}`,
    });
    const problems = findOrphanGlobalRules({ rulesDir: "/rules", configPath: "opencode.jsonc", listDir, read });
    assert.deepEqual(problems, []);
  });

  it("子串不误报（a.md 不因 data.md 被误判挂载）", () => {
    const listDir = () => ["a.md"];
    const read = fakeRead({ "opencode.jsonc": JSON.stringify({ instructions: ["~/.config/opencode/rules/data.md"] }) });
    const problems = findOrphanGlobalRules({ rulesDir: "/rules", configPath: "opencode.jsonc", listDir, read });
    assert.deepEqual(problems, ["a.md"], "a.md 未被挂载，不应被 data.md 的子串误判为已挂载");
  });
});

describe("findKnownRiskDrift", () => {
  const cleanRisks = {
    risks: [
      { id: "TR-01", status: "resolved", title: "CLI 命令路径", anchor: "M-1" },
      { id: "KR-01", status: "open", title: "prompt injection", riskLevel: "低", reassessWhen: "审不受信任代码时升级", whyDeferred: "本地工具无信任边界" },
    ],
  };
  const verification = "M-1: resolveCli 绝对路径";

  it("clean state returns []", () => {
    const read = fakeRead({ "known-risks.json": JSON.stringify(cleanRisks), "verification.md": verification });
    assert.deepEqual(findKnownRiskDrift({ knownRisksPath: "known-risks.json", verificationPath: "verification.md", read }), []);
  });

  it("检测重复 id", () => {
    const data = { risks: [
      { id: "TR-01", status: "resolved", title: "a", anchor: "M-1" },
      { id: "TR-01", status: "resolved", title: "b", anchor: "M-1" },
    ] };
    const read = fakeRead({ "known-risks.json": JSON.stringify(data), "verification.md": verification });
    const problems = findKnownRiskDrift({ knownRisksPath: "known-risks.json", verificationPath: "verification.md", read });
    assert.equal(problems.length, 1);
    assert.ok(problems[0].includes("重复") || problems[0].includes("duplicate") || problems[0].includes("TR-01"));
  });

  it("检测非法 status", () => {
    const data = { risks: [{ id: "TR-01", status: "pending", title: "a" }] };
    const read = fakeRead({ "known-risks.json": JSON.stringify(data), "verification.md": verification });
    const problems = findKnownRiskDrift({ knownRisksPath: "known-risks.json", verificationPath: "verification.md", read });
    assert.ok(problems.some((p) => p.includes("status") || p.includes("TR-01")));
  });

  it("检测 resolved 缺 anchor", () => {
    const data = { risks: [{ id: "TR-01", status: "resolved", title: "a" }] };
    const read = fakeRead({ "known-risks.json": JSON.stringify(data), "verification.md": verification });
    const problems = findKnownRiskDrift({ knownRisksPath: "known-risks.json", verificationPath: "verification.md", read });
    assert.ok(problems.some((p) => p.includes("anchor") || p.includes("TR-01")));
  });

  it("检测 anchor 死链（不在 verification.md）", () => {
    const data = { risks: [{ id: "TR-01", status: "resolved", title: "a", anchor: "ZZ-99" }] };
    const read = fakeRead({ "known-risks.json": JSON.stringify(data), "verification.md": verification });
    const problems = findKnownRiskDrift({ knownRisksPath: "known-risks.json", verificationPath: "verification.md", read });
    assert.ok(problems.some((p) => p.includes("ZZ-99")));
  });

  it("检测 open 缺 reassessWhen", () => {
    const data = { risks: [{ id: "KR-01", status: "open", title: "a", riskLevel: "低", whyDeferred: "x" }] };
    const read = fakeRead({ "known-risks.json": JSON.stringify(data), "verification.md": verification });
    const problems = findKnownRiskDrift({ knownRisksPath: "known-risks.json", verificationPath: "verification.md", read });
    assert.ok(problems.some((p) => p.includes("reassessWhen") || p.includes("KR-01")));
  });

  it("检测 open 缺 whyDeferred", () => {
    const data = { risks: [{ id: "KR-01", status: "open", title: "a", riskLevel: "低", reassessWhen: "x" }] };
    const read = fakeRead({ "known-risks.json": JSON.stringify(data), "verification.md": verification });
    const problems = findKnownRiskDrift({ knownRisksPath: "known-risks.json", verificationPath: "verification.md", read });
    assert.ok(problems.some((p) => p.includes("whyDeferred") || p.includes("KR-01")));
  });

  it("文件缺失返回问题（已知债是 canonical 文件，缺失必须报）", () => {
    const throwing = () => { throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); };
    const problems = findKnownRiskDrift({ knownRisksPath: "/nonexistent.json", verificationPath: "/nonexistent.md", read: throwing });
    assert.ok(problems.length >= 1, "缺失应报问题而非静默 []");
  });

  it("文件损坏返回问题", () => {
    const read = fakeRead({ "known-risks.json": "{ bad json", "verification.md": "" });
    const problems = findKnownRiskDrift({ knownRisksPath: "known-risks.json", verificationPath: "verification.md", read });
    assert.ok(problems.length >= 1, "损坏 JSON 应报问题而非静默 []");
  });

  it("anchor 词边界（M-1 不误匹配 M-10）", () => {
    const data = { risks: [{ id: "TR-01", status: "resolved", title: "a", anchor: "M-1" }] };
    const read = fakeRead({ "known-risks.json": JSON.stringify(data), "verification.md": "M-10: 另一个锚点" });
    const problems = findKnownRiskDrift({ knownRisksPath: "known-risks.json", verificationPath: "verification.md", read });
    assert.ok(problems.some((p) => p.includes("M-1")), "M-1 不应因 verification 里有 M-10 而误判为命中");
  });

  it("非数组 risks 报错", () => {
    const read = fakeRead({ "known-risks.json": JSON.stringify({ risks: "nope" }), "verification.md": verification });
    const problems = findKnownRiskDrift({ knownRisksPath: "known-risks.json", verificationPath: "verification.md", read });
    assert.ok(problems.length >= 1);
  });
});
