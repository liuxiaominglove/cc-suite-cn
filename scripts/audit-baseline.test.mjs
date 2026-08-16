import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitHead, gitChangedFiles, gitDirty, loadBaseline, saveBaseline, detectAuditScope, parseSaveArgs } from "./audit-baseline.mjs";

function fakeExec(handler) {
  return (cmd, opts) => {
    const r = handler(cmd);
    if (r === undefined) throw new Error(`command failed: ${cmd}`);
    return r;
  };
}

describe("gitHead", () => {
  it("返回当前 HEAD commit（trim 后）", () => {
    const exec = fakeExec((cmd) => (cmd.includes("rev-parse") ? "abc123\n" : undefined));
    assert.equal(gitHead("/repo", exec), "abc123");
  });

  it("非 git 仓库返回 null", () => {
    const exec = () => {
      throw new Error("fatal: not a git repository");
    };
    assert.equal(gitHead("/repo", exec), null);
  });

  it("exec 返回空串时不抛错", () => {
    const exec = fakeExec((cmd) => (cmd.includes("rev-parse") ? "" : undefined));
    assert.equal(gitHead("/repo", exec), "");
  });
});

describe("gitChangedFiles", () => {
  it("返回变更文件列表（diff + untracked）", () => {
    const exec = fakeExec((cmd) => {
      if (cmd.includes("diff --name-only")) return "src/a.js\nsrc/b.js\n";
      if (cmd.includes("ls-files")) return "new-file.js\n";
      return undefined;
    });
    const files = gitChangedFiles("abc123def456", "/repo", exec);
    assert.deepEqual(files, ["src/a.js", "src/b.js", "new-file.js"]);
  });

  it("无变更返回空数组", () => {
    const exec = fakeExec((cmd) => "");
    assert.deepEqual(gitChangedFiles("abc123def456", "/repo", exec), []);
  });

  it("git 命令失败返回 null（区别于无变更）", () => {
    const exec = () => {
      throw new Error("git failed");
    };
    assert.equal(gitChangedFiles("abc123def456", "/repo", exec), null);
  });

  it("过滤空行和空白行", () => {
    const exec = fakeExec((cmd) => {
      if (cmd.includes("diff --name-only")) return "a.js\n\n  \nb.js\n";
      return "";
    });
    assert.deepEqual(gitChangedFiles("abc123def456", "/repo", exec), ["a.js", "b.js"]);
  });

  it("去重 diff 与 untracked 的重叠路径", () => {
    const exec = fakeExec((cmd) => {
      if (cmd.includes("diff --name-only")) return "a.js\n";
      if (cmd.includes("ls-files")) return "a.js\n";
      return "";
    });
    assert.deepEqual(gitChangedFiles("abc123def456", "/repo", exec), ["a.js"], "重叠路径应去重");
  });

  it("纳入未提交的 tracked 改动", () => {
    const exec = fakeExec((cmd) => {
      if (cmd.includes("..HEAD")) return "committed.js\n";
      if (cmd.includes("diff --name-only") && cmd.endsWith("HEAD")) return "uncommitted.js\n";
      if (cmd.includes("ls-files")) return "";
      return undefined;
    });
    assert.deepEqual(gitChangedFiles("abc123def456", "/repo", exec), ["committed.js", "uncommitted.js"], "应同时含已提交与未提交的 tracked 文件");
  });

  it("未提交与已提交/untracked 重叠时去重", () => {
    const exec = fakeExec((cmd) => {
      if (cmd.includes("..HEAD")) return "a.js\n";
      if (cmd.includes("diff --name-only") && cmd.endsWith("HEAD")) return "a.js\nb.js\n";
      if (cmd.includes("ls-files")) return "b.js\n";
      return undefined;
    });
    assert.deepEqual(gitChangedFiles("abc123def456", "/repo", exec), ["a.js", "b.js"], "三路重叠路径应去重");
  });
});

