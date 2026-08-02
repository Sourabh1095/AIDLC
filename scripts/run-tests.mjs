#!/usr/bin/env node
// Discover and run every *.test.mjs under plugins/, one child process each.
//
// Why discovery rather than a hardcoded list: a test file that is written but never
// wired up is the same as no test file, and nothing would notice. Adding
// `<thing>.test.mjs` next to the thing is the whole registration step.
//
// Each suite already prints its own `N/M passed` line and exits non-zero on failure;
// this only aggregates and reports which suite failed. Dependency-free on purpose —
// the plugins ship executable hooks, so the repo stays free of a test-runner supply
// chain it would have to trust.
import { readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEARCH = ["plugins"];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git") continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (entry.endsWith(".test.mjs")) out.push(p);
  }
  return out;
}

const suites = SEARCH.flatMap((d) => walk(join(ROOT, d))).sort();
if (!suites.length) {
  console.error("No *.test.mjs found — discovery is broken, which is worse than a failing test.");
  process.exit(1);
}

let failed = 0;
const failures = [];
for (const suite of suites) {
  const rel = relative(ROOT, suite).replace(/\\/g, "/");
  process.stdout.write(`\n── ${rel}\n`);
  // cwd = the suite's own directory: the existing suites resolve their fixtures and
  // the file under test relative to themselves, and several shell out to git.
  const res = spawnSync(process.execPath, [suite], { cwd: dirname(suite), stdio: "inherit" });
  if (res.status !== 0) {
    failed++;
    failures.push(`${rel} (exit ${res.status ?? "signal " + res.signal})`);
  }
}

console.log(`\n${"=".repeat(60)}`);
if (failed) {
  console.log(`${suites.length - failed}/${suites.length} suites passed — FAILED:`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`${suites.length}/${suites.length} suites passed`);
