import { implement } from "../implement-runner.mjs";
import { buildBridgeConfig } from "../bridge-config.mjs";
import { readCallbacks } from "../opencode-mcp-bridge.mjs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let pass = 0;
let fail = 0;
const check = (name, cond) => {
  if (cond) {
    console.log(`PASS ${name}`);
    pass += 1;
  } else {
    console.log(`FAIL ${name}`);
    fail += 1;
  }
};

const MODEL = "glm-5.2";
const TASK =
  "这是自动化测试。请务必调用 delegate_to_opencode 工具，其 task 参数填：'请只回复数字 42，不要任何其他文字'。拿到工具返回的文本后，把你得到的数字作为最终答案输出（只输出数字，不要多余解释）。";

// Positive: 桥闸门打开 → 真实双向往返
const dir = await mkdtemp(join(tmpdir(), "verify-bridge-"));
const bridgeConfig = join(dir, "bridge.json");
const callbackLog = join(dir, "callbacks.jsonl");
await writeFile(bridgeConfig, JSON.stringify(buildBridgeConfig({ gate: "open", maxCallbacks: 5, callbackLog })));

const r = await implement({ model: MODEL, task: TASK, timeout: 300000, bridge: true, bridgeConfig, callbackLog });

check("bridge roundtrip succeeds", r.success === true);
check("at least one callback occurred", r.callbackCount >= 1);

const callbacks = await readCallbacks(callbackLog);
check(
  "callback log has a real non-empty task",
  callbacks.length >= 1 && typeof callbacks[0]?.task === "string" && callbacks[0].task.length > 0
);
check("opencode answer 42 relayed back to codebuddy output", String(r.output).includes("42"));

console.log(`  (output): ${String(r.output).slice(0, 200).replace(/\n/g, " ")}`);
await rm(dir, { recursive: true, force: true });

// Negative: 桥闸门关闭 → 回调被拦截
const dir2 = await mkdtemp(join(tmpdir(), "verify-bridge-closed-"));
const bridgeConfig2 = join(dir2, "bridge.json");
const callbackLog2 = join(dir2, "callbacks.jsonl");
await writeFile(bridgeConfig2, JSON.stringify(buildBridgeConfig({ gate: "closed", maxCallbacks: 5, callbackLog: callbackLog2 })));

const r2 = await implement({ model: MODEL, task: TASK, timeout: 300000, bridge: true, bridgeConfig: bridgeConfig2, callbackLog: callbackLog2 });

check("gate closed blocks callbacks (callbackCount=0)", r2.callbackCount === 0);
await rm(dir2, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