describe("loadBaseline / saveBaseline", () => {
  async function tmpPath() {
    const dir = await mkdtemp(join(tmpdir(), "baseline-"));
    return join(dir, "audit-baseline.json");
  }

  it("保存后能读回", async () => {
    const p = await tmpPath();
    await saveBaseline("/p", { commit: "c1", auditedAt: "t" }, p);
    const b = await loadBaseline(p);
    assert.equal(b["/p"].commit, "c1");
  });

  it("文件不存在返回空对象", async () => {
    const p = await tmpPath();
    assert.deepEqual(await loadBaseline(p), {});
  });

  it("损坏 JSON 返回空对象", async () => {
    const dir = await mkdtemp(join(tmpdir(), "baseline-"));
    const p = join(dir, "bad.json");
    await writeFile(p, "{ bad json", "utf8");
    assert.deepEqual(await loadBaseline(p), {});
  });

  it("追加新项目保留旧项目", async () => {
    const p = await tmpPath();
    await saveBaseline("/a", { commit: "c1" }, p);
    await saveBaseline("/b", { commit: "c2" }, p);
    const b = await loadBaseline(p);
    assert.equal(b["/a"].commit, "c1");
    assert.equal(b["/b"].commit, "c2");
  });

  it("原子写不残留 .tmp 文件", async () => {
    const dir = await mkdtemp(join(tmpdir(), "baseline-"));
    const p = join(dir, "audit-baseline.json");
    await saveBaseline("/a", { commit: "c1" }, p);
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(dir);
    assert.ok(!files.some((f) => f.endsWith(".tmp")), "不应残留 .tmp 临时文件");
    const b = await loadBaseline(p);
    assert.equal(b["/a"].commit, "c1");
  });
});

describe("detectAuditScope", () => {
  async function tmpPath() {
    const dir = await mkdtemp(join(tmpdir(), "baseline-"));
    return join(dir, "audit-baseline.json");
  }

  it("首次审计（无基线）返回 firstAudit", async () => {
    const p = await tmpPath();
    const exec = fakeExec((cmd) => (cmd.includes("rev-parse") ? "c1\n" : undefined));
    const r = await detectAuditScope("/proj", { cwd: "/repo", exec, path: p });
    assert.equal(r.isGit, true);
    assert.equal(r.changed, true);
    assert.equal(r.firstAudit, true);
    assert.equal(r.files, null);
    assert.equal(r.head, "c1");
  });

  it("基线 == HEAD 返回无变更", async () => {
    const p = await tmpPath();
    await saveBaseline("/proj", { commit: "c1" }, p);
    const exec = fakeExec((cmd) => (cmd.includes("rev-parse") ? "c1\n" : undefined));
    const r = await detectAuditScope("/proj", { cwd: "/repo", exec, path: p });
    assert.equal(r.changed, false);
    assert.deepEqual(r.files, []);
  });

  it("基线 == HEAD 但工作区 dirty 时返回未提交文件", async () => {
    const p = await tmpPath();
    await saveBaseline("/proj", { commit: "c1111111" }, p);
    const exec = fakeExec((cmd) => {
      if (cmd.includes("rev-parse")) return "c1111111\n";
      if (cmd.includes("status --porcelain")) return "M a.js\n";
      if (cmd.includes("..HEAD")) return "";
      if (cmd.includes("diff --name-only")) return "uncommitted.js\n";
      if (cmd.includes("ls-files")) return "";
      return undefined;
    });
    const r = await detectAuditScope("/proj", { cwd: "/repo", exec, path: p });
    assert.equal(r.dirty, true);
    assert.equal(r.changed, true, "有未提交改动应视为有变更");
    assert.deepEqual(r.files, ["uncommitted.js"], "应返回未提交的改动文件");
  });

  it("基线 != HEAD 返回变更文件", async () => {
    const p = await tmpPath();
    await saveBaseline("/proj", { commit: "abc123def456" }, p);
    const exec = fakeExec((cmd) => {
      if (cmd.includes("rev-parse")) return "def456abc789\n";
      if (cmd.includes("diff --name-only")) return "src/a.js\n";
      return "";
    });
    const r = await detectAuditScope("/proj", { cwd: "/repo", exec, path: p });
    assert.equal(r.changed, true);
    assert.equal(r.firstAudit, false);
    assert.deepEqual(r.files, ["src/a.js"]);
    assert.equal(r.baseCommit, "abc123def456");
  });

  it("非 git 仓库返回 isGit=false", async () => {
    const p = await tmpPath();
    const exec = () => {
      throw new Error("not a git repo");
    };
    const r = await detectAuditScope("/proj", { cwd: "/repo", exec, path: p });
    assert.equal(r.isGit, false);
    assert.equal(r.changed, false);
  });
});

