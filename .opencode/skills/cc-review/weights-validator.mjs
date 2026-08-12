const VALID_DEPTHS = new Set(["deep", "standard", "light"]);

const REQUIRED_CAPABILITIES = new Set([
  "security",
  "logic",
  "code_quality",
  "style",
]);

export function validateWeights(config) {
  const errors = [];

  if (!config || typeof config !== "object") {
    errors.push("config must be an object");
    return { valid: false, errors: errors };
  }

  if (!config.models || typeof config.models !== "object" || Object.keys(config.models).length === 0) {
    errors.push("missing or empty models");
    return { valid: false, errors: errors };
  }

  for (const [modelId, caps] of Object.entries(config.models)) {
    if (!caps || typeof caps !== "object" || Object.keys(caps).length === 0) {
      errors.push(`model "${modelId}" has no capabilities`);
      continue;
    }

    for (const [cap, settings] of Object.entries(caps)) {
      if (!REQUIRED_CAPABILITIES.has(cap)) {
        errors.push(`model "${modelId}": unknown capability "${cap}"`);
        continue;
      }

      if (!settings || typeof settings !== "object") {
        errors.push(`model "${modelId}" capability "${cap}": invalid settings`);
        continue;
      }

      if (!VALID_DEPTHS.has(settings.depth)) {
        errors.push(`model "${modelId}" capability "${cap}": invalid depth "${settings.depth}"`);
      }

      if (typeof settings.weight !== "number" || !Number.isFinite(settings.weight) || settings.weight < 0 || settings.weight > 1) {
        errors.push(`model "${modelId}" capability "${cap}": weight must be between 0 and 1, got ${settings.weight}`);
      }
    }

    for (const required of REQUIRED_CAPABILITIES) {
      if (!caps[required]) {
        errors.push(`model "${modelId}": missing required capability "${required}"`);
      }
    }
  }

  return { valid: errors.length === 0, errors: errors };
}
