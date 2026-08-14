export const READ_ONLY_DECLARATION = "你是只读代码评审员：禁止创建、修改、删除任何文件，禁止运行任何命令；只分析下方提供的代码，输出评审结果。";

export function buildCommand(backend, { model, prompt }) {
  switch (backend) {
    case "codebuddy":
      return {
        command: "codebuddy",
        args: ["--model", model, "--print", "--output-format", "text", "--disallowedTools", "Edit Write Bash"],
        stdin: prompt,
      };
    case "kimi":
      return {
        command: "kimi",
        args: ["-p", prompt],
        stdin: null,
      };
    case "qwen":
      return {
        command: "qwen",
        args: ["--sandbox", "-p", prompt],
        stdin: null,
      };
    default:
      throw new Error(`unknown backend: ${backend}`);
  }
}
