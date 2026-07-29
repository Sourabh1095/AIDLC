#!/usr/bin/env node
// Resolve the verification gate for one work item from pipeline.gates.verify.
//
//   node resolve-gate.mjs <aidlc.config.json> <repoName> [packageName]
//
// Prints the resolved, ordered step list plus the coverage-hole lines for `## Findings`.
// Exits 0 always (resolution is not a verdict); exits 2 on bad input.
//
// This is code rather than prose because the layering rule is easy to get wrong in a way that
// FAILS SILENTLY: read only the narrowest list and a Python package inside a TypeScript monorepo
// loses the repo-wide lint gate, and a gate that vanished is indistinguishable from one that
// passed. A live adoption run hit exactly that.
//
// Rule: walk layers NARROWEST -> BROADEST (package, repo, workspace). Each layer contributes its
// steps in its own declared order, but only for names no narrower layer already claimed. The
// narrowest layer that mentions a gate therefore owns both its definition and its position, and
// broader layers top up the gates nobody narrower mentioned.
//
// Two properties this buys, both learned the hard way:
//   * a package declaring `test` still inherits the repo's `lint` — no silent coverage loss; and
//   * a repo declaring [test, lint] runs test first, because its ordering is a deliberate
//     statement that a broader default's ordering must not override.
// To make a package skip a repo-level gate, declare that gate at the package level with
// status "absent" — explicit, and still reported as a coverage hole.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function resolveGate(config, repoName, packageName) {
  const verify = config?.pipeline?.gates?.verify;
  if (!verify) {
    return {
      steps: [], layers: [], fallback: true,
      note: "no pipeline.gates.verify — fall back to the CLAUDE.md Commands block, and do not assume npm scripts exist",
    };
  }
  // narrowest first
  const repo = verify.repos?.[repoName];
  const pkg = packageName ? repo?.packages?.[packageName] : undefined;
  const layers = [];
  if (Array.isArray(pkg?.steps)) layers.push({ source: `verify.repos.${repoName}.packages.${packageName}.steps`, steps: pkg.steps });
  if (Array.isArray(repo?.steps)) layers.push({ source: `verify.repos.${repoName}.steps`, steps: repo.steps });
  if (Array.isArray(verify.steps)) layers.push({ source: "verify.steps", steps: verify.steps });

  const steps = [];
  const from = new Map();
  for (const layer of layers)
    for (const s of layer.steps) {
      if (from.has(s.name)) continue; // a narrower layer already owns this gate and its position
      steps.push(s);
      from.set(s.name, layer.source);
    }
  return {
    steps, layers: layers.map((l) => l.source), from: Object.fromEntries(from),
    fallback: false,
    ...(layers.length ? {} : { note: `no step list applies to ${repoName}${packageName ? "/" + packageName : ""} — nothing to run, which is itself worth reporting` }),
  };
}

// Lines the run skill writes into `## Findings`: one per absent gate.
export function coverageHoles(steps, repoName, packageName) {
  return steps
    .filter((s) => s.status === "absent")
    .map((s) => `coverage hole: no \`${s.name}\` gate in \`${repoName}${packageName ? "/" + packageName : ""}\` (recorded absent at adoption) — not counted green`);
}

// Steps that need services: a failure is "environment unavailable", not "code broken".
export const environmentDependent = (steps) => steps.filter((s) => s.environmentDependent === true);

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const [cfgPath, repoName, packageName] = process.argv.slice(2);
  if (!cfgPath || !repoName) {
    console.error("usage: node resolve-gate.mjs <aidlc.config.json> <repoName> [packageName]");
    process.exit(2);
  }
  let config;
  try { config = JSON.parse(readFileSync(cfgPath, "utf8")); }
  catch (e) { console.error(`cannot read ${cfgPath}: ${e.message}`); process.exit(2); }

  const r = resolveGate(config, repoName, packageName);
  if (r.fallback || r.note) console.log(`note: ${r.note}`);
  if (r.layers.length) console.log(`layers: ${r.layers.join("  +  ")}`);
  const runnable = r.steps.filter((s) => s.status !== "absent");
  console.log(`\norder: ${runnable.map((s) => s.name).join(" -> ") || "(nothing runnable)"}`);
  for (const s of runnable) {
    const bits = [`[${s.scope ?? "repo"}]`];
    if (s.cwd) bits.push(`cwd=${s.cwd}`);
    if (s.required === false) bits.push("advisory");
    if (s.environmentDependent) bits.push(`needs ${(s.services ?? ["services"]).join(",")}`);
    if (s.providedByHook) bits.push(`already run by ${s.providedByHook}`);
    if (s.timeoutMinutes) bits.push(`timeout ${s.timeoutMinutes}m`);
    console.log(`  ${String(s.name).padEnd(11)} ${s.cmd}   ${bits.join(" ")}   (from ${r.from[s.name]})`);
  }
  const holes = coverageHoles(r.steps, repoName, packageName);
  if (holes.length) { console.log("\n## Findings"); for (const h of holes) console.log(`- ${h}`); }
}