describe("parseSaveArgs", () => {
  it("解析 --save <project>（无 --commit）", () => {
    const r = parseSaveArgs(["--save", "/p"]);
    assert.equal(r.project, "/p");
    assert.equal(r.commit, null);
  });

  it("解析 --save <project> --commit <hash>", () => {
    const r = parseSaveArgs(["--save", "/p", "--commit", "abc1234"]);
    assert.equal(r.project, "/p");
    assert.equal(r.commit, "abc1234");
  });

  it("--commit 非 hex 值被拒绝", () => {
    assert.equal(parseSaveArgs(["--save", "/p", "--commit", "main"]).commit, null);
    assert.equal(parseSaveArgs(["--save", "/p", "--commit", "HEAD"]).commit, null);
    assert.equal(parseSaveArgs(["--save", "/p", "--commit", "refs/heads/x"]).commit, null);
  });
});

describe("gitChangedFiles 命令注入防护", () => {
  it("拒绝非法 baseCommit 格式（防命令注入）", () => {
    const executed = [];
    const exec = (cmd) => {
      executed.push(cmd);
      return "";
    };
    const files = gitChangedFiles("bad; rm -rf /", "/repo", exec);
    assert.deepEqual(files, []);
    assert.ok(executed.every((c) => !c.includes("rm -rf")), "不应执行含注入片段的命令");
  });

  it("接受合法 commit hash", () => {
    const exec = (cmd) => (cmd.includes("diff") ? "a.js\n" : "");
    assert.deepEqual(gitChangedFiles("abc123def456", "/repo", exec), ["a.js"]);
  });
});

describe("gitChangedFiles 吞错误", () => {
  it("git diff 失败时返回 null（不返回部分 untracked）", () => {
    const exec = (cmd) => {
      if (cmd.includes("diff")) throw new Error("diff failed");
      if (cmd.includes("ls-files")) return "untracked.js\n";
      return "";
    };
    assert.equal(gitChangedFiles("abc123def456", "/repo", exec), null);
  });
});

describe("parseSaveArgs --commit 无值", () => {
  it("--commit 后无值返回 hasCommitFlag=true + commit=null", () => {
    const r = parseSaveArgs(["--save", "/p", "--commit"]);
    assert.equal(r.hasCommitFlag, true);
    assert.equal(r.commit, null);
  });

  it("--commit 后是另一个 flag 也视为无值", () => {
    const r = parseSaveArgs(["--save", "/p", "--commit", "--detect"]);
    assert.equal(r.commit, null);
  });
});

describe("saveBaseline 并发安全", () => {
  it("并发保存不同项目不丢失", async () => {
    const dir = await mkdtemp(join(tmpdir(), "baseline-"));
    const p = join(dir, "b.json");
    await Promise.all([
      saveBaseline("/a", { commit: "c1" }, p),
      saveBaseline("/b", { commit: "c2" }, p),
    ]);
    const b = await loadBaseline(p);
    assert.equal(b["/a"].commit, "c1");
    assert.equal(b["/b"].commit, "c2");
  });
});

describe("gitDirty / detectAuditScope dirty", () => {
  it("gitDirty 有未提交改动返回 true", () => {
    const exec = (cmd) => (cmd.includes("status --porcelain") ? " M a.js\n" : "");
    assert.equal(gitDirty("/repo", exec), true);
  });

  it("gitDirty 干净返回 false", () => {
    const exec = (cmd) => (cmd.includes("status --porcelain") ? "" : "");
    assert.equal(gitDirty("/repo", exec), false);
  });

  it("gitDirty git 失败返回 false", () => {
    const exec = () => { throw new Error("not git"); };
    assert.equal(gitDirty("/repo", exec), false);
  });

  it("detectAuditScope 返回 dirty 字段", async () => {
    const p = await (async () => {
      const dir = await mkdtemp(join(tmpdir(), "baseline-"));
      return join(dir, "b.json");
    })();
    await saveBaseline("/proj", { commit: "abc123def456" }, p);
    const exec = (cmd) => {
      if (cmd.includes("rev-parse")) return "def456abc789\n";
      if (cmd.includes("status --porcelain")) return " M x.js\n";
      if (cmd.includes("diff --name-only")) return "";
      return "";
    };
    const r = await detectAuditScope("/proj", { cwd: "/repo", exec, path: p });
    assert.equal(r.dirty, true, "应返回 dirty=true");
  });
});
