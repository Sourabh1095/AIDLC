#!/usr/bin/env node
// Tests for converged.mjs — the §10 "write only on a real difference" rule.

import { converged, onlyAdoptionArtifactsMoved, ALWAYS_IGNORED } from "./converged.mjs";

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

console.log(`\n${n - fails}/${n} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
