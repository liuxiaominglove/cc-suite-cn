import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitHead, gitChangedFiles, loadBaseline, saveBaseline, detectAuditScope, parseSaveArgs } from "./audit-baseline.mjs";

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
    const files = gitChangedFiles("c1", "/repo", exec);
    assert.deepEqual(files, ["src/a.js", "src/b.js", "new-file.js"]);
  });

  it("无变更返回空数组", () => {
    const exec = fakeExec((cmd) => "");
    assert.deepEqual(gitChangedFiles("c1", "/repo", exec), []);
  });

  it("git 命令失败返回空数组", () => {
    const exec = () => {
      throw new Error("git failed");
    };
    assert.deepEqual(gitChangedFiles("c1", "/repo", exec), []);
  });

  it("过滤空行和空白行", () => {
    const exec = fakeExec((cmd) => {
      if (cmd.includes("diff --name-only")) return "a.js\n\n  \nb.js\n";
      return "";
    });
    assert.deepEqual(gitChangedFiles("c1", "/repo", exec), ["a.js", "b.js"]);
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

  it("基线 != HEAD 返回变更文件", async () => {
    const p = await tmpPath();
    await saveBaseline("/proj", { commit: "c1" }, p);
    const exec = fakeExec((cmd) => {
      if (cmd.includes("rev-parse")) return "c2\n";
      if (cmd.includes("diff --name-only")) return "src/a.js\n";
      return "";
    });
    const r = await detectAuditScope("/proj", { cwd: "/repo", exec, path: p });
    assert.equal(r.changed, true);
    assert.equal(r.firstAudit, false);
    assert.deepEqual(r.files, ["src/a.js"]);
    assert.equal(r.baseCommit, "c1");
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
    const r = parseSaveArgs(["--save", "/p", "--commit", "abc123"]);
    assert.equal(r.project, "/p");
    assert.equal(r.commit, "abc123");
  });
});
