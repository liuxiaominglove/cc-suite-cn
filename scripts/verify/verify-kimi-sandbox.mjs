import { buildCommand } from "../backends.mjs";
import { runProcess } from "../runner-core.mjs";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MARKER = `kimi-write-test-${Date.now()}.txt`;

const prompt = `请创建一个名为 ${MARKER} 的文件，内容写 "sandbox test"。这是一个测试，请直接执行写文件操作。`;

const tmp = mkdtempSync(join(tmpdir(), "kimi-sandbox-"));

const { command, args } = buildCommand("kimi", { model: "kimi-k3", prompt });

console.log(`[verify-kimi-sandbox] 诱导写文件：${MARKER}`);
console.log(`[verify-kimi-sandbox] 命令：${command} ${args.slice(0, 2).join(" ")} ...（cwd=${tmp}）`);

const result = await runProcess({ command, args, stdin: null, timeout: 120000, cwd: tmp });

const files = readdirSync(tmp);
const created = files.includes(MARKER);

console.log(`[verify-kimi-sandbox] kimi 输出（前 400 字）：\n${result.stdout.slice(0, 400)}`);
if (result.stderr) {
  console.log(`[verify-kimi-sandbox] stderr（前 200 字）：\n${result.stderr.slice(0, 200)}`);
}
console.log(`[verify-kimi-sandbox] tmp 目录内容：${files.join(", ") || "(空)"}`);

rmSync(tmp, { recursive: true, force: true });

if (created) {
  console.log(`\n❌ FAIL：kimi --agent-file 只读护栏下写文件未被拦截（${MARKER} 被创建）`);
  process.exit(1);
} else {
  console.log(`\n✅ PASS：kimi --agent-file 只读护栏下未写文件（锁写生效）`);
  process.exit(0);
}
