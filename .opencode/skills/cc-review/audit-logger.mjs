export function appendAuditEntry(log, entry) {
  if (!entry || !entry.timestamp) {
    throw new Error("entry must have a timestamp");
  }
  if (Number.isNaN(Date.parse(entry.timestamp))) {
    throw new Error("entry timestamp is invalid");
  }
  return [...log, entry];
}

export function fromReviewResult(reviewResult, file) {
  return {
    timestamp: new Date().toISOString(),
    model: reviewResult.model,
    file,
    success: reviewResult.success ?? false,
    severity: reviewResult.severity ?? "unknown",
    issues: (reviewResult.issues || []).map((i) => ({
      finding: i.finding || "",
      fix: i.fix || "",
      focus: i.focus || "uncategorized",
      file: i.file || file,
      line: i.line ?? null,
    })),
    summary: reviewResult.summary || "",
  };
}

export function computeStats(log) {
  if (log.length === 0) {
    return { total_runs: 0, total_issues: 0, models: {} };
  }

  const models = {};

  let totalIssues = 0;
  let totalRuns = 0;

  for (const entry of log) {
    const model = entry.model;
    if (!model) continue;

    totalRuns++;

    if (!models[model]) {
      models[model] = { total_issues: 0, runs: 0, by_focus: {} };
    }

    models[model].runs++;
    const count = Array.isArray(entry.issues) ? entry.issues.length : 0;
    models[model].total_issues += count;
    totalIssues += count;

    if (Array.isArray(entry.issues)) {
      for (const issue of entry.issues) {
        const focus = issue.focus || "uncategorized";
        models[model].by_focus[focus] = (models[model].by_focus[focus] || 0) + 1;
      }
    }
  }

  for (const m of Object.values(models)) {
    m.avg_issues_per_run = m.runs > 0 ? m.total_issues / m.runs : 0;
  }

  return { total_runs: totalRuns, total_issues: totalIssues, models };
}
