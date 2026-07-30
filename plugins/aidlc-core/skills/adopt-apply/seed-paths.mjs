#!/usr/bin/env node
// Decide what to seed into a union-merged config array, honouring human DELETIONS.
//
//   node seed-paths.mjs <aidlc.config.json> <profile.json>
//
// Prints the resolved array plus one line per seed deliberately left out. Exits 0 always.
//
// This is code because the rule fails SILENTLY, and it fails in the one direction the spec explicitly
// says must never happen. `adopt-apply` §3.3 says seed `pipeline.securityReviewPaths` by UNION, never
// replacement — which protects a path a human ADDED. But union only ever adds, so a path a human
// REMOVED comes straight back on the next apply. And `adopt` §9 names that exact case as the thing the
// human-edit machinery exists to prevent: "a deliberately narrowed securityReviewPaths ... produces a
// diff that looks exactly like routine convergence and reverts a decision nobody will notice."
//
// The drift machinery cannot see it, because of a scalar/set asymmetry. For a scalar, "config differs
// from the baseline-derived value" is enough to attribute the change to a person. For a set, "differs"
// does not say which DIRECTION, and nothing records that a seed was ever applied — so "absent because
// never seeded" and "absent because removed" look identical.
//
// So: a manifest, not a heuristic — the same insight that made clean removal possible in Phase 4.
// `adoption.seeded.<array>` records what we put there last time, which makes the union three-way:
//
//   seed missing from config, NOT in the manifest  -> genuinely new          -> add
//   seed missing from config, IS  in the manifest  -> the team removed it    -> leave out, and say so
//   seed already in config                          -> nothing to do
//
// Everything a human added stays regardless: this only ever decides what WE contribute.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// current   — the array as it stands in the config (may be undefined on first apply)
// seeds     — what the profile says should be there
// lastSeeded— adoption.seeded.<array> from the config, i.e. what a previous apply contributed
export function resolveSeeds(current, seeds, lastSeeded) {
  const cur = Array.isArray(current) ? [...current] : [];
  const want = Array.isArray(seeds) ? [...new Set(seeds)] : [];
  // undefined (no manifest) is NOT the same as [] (a manifest recording that nothing was seeded).
  // With no manifest we cannot tell a removal from a never-seeded path, so we fall back to plain union
  // and say we are inferring — the conservative direction for a SECURITY array, where a false positive
  // costs a review and a false negative costs a missed one.
  const hasManifest = Array.isArray(lastSeeded);
  const prev = hasManifest ? new Set(lastSeeded) : null;

  const added = [];
  const withheld = [];
  for (const s of want) {
    if (cur.includes(s)) continue;
    if (hasManifest && prev.has(s)) withheld.push(s);
    else added.push(s);
  }

  return {
    resolved: [...cur, ...added],
    added,
    withheld,
    hasManifest,
    // What the NEXT apply compares against: everything we have ever contributed that is still wanted,
    // plus what we are contributing now. A withheld seed stays in the manifest — it is the record of
    // "we offered this and the team said no", and dropping it would re-add the path next time.
    nextManifest: [...new Set([...(hasManifest ? lastSeeded : []), ...added])],
    note: hasManifest
      ? null
      : "no adoption.seeded manifest — cannot distinguish a path the team removed from one never seeded, so this falls back to plain union. Say so in the summary; the next apply will have a manifest.",
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [cfgPath, profPath] = process.argv.slice(2);
  if (!cfgPath || !profPath) {
    console.error("usage: node seed-paths.mjs <aidlc.config.json> <profile.json>");
    process.exit(2);
  }
  const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
  const prof = JSON.parse(readFileSync(profPath, "utf8"));

  // Seeds are repo-relative in the profile and workspace-relative in the config, so prefix by the
  // repo's configured path when the root is not the control plane.
  const byRootName = new Map();
  for (const r of cfg.repos ?? []) byRootName.set(r.name, r);
  const seeds = [];
  for (const root of prof.workspace?.roots ?? []) {
    for (const s of root.saas?.securityReviewPathSeeds ?? []) {
      const repo = [...byRootName.values()].find(
        (r) => r.name === root.name || root.absolutePath?.replace(/\\/g, "/").endsWith("/" + r.name)
      );
      seeds.push(repo ? `${repo.name}/${s}` : s);
    }
  }

  const r = resolveSeeds(
    cfg.pipeline?.securityReviewPaths,
    seeds,
    cfg.adoption?.seeded?.securityReviewPaths
  );
  console.log(`resolved (${r.resolved.length}):`);
  for (const p of r.resolved) console.log(`  ${p}`);
  if (r.added.length) {
    console.log(`\nadding ${r.added.length}:`);
    for (const p of r.added) console.log(`  + ${p}`);
  }
  if (r.withheld.length) {
    console.log(`\nNOT re-adding ${r.withheld.length} — seeded by a previous apply and removed since, so the removal was deliberate:`);
    for (const p of r.withheld) console.log(`  · ${p}`);
  }
  if (r.note) console.log(`\nnote: ${r.note}`);
}
