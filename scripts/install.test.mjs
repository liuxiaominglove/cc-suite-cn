import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const INSTALL = join(ROOT, "install.sh");

function bash(args, env = {}) {
  return spawnSync("bash", ["-c", `"$0" "$@"`, INSTALL, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

function envWithoutKeys(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.DASHSCOPE_API_KEY;
  delete env.MOONSHOT_API_KEY;
  delete env.TOKENHUB_API_KEY;
  return env;
}

describe("install.sh", () => {
  it("bash -n 语法检查通过", () => {
    const r = spawnSync("bash", ["-n", INSTALL], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
  });

  it("--dry-run 退出 0 且不创建 rc 文件（负向）", () => {
    const dir = mkdtempSync(join(tmpdir(), "ccsuite-install-"));
    const rc = join(dir, "rc");
    try {
      const r = bash(["--dry-run"], { CC_RC_FILE: rc, HOME: dir });
      assert.equal(r.status, 0, r.stderr);
      assert.ok(!existsSync(rc), "--dry-run 不应创建 rc 文件");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--write-key 幂等：重复写不产生重复行", () => {
    const dir = mkdtempSync(join(tmpdir(), "ccsuite-install-"));
    const rc = join(dir, "rc");
    try {
      writeFileSync(rc, "");
      const env = { CC_RC_FILE: rc, HOME: dir };
      const r1 = bash(["--write-key", "DASHSCOPE_API_KEY=abc123"], env);
      assert.equal(r1.status, 0, r1.stderr);
      const r2 = bash(["--write-key", "DASHSCOPE_API_KEY=abc123"], env);
      assert.equal(r2.status, 0, r2.stderr);
      const lines = readFileSync(rc, "utf8").trim().split("\n").filter(Boolean);
      assert.equal(lines.length, 1, "重复写应保持 1 行");
      assert.match(lines[0], /^export DASHSCOPE_API_KEY='abc123'$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--write-key 拒绝含空格的非法 key 值（负向）", () => {
    const dir = mkdtempSync(join(tmpdir(), "ccsuite-install-"));
    const rc = join(dir, "rc");
    try {
      writeFileSync(rc, "");
      const r = bash(["--write-key", "DASHSCOPE_API_KEY=bad key!"], { CC_RC_FILE: rc, HOME: dir });
      assert.notEqual(r.status, 0, "非法 key 值应非 0 退出");
      assert.equal(readFileSync(rc, "utf8").trim(), "", "非法 key 值不应写入 rc");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--help 退出 0 且列出用法", () => {
    const r = bash(["--help"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /用法:/);
    assert.match(r.stdout, /--dry-run/);
  });

  it("--write-key 接受含 /+= 的 base64 风格 key", () => {
    const dir = mkdtempSync(join(tmpdir(), "ccsuite-install-"));
    const rc = join(dir, "rc");
    try {
      writeFileSync(rc, "");
      const r = bash(["--write-key", "TOKENHUB_API_KEY=sk-abc/def+ghi="], { CC_RC_FILE: rc, HOME: dir });
      assert.equal(r.status, 0, r.stderr);
      assert.match(readFileSync(rc, "utf8"), /^export TOKENHUB_API_KEY='sk-abc\/def\+ghi='$/m);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--write-key 缺参数给出清晰报错而非 shift 错误", () => {
    const r = bash(["--write-key"]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr + r.stdout, /NAME=VALUE/);
  });

  it("--write-key 无 = 报错而非误写", () => {
    const dir = mkdtempSync(join(tmpdir(), "ccsuite-install-"));
    const rc = join(dir, "rc");
    try {
      writeFileSync(rc, "");
      const r = bash(["--write-key", "FOO"], { CC_RC_FILE: rc, HOME: dir });
      assert.notEqual(r.status, 0, "无 = 的 --write-key 应报错");
      assert.match(r.stderr + r.stdout, /NAME=VALUE/);
      assert.equal(readFileSync(rc, "utf8").trim(), "", "不应写入 export FOO");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--write-key 拒绝非法变量名（负向）", () => {
    const dir = mkdtempSync(join(tmpdir(), "ccsuite-install-"));
    const rc = join(dir, "rc");
    try {
      writeFileSync(rc, "");
      const r = bash(["--write-key", "1BAD=abc"], { CC_RC_FILE: rc, HOME: dir });
      assert.notEqual(r.status, 0, "非法变量名应报错");
      assert.equal(readFileSync(rc, "utf8").trim(), "", "非法变量名不应写入 rc");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("export_rc_keys 不执行 rc 里的命令替换（负向）", () => {
    const dir = mkdtempSync(join(tmpdir(), "ccsuite-install-"));
    const rc = join(dir, "rc");
    const pwned = join(dir, "pwned");
    try {
      writeFileSync(rc, `export EVIL=$(touch ${pwned})\nexport DASHSCOPE_API_KEY='abc123'\n`);
      const r = bash(["--dry-run"], envWithoutKeys({ CC_RC_FILE: rc, HOME: dir }));
      assert.equal(r.status, 0, r.stderr);
      assert.ok(!existsSync(pwned), "rc 里的 $(touch) 命令替换不应被执行");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
