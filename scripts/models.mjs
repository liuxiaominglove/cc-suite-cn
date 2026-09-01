export const WORKERS = [
  { backend: "codebuddy", model: "glm-5.3" },
  { backend: "codebuddy", model: "hy4-preview" },
  { backend: "kimi", model: "kimi-k3" },
  { backend: "qwen", model: "qwen3.8-max" },
];

export const FIND_BUG_WORKERS = [
  { backend: "codebuddy", model: "glm-5.3" },
  { backend: "kimi", model: "kimi-k3" },
];

// 复审（/verify 只审 diff）专用评审员：大 payload 复审绕开 codebuddy 平台限流单点，
// 改用 DashScope（qwen，全沙箱）+ Moonshot（kimi）两条独立额度渠道。
export const VERIFY_WORKERS = [
  { backend: "qwen", model: "qwen3.8-max" },
  { backend: "kimi", model: "kimi-k3" },
];

export const CRITIC_MODEL = "qwen3.8-max";

export const VERIFIER_MODEL = "hy4-preview";

export const MODEL_ALIASES = {
  "custom-local:qwen-coder-plus": "qwen3.8-max",
  "qwen-coder-plus": "qwen3.8-max",
};

export function canonicalModel(id) {
  return MODEL_ALIASES[id] ?? id;
}

export function isWorkerModel(id) {
  return WORKERS.some((w) => w.model === id);
}
