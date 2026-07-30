#!/usr/bin/env node
// Tests for converged.mjs — the §10 "write only on a real difference" rule.

import { converged, onlyAdoptionArtifactsMoved, ALWAYS_IGNORED, CONFIG_ALWAYS_IGNORED } from "./converged.mjs";

let n = 0, fails = 0;
function check(name, got, want) {
  n++;
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { fails++; console.error(`FAIL ${name}\n  got:  ${g}\n  want: ${w}`); }
}
const ok = (name, cond) => check(name, !!cond, true);

const base = () => ({
  profileVersion: 1,
  scan: {
    scannedAt: "2026-07-30T18:09:27Z",
    commit: { status: "known", value: "aaaa111", confidence: "high" },
    depth: "standard",
    budget: { filesInspected: 68, durationSeconds: 94 },
  },
  workspace: { roots: [{ name: "api", gates: [{ name: "lint", status: "present", cmd: "make lint" }] }] },
  drift: { baseline: { kind: "previous-profile", commit: "aaaa111" }, changes: [] },
});

// ---- the always-ignored fields ---------------------------------------------------------------
{
  const a = base(), b = base();
  b.scan.scannedAt = "2026-08-04T09:00:00Z";
  b.scan.budget.durationSeconds = 131;
  b.drift = { baseline: { kind: "previous-profile", commit: "bbbb222" }, changes: [{ kind: "gate-changed" }] };
  ok("a later timestamp, a different duration and a rewritten drift block alone are convergence",
    converged(a, b, []).converged);
}

// ---- scan.commit: the treadmill -----------------------------------------------------------------
{
  const a = base(), b = base();
  b.scan.commit.value = "bbbb222"; // the profile was committed, so HEAD moved
  check("HEAD moved by adoption artifacts only => converged, nothing written",
    converged(a, b, [".aidlc/adoption/profile.json", ".aidlc/adoption/report.md"]).converged, true);
  ok("...and the reason says why the commit difference is not drift",
    /touching \.aidlc\/adoption/.test(converged(a, b, [".aidlc/adoption/profile.json"]).reason));
  check("HEAD moved because real code changed => NOT converged, the commit must be re-recorded",
    converged(a, b, ["acme/billing/models.py"]).converged, false);
  check("...and the difference reported is the commit itself",
    converged(a, b, ["acme/billing/models.py"]).firstDifference, "scan.commit.value");
  check("a mixed changeset counts as real movement",
    converged(a, b, [".aidlc/adoption/profile.json", "Makefile"]).converged, false);
  check("unknown changed paths are treated conservatively: the commit stays in the comparison",
    converged(a, b, null).converged, false);
  ok("scan.commit is never unconditionally ignored", !ALWAYS_IGNORED.includes("scan.commit"));
}

// ---- a genuinely unchanged re-run ---------------------------------------------------------------
check("the same profile at the same commit is converged", converged(base(), base(), []).converged, true);
check("key order is not a difference",
  converged({ a: 1, b: 2 }, { b: 2, a: 1 }, []).converged, true);

// ---- real differences must always win -----------------------------------------------------------
{
  const a = base(), b = base();
  b.workspace.roots[0].gates[0].cmd = "make lint-all";
  const r = converged(a, b, [".aidlc/adoption/profile.json"]);
  check("a changed gate command is a real difference even when only adoption artifacts moved", r.converged, false);
  check("...and it is located precisely", r.firstDifference, "workspace.roots[0]".replace("[0]", ".0") + ".gates.0.cmd");
}
{
  const a = base(), b = base();
  b.scan.depth = "deep";
  check("a depth change is a difference: it turns unknowns into facts, so the profile must be rewritten",
    converged(a, b, []).converged, false);
}
{
  const a = base(), b = base();
  b.workspace.roots.push({ name: "web" });
  check("a new root is a real difference", converged(a, b, []).converged, false);
}
{
  const a = base(), b = base();
  delete b.workspace.roots[0].gates;
  check("a removed block is a real difference", converged(a, b, []).converged, false);
}

