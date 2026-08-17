import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BOUNDARY_INVARIANTS } from "./delegation-boundary.mjs";
import { READ_ONLY_DECLARATION } from "./backends.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const AGENT_FILES = ["glm", "kimi", "qwen", "hy3"].map((n) => join(ROOT, ".opencode", "agents", `${n}.md`));

describe("delegation-boundary", () => {
  it("两条不变量逐字出现在 4 个 B 分身 agent 文件里", () => {
    for (const p of AGENT_FILES) {
      const c = readFileSync(p, "utf8");
      for (const inv of BOUNDARY_INVARIANTS) {
        assert.ok(c.includes(inv), `${p} 缺不变量: ${inv}`);
      }
    }
  });

  it("READ_ONLY_DECLARATION 含边界（施工队统一纪律）", () => {
    assert.ok(READ_ONLY_DECLARATION.includes(BOUNDARY_INVARIANTS[0]), "缺不变量 1");
    assert.ok(READ_ONLY_DECLARATION.includes(BOUNDARY_INVARIANTS[1]), "缺不变量 2");
  });
});
