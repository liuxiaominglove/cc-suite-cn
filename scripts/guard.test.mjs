import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { findDuplicateCopies, findMissingCanonical, findStaleReferences, runGuard, findDeadReferences, COPY_LOCATIONS, CANONICAL_FILES, STALE_GLOBAL_PATHS } from "./guard.mjs";

function fakeExists(present) {
  return (p) => present.has(p);
}

function fakeRead(map) {
  return (f) => (map[f] ?? "");
}

describe("findDuplicateCopies", () => {
  it("returns [] when no copies exist", () => {
    const exists = fakeExists(new Set());
    assert.deepEqual(findDuplicateCopies(COPY_LOCATIONS, exists), []);
  });

  it("detects a runner copy", () => {
    const exists = fakeExists(new Set([COPY_LOCATIONS[0]]));
    assert.deepEqual(findDuplicateCopies(COPY_LOCATIONS, exists), [COPY_LOCATIONS[0]]);
  });

  it("detects an audit-log copy", () => {
    const exists = fakeExists(new Set([COPY_LOCATIONS[1]]));
    assert.deepEqual(findDuplicateCopies(COPY_LOCATIONS, exists), [COPY_LOCATIONS[1]]);
  });

  it("detects a SKILL copy", () => {
    const exists = fakeExists(new Set([COPY_LOCATIONS[2]]));
    assert.deepEqual(findDuplicateCopies(COPY_LOCATIONS, exists), [COPY_LOCATIONS[2]]);
  });

  it("COPY_LOCATIONS targets the global ~/.config/opencode copies", () => {
    assert.ok(COPY_LOCATIONS.some((p) => p.endsWith(".config/opencode/scripts/cc-review/review-runner.mjs")));
    assert.ok(COPY_LOCATIONS.some((p) => p.endsWith(".config/opencode/scripts/cc-review/audit-log.json")));
    assert.ok(COPY_LOCATIONS.some((p) => p.endsWith(".config/opencode/skills/cc-review/SKILL.md")));
  });
});

describe("findMissingCanonical", () => {
  it("returns [] when all canonical files present", () => {
    const present = new Set(CANONICAL_FILES.map((rel) => `/repo/${rel}`));
    const exists = fakeExists(present);
    assert.deepEqual(findMissingCanonical(CANONICAL_FILES, exists, "/repo"), []);
  });

  it("reports a missing canonical file", () => {
    const present = new Set(["/repo/scripts/review-runner.mjs"]);
    const exists = fakeExists(present);
    const missing = findMissingCanonical(CANONICAL_FILES, exists, "/repo");
    assert.ok(missing.includes(".opencode/skills/cc-review/SKILL.md"));
  });
});

describe("findStaleReferences", () => {
  it("returns [] when references are clean", () => {
    const read = fakeRead({
      "audit.md": "/repo/scripts/review-runner.mjs",
      "opencode.jsonc": "/repo/.opencode/skills/cc-review",
    });
    assert.deepEqual(findStaleReferences(["audit.md", "opencode.jsonc"], read), []);
  });

  it("detects a stale scripts path in audit.md", () => {
    const read = fakeRead({ "audit.md": "~/.config/opencode/scripts/cc-review/review-runner.mjs" });
    const problems = findStaleReferences(["audit.md", "opencode.jsonc"], read);
    assert.equal(problems.length, 1);
    assert.ok(problems[0].includes("audit.md"));
    assert.ok(problems[0].includes(STALE_GLOBAL_PATHS[0]));
  });

  it("detects a stale skill path in opencode.jsonc", () => {
    const read = fakeRead({ "opencode.jsonc": '"~/.config/opencode/skills/cc-review"' });
    const problems = findStaleReferences(["audit.md", "opencode.jsonc"], read);
    assert.equal(problems.length, 1);
    assert.ok(problems[0].includes("opencode.jsonc"));
  });

  it("skips missing reference files instead of crashing", () => {
    const read = (f) => { throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); };
    const problems = findStaleReferences(["audit.md", "opencode.jsonc"], read);
    assert.deepEqual(problems, []);
  });
});

describe("runGuard", () => {
  it("returns no problems for a clean state", () => {
    const present = new Set(CANONICAL_FILES.map((rel) => `/repo/${rel}`));
    const exists = fakeExists(present);
    const read = fakeRead({});
    const { dupes, missing, staleRefs } = runGuard({
      copies: [],
      canonicals: CANONICAL_FILES,
      refFiles: ["audit.md", "opencode.jsonc"],
      exists,
      read,
      root: "/repo",
    });
    assert.deepEqual(dupes, []);
    assert.deepEqual(missing, []);
    assert.deepEqual(staleRefs, []);
  });

  it("returns duplicate, missing, and stale problems together", () => {
    const present = new Set(["/repo/scripts/review-runner.mjs", COPY_LOCATIONS[1]]);
    const exists = fakeExists(present);
    const read = fakeRead({ "audit.md": "~/.config/opencode/scripts/cc-review/audit-log.json" });
    const { dupes, missing, staleRefs } = runGuard({
      copies: COPY_LOCATIONS,
      canonicals: CANONICAL_FILES,
      refFiles: ["audit.md", "opencode.jsonc"],
      exists,
      read,
      root: "/repo",
    });
    assert.deepEqual(dupes, [COPY_LOCATIONS[1]]);
    assert.ok(missing.includes(".opencode/skills/cc-review/SKILL.md"));
    assert.equal(staleRefs.length, 1);
  });
});

describe("findDeadReferences", () => {
  it("returns [] when SKILL.md only references existing files", () => {
    const read = fakeRead({ "/repo/.opencode/skills/cc-review/SKILL.md": "uses review-runner.mjs and evaluate-models.mjs" });
    const exists = fakeExists(new Set(["/repo/scripts/review-runner.mjs", "/repo/scripts/evaluate-models.mjs"]));
    const problems = findDeadReferences([".opencode/skills/cc-review/SKILL.md"], { read, exists, root: "/repo" });
    assert.deepEqual(problems, []);
  });

  it("reports references to nonexistent files", () => {
    const read = fakeRead({ "/repo/.opencode/skills/cc-review/SKILL.md": "uses weight-analyzer.mjs and weights.json" });
    const exists = fakeExists(new Set());
    const problems = findDeadReferences([".opencode/skills/cc-review/SKILL.md"], { read, exists, root: "/repo" });
    assert.equal(problems.length, 2);
    assert.ok(problems.some((p) => p.includes("weight-analyzer.mjs")));
    assert.ok(problems.some((p) => p.includes("weights.json")));
  });
});
