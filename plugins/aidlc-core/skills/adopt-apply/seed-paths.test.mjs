#!/usr/bin/env node
// Tests for seed-paths.mjs — the three-way union that honours a human deletion.

import { resolveSeeds } from "./seed-paths.mjs";

let n = 0, fails = 0;
function check(name, got, want) {
  n++;
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { fails++; console.error(`FAIL ${name}\n  got:  ${g}\n  want: ${w}`); }
}
const ok = (name, cond) => check(name, !!cond, true);

const SEEDS = ["auth/", "tenancy/", "billing/", "audit/"];

// ---- first apply: no manifest, nothing in the config -----------------------------------------
{
  const r = resolveSeeds(undefined, SEEDS, undefined);
  check("first apply seeds everything", r.resolved, SEEDS);
  check("...and records all of it in the manifest", r.nextManifest, SEEDS);
  check("...withholding nothing", r.withheld, []);
  ok("...and says it had no manifest to reason from", /no adoption.seeded manifest/.test(r.note));
}

// ---- the defect: a human REMOVED a seeded path ------------------------------------------------
{
  const current = ["auth/", "tenancy/", "billing/"];        // audit/ deleted on purpose
  const r = resolveSeeds(current, SEEDS, SEEDS);            // manifest says we seeded audit/ before
  check("a path the team removed is NOT re-added", r.resolved, current);
  check("...it is reported as withheld", r.withheld, ["audit/"]);
  check("...and nothing is added", r.added, []);
  check("...and it STAYS in the manifest, or it comes back next time",
    r.nextManifest.includes("audit/"), true);
  // the whole point: re-running twice more must not resurrect it
  const r2 = resolveSeeds(r.resolved, SEEDS, r.nextManifest);
  const r3 = resolveSeeds(r2.resolved, SEEDS, r2.nextManifest);
  check("stable across repeated applies", r3.resolved, current);
  check("...still withheld on the third pass", r3.withheld, ["audit/"]);
}

// ---- a genuinely NEW seed must still be added, even beside a withheld one ---------------------
{
  const current = ["auth/", "tenancy/", "billing/"];
  const seeds = [...SEEDS, "webhooks/"];                    // the scan found a new sensitive path
  const r = resolveSeeds(current, seeds, SEEDS);
  check("a new seed is added", r.added, ["webhooks/"]);
  check("...while the removed one stays out", r.withheld, ["audit/"]);
  check("...and the resolved array has the addition only",
    r.resolved, ["auth/", "tenancy/", "billing/", "webhooks/"]);
  check("...and the manifest grows by the addition", r.nextManifest.length, 5);
}

// ---- a human ADDITION is never touched (the original union guarantee) -------------------------
{
  const current = ["auth/", "tenancy/", "billing/", "audit/", "ops/runbooks/"];
  const r = resolveSeeds(current, SEEDS, SEEDS);
  check("a path only a human added survives", r.resolved.includes("ops/runbooks/"), true);
  check("...and nothing is added or withheld", [r.added, r.withheld], [[], []]);
  ok("a human addition never enters our manifest", !r.nextManifest.includes("ops/runbooks/"));
}

// ---- no manifest + a narrowed array: we cannot tell, so we say so ------------------------------
{
  const current = ["auth/", "tenancy/"];
  const r = resolveSeeds(current, SEEDS, undefined);
  check("with no manifest we fall back to plain union", r.added, ["billing/", "audit/"]);
  check("...withholding nothing, because we cannot know", r.withheld, []);
  ok("...and the fallback is stated rather than silent", r.note !== null);
  ok("...which is the conservative direction for a security array",
    r.resolved.length > current.length);
}

// ---- an empty manifest is NOT the same as a missing one ----------------------------------------
{
  const r = resolveSeeds(["auth/"], SEEDS, []);
  check("an empty manifest means we seeded nothing before, so all are new",
    r.added, ["tenancy/", "billing/", "audit/"]);
  check("...and nothing is treated as a removal", r.withheld, []);
  ok("...and no fallback note, because a manifest exists", r.note === null);
}

// ---- ordering and duplicates ------------------------------------------------------------------
{
  const r = resolveSeeds(["auth/"], ["tenancy/", "tenancy/", "auth/"], []);
  check("duplicate seeds are collapsed", r.added, ["tenancy/"]);
  check("existing entries keep their position, additions append", r.resolved, ["auth/", "tenancy/"]);
}
{
  const r = resolveSeeds([], [], []);
  check("nothing in, nothing out", r.resolved, []);
}

console.log(`\n${n - fails}/${n} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
