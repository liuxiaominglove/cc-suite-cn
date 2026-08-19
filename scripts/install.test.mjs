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
      assert.ok(r.stdout.includes("hooksPath"), "--dry-run 应打印 commit 复审门禁（core.hooksPath）配置提示");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--write-key 哨兵块包裹 + 幂等：重复写不产生重复块", () => {
    const dir = mkdtempSync(join(tmpdir(), "ccsuite-install-"));
    const rc = join(dir, "rc");
    try {
      writeFileSync(rc, "");
      const env = { CC_RC_FILE: rc, HOME: dir };
      const r1 = bash(["--write-key", "DASHSCOPE_API_KEY=abc123"], env);
      assert.equal(r1.status, 0, r1.stderr);
      const r2 = bash(["--write-key", "DASHSCOPE_API_KEY=abc123"], env);
      assert.equal(r2.status, 0, r2.stderr);
      const content = readFileSync(rc, "utf8");
      const exports = content.split("\n").filter((l) => l.startsWith("export DASHSCOPE_API_KEY="));
      assert.equal(exports.length, 1, "重复写应保持 1 个 export");
      assert.match(content, /# cc-suite-cn:managed:begin/);
      assert.match(content, /# cc-suite-cn:managed:end/);
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
      const r = bash(["--write-key", "DASHSCOPE_API_KEY=sk-abc/def+ghi="], { CC_RC_FILE: rc, HOME: dir });
      assert.equal(r.status, 0, r.stderr);
      assert.match(readFileSync(rc, "utf8"), /^export DASHSCOPE_API_KEY='sk-abc\/def\+ghi='$/m);
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

  it("--uninstall 只删哨兵块，保留手动条目（负向）", () => {
    const dir = mkdtempSync(join(tmpdir(), "ccsuite-install-"));
    const rc = join(dir, "rc");
    try {
      writeFileSync(rc, "export MY_OWN_KEY='mine'\n");
      const env = { CC_RC_FILE: rc, HOME: dir };
      const r1 = bash(["--write-key", "DASHSCOPE_API_KEY=abc123"], env);
      assert.equal(r1.status, 0, r1.stderr);
      const r2 = bash(["--uninstall"], env);
      assert.equal(r2.status, 0, r2.stderr);
      const content = readFileSync(rc, "utf8");
      assert.ok(content.includes("export MY_OWN_KEY='mine'"), "手动条目应保留");
      assert.ok(!content.includes("DASHSCOPE_API_KEY"), "managed key 应被删除");
      assert.ok(!content.includes("managed:begin"), "哨兵块 marker 应删除");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("写 key 后 provenance sidecar 记录 managed key", () => {
    const dir = mkdtempSync(join(tmpdir(), "ccsuite-install-"));
    const rc = join(dir, "rc");
    const prov = join(dir, "prov");
    try {
      writeFileSync(rc, "");
      const env = { CC_RC_FILE: rc, HOME: dir, CC_PROVENANCE_FILE: prov };
      const r = bash(["--write-key", "DASHSCOPE_API_KEY=abc123"], env);
      assert.equal(r.status, 0, r.stderr);
      assert.ok(existsSync(prov), "应创建 provenance sidecar");
      assert.match(readFileSync(prov, "utf8"), /DASHSCOPE_API_KEY/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--uninstall 删除 provenance sidecar", () => {
    const dir = mkdtempSync(join(tmpdir(), "ccsuite-install-"));
    const rc = join(dir, "rc");
    const prov = join(dir, "prov");
    try {
      writeFileSync(rc, "");
      const env = { CC_RC_FILE: rc, HOME: dir, CC_PROVENANCE_FILE: prov };
      const r1 = bash(["--write-key", "DASHSCOPE_API_KEY=abc123"], env);
      assert.equal(r1.status, 0, r1.stderr);
      assert.ok(existsSync(prov), "写 key 后应有 provenance");
      const r2 = bash(["--uninstall"], env);
      assert.equal(r2.status, 0, r2.stderr);
      assert.ok(!existsSync(prov), "--uninstall 后 provenance 应删除");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
