const DEPTH_INSTRUCTIONS = {
  deep: "examine every line, report all issues, no detail too small",
  standard: "focus on common error patterns and main logic paths",
  light: "quick scan, only obvious problems",
};

const CAPABILITY_LABELS = {
  security: "Security & Vulnerabilities — injection risks, data leaks, auth flaws",
  logic: "Logic & Correctness — bugs, edge cases, race conditions",
  code_quality: "Code Quality & Architecture — maintainability, patterns, duplication",
  style: "Style & Conventions — naming, formatting, readability",
};

export function buildPrompt(weightsConfig, model) {
  const models = weightsConfig?.models;
  if (!models || !models[model]) {
    throw new Error(`Unknown model: "${model}"`);
  }

  const caps = models[model];
  const tiers = groupByTier(caps);

  let prompt = `You have 100 units of review effort. Allocate them as follows:\n\n`;

  for (const tier of ["deep", "standard", "light"]) {
    const items = tiers[tier];
    if (!items || items.length === 0) continue;

    const instruction = DEPTH_INSTRUCTIONS[tier];
    prompt += `${tier.toUpperCase()} (${instruction}):\n`;
    for (const item of items) {
      const units = Math.round(item.weight * 100);
      prompt += `  ${units} units → ${CAPABILITY_LABELS[item.name] || item.name}\n`;
    }
    prompt += "\n";
  }

  prompt += "Output ONLY a valid JSON object (no markdown, no explanation):\n";
  prompt += '{ "severity": "high/medium/low", "issues": [{ "file": "path", "line": 1, "finding": "desc", "fix": "suggestion", "focus": "security/logic/code_quality/style" }], "summary": "overall assessment" }';

  return prompt;
}

function groupByTier(caps) {
  const tiers = { deep: [], standard: [], light: [] };

  for (const [name, settings] of Object.entries(caps)) {
    if (!tiers[settings.depth]) continue;
    tiers[settings.depth].push({ name, weight: settings.weight });
  }

  for (const tier of Object.values(tiers)) {
    tier.sort((a, b) => b.weight - a.weight);
  }

  return tiers;
}

export async function cli(args = process.argv.slice(2)) {
  const modelIdx = args.indexOf("--model");
  if (modelIdx === -1) {
    console.error("Usage: node prompt-builder.mjs --model <model>");
    return 1;
  }

  const model = args[modelIdx + 1];
  if (!model) {
    console.error("--model requires a model name");
    return 1;
  }

  try {
    const { readFile } = await import("node:fs/promises");
    const { resolve, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const weightsPath = resolve(__dirname, "weights.json");
    const raw = await readFile(weightsPath, "utf-8");
    const weights = JSON.parse(raw);

    const prompt = buildPrompt(weights, model);
    process.stdout.write(prompt);
    return 0;
  } catch (err) {
    console.error(err.message);
    return 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  cli().then((code) => { process.exitCode = code; });
}
