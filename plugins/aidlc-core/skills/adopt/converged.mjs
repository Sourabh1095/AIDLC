#!/usr/bin/env node
// Decide whether a freshly derived artifact says anything new — i.e. whether to write at all.
// Covers BOTH artifacts that make an idempotency promise: the adoption profile (adopt §10) and
// aidlc.config.json (adopt-apply §3.5). One tested function, because the rule is the same one and it
// has now failed four times in this codebase by omitting a field from the ignore list.
//
//   node converged.mjs <existing.json> <candidate.json> [changed-paths-file] [--config]
//
// Prints "converged" (write nothing) or "differs: <first differing pointer>" and exits 0 / 1.
//
// This is code because "compare, excluding the inherently variable fields" is a rule that fails
// SILENTLY, and it has now gone wrong three times in this codebase: `adoption.appliedAt` made every
// re-apply a one-line diff, gate layering lost inherited gates, and `scan.commit` produced a
// treadmill nobody could get off.
//
// The scan.commit case is worth spelling out, because it is self-referential and therefore not
// obvious. §10 REQUIRES the profile be git-tracked (§9's drift baseline depends on the history).
// Committing the profile moves HEAD. So the next scan reads a different HEAD, records a different
// scan.commit, and rewrites the profile — which you then commit, moving HEAD again. The profile can
// never catch up with HEAD, because recording it is what moves HEAD. Worse than the churn: each
// rewrite MOVES THE BASELINE the next scan compares against, which is the exact failure the
// convergence rule was written to prevent.
//
// The fix is not to blanket-exclude scan.commit — a project that really moved must update it.
// It is to ask whether anything OUTSIDE the adoption artifacts changed:
//
//   git -C "<control plane>" diff --name-only <scan.commit>..HEAD -- . ':(exclude).aidlc/adoption/'
//
// Empty  => the profile still describes the workspace; ignore the commit difference, write nothing.
// Filled => the project moved; scan.commit updates and §9 reports the drift.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Fields that vary run-to-run without the workspace having changed. `drift` is here because it
// merely echoes this very comparison — including it would make the answer depend on itself.
export const ALWAYS_IGNORED = [
  "scan.scannedAt",
  "scan.budget.durationSeconds",
  "drift",
];

// Ignored ONLY when the commits differ by adoption artifacts alone. Never unconditionally: a moved
// project must record the commit it was actually read at.
export const IGNORED_WHEN_ONLY_ADOPTION_MOVED = [
  "scan.commit",
];

// aidlc.config.json's equivalents (adopt-apply §3.5). `appliedAt` was the documented one;
// `writes[].at` is the one the live run found, and it is worse because the apply step REBUILDS the
// manifest every time it runs — so every re-apply differed, wrote, advanced `appliedAt`, and did it
// again next time. `[]` walks every element of an array.
export const CONFIG_ALWAYS_IGNORED = [
  "adoption.appliedAt",
  "adoption.writes[].at",
];

// `adoption.scannedAt` is deliberately NOT ignored: it comes from the profile, so it changes only when
// the profile really changed, which is a difference worth writing. `adoption.upgrades[].at` is not
// ignored either, for a different reason — that array is history, appended when an upgrade happens and
// never rebuilt, so a no-op re-apply adds nothing to it. If an implementation ever rebuilds it, this
// list is where the fix goes.

const ADOPTION_PREFIX = ".aidlc/adoption/";

// `changedPaths` is the output of the git diff above, as an array. Pass null when unknown — the
// conservative reading, which keeps scan.commit in the comparison.
export function onlyAdoptionArtifactsMoved(changedPaths) {
  if (!Array.isArray(changedPaths)) return false;
  if (changedPaths.length === 0) return true;
  return changedPaths.every((p) => String(p).replace(/\\/g, "/").trim().startsWith(ADOPTION_PREFIX));
}

function deleteAt(node, keys) {
  if (node == null || typeof node !== "object") return;
  const [head, ...rest] = keys;
  if (head.endsWith("[]")) {
    const arr = node[head.slice(0, -2)];
    if (!Array.isArray(arr)) return;
    for (const el of arr) rest.length ? deleteAt(el, rest) : void 0;
    return;
  }
  if (rest.length === 0) { delete node[head]; return; }
  deleteAt(node[head], rest);
}

function strip(obj, pointers) {
  const clone = structuredClone(obj);
  for (const pointer of pointers) deleteAt(clone, pointer.split("."));
  return clone;
}

// Stable stringify so key order can never masquerade as a difference.
function canon(v) {
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`;
  return JSON.stringify(v) ?? "null";
}

function firstDifference(a, b, path = "") {
  if (canon(a) === canon(b)) return null;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object" ||
      Array.isArray(a) !== Array.isArray(b)) return path || "(root)";
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  for (const k of keys) {
    const d = firstDifference(a[k], b[k], path ? `${path}.${k}` : k);
    if (d) return d;
  }
  return path || "(root)";
}

export function converged(existing, candidate, changedPaths = null, kind = "profile") {
  if (!existing || !candidate)
    return { converged: false, reason: `no existing ${kind} to compare against` };
  if (kind === "config") {
    const a = strip(existing, CONFIG_ALWAYS_IGNORED);
    const b = strip(candidate, CONFIG_ALWAYS_IGNORED);
    const diff = firstDifference(a, b);
    return diff === null
      ? { converged: true, reason: "this workspace already matches the profile — write nothing, and appliedAt keeps its original value" }
      : { converged: false, firstDifference: diff };
  }
  const ignored = [...ALWAYS_IGNORED];
  const commitExcusable = onlyAdoptionArtifactsMoved(changedPaths);
  if (commitExcusable) ignored.push(...IGNORED_WHEN_ONLY_ADOPTION_MOVED);

  const a = strip(existing, ignored);
  const b = strip(candidate, ignored);
  const diff = firstDifference(a, b);
  if (diff === null) {
    return {
      converged: true,
      commitExcusable,
      reason: commitExcusable
        ? "this profile already describes the workspace; the recorded commit is behind HEAD only by commits touching .aidlc/adoption/, so it is not drift"
        : "this profile already describes the workspace at the recorded commit",
    };
  }
  return { converged: false, firstDifference: diff, commitExcusable };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const argv = process.argv.slice(2);
  const kind = argv.includes("--config") ? "config" : "profile";
  const [existingPath, candidatePath, changedPathsFile] = argv.filter((a) => a !== "--config");
  if (!existingPath || !candidatePath) {
    console.error("usage: node converged.mjs <existing.json> <candidate.json> [changed-paths-file] [--config]");
    process.exit(2);
  }
  const read = (p) => JSON.parse(readFileSync(p, "utf8"));
  let changed = null;
  if (changedPathsFile) {
    changed = readFileSync(changedPathsFile, "utf8").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  }
  const r = converged(read(existingPath), read(candidatePath), changed, kind);
  if (r.converged) {
    console.log(`converged — write neither file. ${r.reason}`);
    process.exit(0);
  }
  console.log(`differs at ${r.firstDifference} — write both, and let §9 name what moved.`);
  process.exit(1);
}
