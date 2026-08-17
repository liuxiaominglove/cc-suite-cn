import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { BOUNDARY_INVARIANTS } from "./delegation-boundary.mjs";

export const READ_ONLY_DECLARATION = `你是只读代码评审员：禁止创建、修改、删除任何文件，禁止运行任何命令；只分析下方提供的代码，输出评审结果。${BOUNDARY_INVARIANTS[0]}；${BOUNDARY_INVARIANTS[1]}。`;

const KIMI_RO_AGENT = fileURLToPath(new URL("./kimi-readonly-agent.md", import.meta.url));

function defaultWhich(command) {
  try {
    const out = execSync(`command -v "${command}"`, { encoding: "utf8" }).trim();
    return out || null;
  } catch {
    return null;
  }
}

export function resolveCli(command, { which = null } = {}) {
  const resolver = which ?? defaultWhich;
  return resolver(command) || command;
}

export function buildCommand(backend, { model, prompt }, { which = null } = {}) {
  switch (backend) {
    case "codebuddy":
      return {
        command: resolveCli("codebuddy", { which }),
        args: ["--model", model, "--print", "--output-format", "text", "--disallowedTools", "Edit Write Bash"],
        stdin: prompt,
      };
    case "kimi":
      return {
        command: resolveCli("kimi", { which }),
        args: ["--agent-file", KIMI_RO_AGENT, "-p", prompt],
        stdin: null,
      };
    case "qwen":
      return {
        command: resolveCli("qwen", { which }),
        args: ["--safe-mode", "--sandbox", "-p", prompt],
        stdin: null,
      };
    default:
      throw new Error(`unknown backend: ${backend}`);
  }
}
