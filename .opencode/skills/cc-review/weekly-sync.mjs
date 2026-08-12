const BENCHMARK_MAP = {
  security: "security_score",
  logic: "swe_bench",
  code_quality: "swe_bench",
  style: "swe_bench",
};

const MAX_ADJUST_PER_SYNC = 0.15;
const MIN_WEIGHT = 0.1;
const MAX_WEIGHT = 1.0;

export function adjustWeightsFromBenchmarks(weights, current, previous) {
  if (!current || Object.keys(current).length === 0) {
    return { stale: true, suggestions: [], current: current || {} };
  }

  if (!previous) {
    return { first_run: true, suggestions: [], current };
  }

  const suggestions = [];

  for (const [modelId, caps] of Object.entries(weights.models)) {
    const cur = current[modelId];
    const prev = previous[modelId];
    if (!cur || !prev) continue;

    for (const [capName, capSettings] of Object.entries(caps)) {
      const benchKey = BENCHMARK_MAP[capName];
      if (!benchKey) continue;

      const curScore = cur[benchKey];
      const prevScore = prev[benchKey];
      if (typeof curScore !== "number" || typeof prevScore !== "number") continue;

      const delta = curScore - prevScore;
      if (Math.abs(delta) < 3) continue;

      const direction = delta > 0 ? "up" : "down";
      const ratio = delta / Math.max(prevScore, 1);
      const step = Math.min(Math.abs(ratio) * 0.3, MAX_ADJUST_PER_SYNC);

      let newWeight = direction === "up"
        ? capSettings.weight + step
        : capSettings.weight - step;

      newWeight = Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, parseFloat(newWeight.toFixed(2))));

      if (newWeight === capSettings.weight) continue;

      suggestions.push({
        model: modelId,
        capability: capName,
        old_weight: capSettings.weight,
        new_weight: newWeight,
        direction,
        reason: `${benchKey}: ${prevScore} → ${curScore} (${delta > 0 ? "+" : ""}${delta})`,
      });
    }
  }

  return { suggestions, current };
}

export async function fetchBenchmark(fetcher, model) {
  if (!fetcher) {
    throw new Error("fetcher function is required");
  }
  return fetcher(model);
}
