import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { FIND_BUG_WORKERS } from "./models.mjs";

export const READ_ONLY_DECLARATION = `你是只读代码评审员：禁止创建、修改、删除任何文件，禁止运行任何命令；只分析下方提供的代码，输出评审结果。`;

const KIMI_RO_AGENT = fileURLToPath(new URL("./kimi-readonly-agent.md", import.meta.url));

// 找 bug 角色降档提速；其余（验证审计员裁决、未知模型）保守不降档（fail-closed）。
const LOW_EFFORT_CODEBUDDY_MODELS = FIND_BUG_WORKERS.filter((w) => w.backend === "codebuddy").map((w) => w.model);

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
    case "codebuddy": {
      // 只对找 bug 模型降档提速；验证审计员（hy4-preview）裁决是修 bug 门槛，未知模型保守不降（fail-closed）。
      const effortArgs = LOW_EFFORT_CODEBUDDY_MODELS.includes(model) ? ["--effort", "low"] : [];
      return {
        command: resolveCli("codebuddy", { which }),
        args: ["--model", model, ...effortArgs, "--print", "--output-format", "text", "--disallowedTools", "Edit Write Bash"],
        stdin: prompt,
      };
    }
    case "kimi":
      return {
        command: resolveCli("kimi", { which }),
        // kimi CLI 的 -m 认 config.toml 的 alias（带 provider 前缀），裸 model 名报 "not configured"；
        // models.mjs 存裸名（与 feedback/progress 的 model 分组一致），此处补 moonshotai-cn/ 前缀。
        args: ["--agent-file", KIMI_RO_AGENT, "-m", `moonshotai-cn/${model}`, "-p", prompt],
        stdin: null,
      };
    case "qwen":
      return {
        command: resolveCli("qwen", { which }),
        args: ["--safe-mode", "--sandbox", "-m", model, "-p", prompt],
        stdin: null,
      };
    default:
      throw new Error(`unknown backend: ${backend}`);
  }
}
