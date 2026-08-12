const HIT_RATE_THRESHOLD = 0.65;
const MIN_SAMPLES = 5;
const MAX_ADJUST = 0.10;
const MIN_WEIGHT = 0.1;
const MAX_WEIGHT = 1.0;

export async function generateProposal(weights, auditLog) {
  const now = Date.now();
  const weekMs = 7 * 24 * 3600 * 1000;
  const recentEntries = auditLog.filter((e) => {
    if (!e.timestamp) return false;
    return now - new Date(e.timestamp).getTime() <= weekMs;
  });

  if (recentEntries.length === 0) {
    return { generated_at: new Date().toISOString(), needs_more_data: true, suggestions: [], period_total_runs: 0 };
  }

  const { computeStats } = await import("./audit-logger.mjs");
  const stats = computeStats(recentEntries);
  const rawSuggestions = suggestWeightAdjustments(weights, stats, { min_samples: MIN_SAMPLES, threshold: HIT_RATE_THRESHOLD });

  const suggestions = rawSuggestions.map((s) => {
    const modelStats = stats.models[s.model];
    const focusCount = modelStats?.by_focus?.[s.capability] ?? 0;
    return {
      ...s,
      evidence: {
        hit_count: focusCount,
        total_issues: modelStats?.total_issues ?? 0,
        hit_rate: modelStats?.total_issues ? parseFloat((focusCount / modelStats.total_issues).toFixed(2)) : 0,
        runs: modelStats?.runs ?? 0,
        threshold: HIT_RATE_THRESHOLD,
      },
    };
  });

  return {
    generated_at: new Date().toISOString(),
    needs_more_data: false,
    suggestions,
    period_total_runs: recentEntries.length,
  };
}

export function suggestWeightAdjustments(weights, stats, opts = {}) {
  const threshold = opts.threshold ?? HIT_RATE_THRESHOLD;
  const minSamples = opts.min_samples ?? MIN_SAMPLES;
  const suggestions = [];

  for (const [modelId, caps] of Object.entries(weights.models)) {
    const modelStats = stats.models?.[modelId];
    if (!modelStats || modelStats.runs < minSamples) continue;

    for (const [capName, capSettings] of Object.entries(caps)) {
      const focusCount = modelStats.by_focus?.[capName];
      if (focusCount === undefined) continue;
      const totalIssues = modelStats.total_issues;
      if (totalIssues === 0) continue;

      const hitRate = focusCount / totalIssues;
      if (Math.abs(hitRate - threshold) < 0.05) continue;

      const direction = hitRate > threshold ? "up" : "down";
      const rawAdjust = (hitRate - threshold) * MAX_ADJUST * 2;
      const step = Math.max(0.01, Math.min(Math.abs(rawAdjust), MAX_ADJUST));
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
        reason: `hit rate ${(hitRate * 100).toFixed(0)}% vs ${(threshold * 100).toFixed(0)}% threshold (${focusCount}/${totalIssues} issues)`,
      });
    }
  }
  return suggestions;
}

export function applyProposal(weights, approved) {
  const updated = JSON.parse(JSON.stringify(weights));
  let applied = 0;

  const allowedSet = new Set();
  if (updated.pending_proposal?.suggestions) {
    for (const s of updated.pending_proposal.suggestions) {
      allowedSet.add(`${s.model}::${s.capability}`);
    }
  }

  for (const item of approved) {
    const key = `${item.model}::${item.capability}`;
    if (allowedSet.size > 0 && !allowedSet.has(key)) continue;
    const cap = updated.models?.[item.model]?.[item.capability];
    if (!cap) continue;
    cap.weight = Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, parseFloat(item.new_weight.toFixed(2))));
    applied++;
  }

  if (applied > 0) {
    updated.last_adjusted = new Date().toISOString();
  }
  updated.pending_proposal = null;

  return { weights: updated, applied };
}

export function checkPending(weights) {
  const SEVEN_DAYS = 7 * 24 * 3600 * 1000;
  const now = Date.now();

  if (weights.pending_proposal) {
    const lastAdj = weights.last_adjusted ? new Date(weights.last_adjusted).getTime() : 0;
    const overdueDays = Math.floor((now - lastAdj) / (24 * 3600 * 1000));

    if (overdueDays >= 7) {
      return {
        needs_review: true,
        overdue_days: overdueDays,
        proposal: weights.pending_proposal,
      };
    }
    return { needs_review: false };
  }

  if (weights.last_adjusted) {
    const age = now - new Date(weights.last_adjusted).getTime();
    if (age > SEVEN_DAYS) {
      return { needs_review: false, stale: true };
    }
  }

  return { needs_review: false, stale: false };
}

export async function saveProposalToFile(proposal, filePath) {
  const { readFile, writeFile, rename } = await import("node:fs/promises");
  const { dirname, join } = await import("node:path");

  const raw = await readFile(filePath, "utf-8");
  const weights = JSON.parse(raw);
  weights.pending_proposal = {
    generated_at: proposal.generated_at,
    suggestions: proposal.suggestions,
    needs_more_data: proposal.needs_more_data || false,
  };

  const tmpPath = join(dirname(filePath), `.weights-${Date.now()}.tmp`);
  await writeFile(tmpPath, JSON.stringify(weights, null, 2) + "\n", "utf-8");
  await rename(tmpPath, filePath);

  return weights;
}

export async function loadWeights(filePath) {
  const { readFile } = await import("node:fs/promises");
  const raw = await readFile(filePath, "utf-8");
  return JSON.parse(raw);
}
