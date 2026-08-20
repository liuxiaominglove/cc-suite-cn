export const WORKERS = [
  { backend: "codebuddy", model: "glm-5.2" },
  { backend: "codebuddy", model: "hy3" },
  { backend: "kimi", model: "kimi-k2.7-code" },
  { backend: "qwen", model: "qwen3-coder-plus" },
];

export const FIND_BUG_WORKERS = [
  { backend: "codebuddy", model: "glm-5.2" },
  { backend: "kimi", model: "kimi-k2.7-code" },
];

// 复审（/verify 只审 diff）专用评审员：大 payload 复审绕开 codebuddy 平台限流单点，
// 改用 DashScope（qwen，全沙箱）+ Moonshot（kimi）两条独立额度渠道。
export const VERIFY_WORKERS = [
  { backend: "qwen", model: "qwen3-coder-plus" },
  { backend: "kimi", model: "kimi-k2.7-code" },
];

export const CRITIC_MODEL = "qwen3-coder-plus";

export const VERIFIER_MODEL = "hy3";

export const MODEL_ALIASES = {
  "custom-local:qwen-coder-plus": "qwen3-coder-plus",
  "qwen-coder-plus": "qwen3-coder-plus",
};

export function canonicalModel(id) {
  return MODEL_ALIASES[id] ?? id;
}

export function isWorkerModel(id) {
  return WORKERS.some((w) => w.model === id);
}