// ---- the path predicate on its own ----------------------------------------------------------------
ok("an empty changeset counts as adoption-only", onlyAdoptionArtifactsMoved([]));
ok("backslash paths are handled", onlyAdoptionArtifactsMoved([".aidlc\\adoption\\profile.json"]));
ok("a sibling .aidlc path is NOT adoption-only", !onlyAdoptionArtifactsMoved([".aidlc/runs/2026-07-30.md"]));
ok("a lookalike prefix does not pass", !onlyAdoptionArtifactsMoved([".aidlc/adoption-notes.md"]));
ok("null is not adoption-only", !onlyAdoptionArtifactsMoved(null));
ok("a missing existing profile is never convergence", !converged(null, base(), []).converged);

// ---- the config side (adopt-apply §3.5) ------------------------------------------------------
const cfg = () => ({
  configVersion: 1,
  project: { key: "PLAT", name: "Acme" },
  repos: [{ name: "api", path: "api" }],
  pipeline: { gates: { verify: { repos: { api: { steps: [{ name: "lint", status: "present", cmd: "make lint", required: true }] } } } } },
  adoption: {
    scannedAt: "2026-07-31T06:22:11Z",
    commit: "21cde66",
    appliedAt: "2026-07-31T07:04:00Z",
    writes: [
      { path: ".claude/aidlc.config.json", ownership: "created", at: "2026-07-31T07:04:00Z" },
      { path: "CLAUDE.md", ownership: "merged", sections: ["## Commands"], at: "2026-07-31T07:04:00Z" },
    ],
  },
});

{
  const a = cfg(), b = cfg();
  b.adoption.appliedAt = "2026-08-14T11:00:00Z";
  check("a re-apply that only advances appliedAt is converged",
    converged(a, b, null, "config").converged, true);
}
{
  // The live-run defect: the apply step REBUILDS writes[] every time, so each `at` is fresh.
  const a = cfg(), b = cfg();
  b.adoption.appliedAt = "2026-08-14T11:00:00Z";
  for (const w of b.adoption.writes) w.at = "2026-08-14T11:00:00Z";
  check("a re-apply that also regenerates every writes[].at is STILL converged",
    converged(a, b, null, "config").converged, true);
  ok("writes[].at is in the config ignore list", CONFIG_ALWAYS_IGNORED.includes("adoption.writes[].at"));
}
{
  const a = cfg(), b = cfg();
  b.adoption.writes.push({ path: ".claude/rules/git-workflow.md", ownership: "rendered", at: "2026-08-14T11:00:00Z" });
  check("a NEW writes[] entry is a real difference — adoption touched another file",
    converged(a, b, null, "config").converged, false);
}
{
  const a = cfg(), b = cfg();
  b.adoption.writes[1].sections = ["## Commands", "## Project facts"];
  check("a changed sections[] is a real difference — /aidlc:remove reads it",
    converged(a, b, null, "config").converged, false);
}
{
  const a = cfg(), b = cfg();
  b.pipeline.gates.verify.repos.api.steps[0].cmd = "make lint-all";
  const r = converged(a, b, null, "config");
  check("a changed gate command is a real difference", r.converged, false);
  check("...located precisely", r.firstDifference, "pipeline.gates.verify.repos.api.steps.0.cmd");
}
{
  const a = cfg(), b = cfg();
  b.adoption.scannedAt = "2026-09-01T00:00:00Z";
  check("a changed scannedAt IS a difference: it means the profile itself moved",
    converged(a, b, null, "config").converged, false);
}
ok("the profile ignore list is not applied to configs", !CONFIG_ALWAYS_IGNORED.includes("drift"));
ok("a missing existing config is never convergence", !converged(null, cfg(), null, "config").converged);
{
  // the array wildcard must not blow up on a config with no writes[] at all
  const a = cfg(), b = cfg();
  delete a.adoption.writes; delete b.adoption.writes;
  check("a config with no writes[] compares cleanly", converged(a, b, null, "config").converged, true);
}

console.log(`\n${n - fails}/${n} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
