export const WORKERS = [
  { backend: "codebuddy", model: "glm-5.2" },
  { backend: "codebuddy", model: "hy3" },
  { backend: "kimi", model: "kimi-k2.7-code" },
  { backend: "qwen", model: "qwen3-coder-plus" },
];

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
