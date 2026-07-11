#!/usr/bin/env node
// PreToolUse[Bash] — dependency pre-install gate.
// A new dependency is a supply-chain + compatibility decision, and it's cheapest
// to get right BEFORE any code is written against it. This intercepts package-ADD
// commands (npm i <pkg>, npm install <pkg>, pnpm/yarn/bun add …) and asks the
// operator to vet the package FIRST — safe, latest-stable, compatible — per the
// `sdlc:security` dependency policy. Plain installs from the lockfile
// (`npm ci`, bare `npm install`, `pnpm i`) are NOT gated. Exit 0 always; the gate
// is a permission "ask", never a hard block. Never throw.
import { readFileSync } from "node:fs";

let data;
try {
  data = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.exit(0);
}

const cmd = (data.tool_input && data.tool_input.command) || "";
if (!cmd) process.exit(0);

// Blank quoted text so a package name inside a commit message / echo can't trigger.
const stripQuotes = (s) => s.replace(/'[^']*'/g, " ").replace(/"[^"]*"/g, " ");

// Collect package specifiers added by a single segment (empty ⇒ not an add).
function addedPackages(segment) {
  const seg = stripQuotes(segment).trim();
  // Tool + subcommand that ADD packages (vs. lockfile installs).
  //  - npm i|install|add <pkg…>   (bare npm i / install / ci ⇒ lockfile, no pkg token)
  //  - pnpm add <pkg…> | pnpm i|install <pkg…>
  //  - yarn add <pkg…> | bun add <pkg…>
  const m = seg.match(/\b(npm|pnpm|yarn|bun)\s+(install|add|i)\b(.*)$/);
  if (!m) return [];
  const [, tool, sub, rest] = m;
  // yarn/bun `install` (or bare) = lockfile, not an add; only `add` adds.
  if ((tool === "yarn" || tool === "bun") && sub !== "add") return [];
  // Package tokens = non-flag words after the subcommand. `npm install` with none
  // ⇒ lockfile install ⇒ skip. Drop flags and their obvious inline values.
  const tokens = rest
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => !t.startsWith("-"));
  // A local path/tarball is still a dependency add worth a glance, so keep those.
  return tokens;
}

const pkgs = [];
for (const seg of cmd.split(/[|;&]+/)) {
  for (const p of addedPackages(seg)) if (!pkgs.includes(p)) pkgs.push(p);
}

if (!pkgs.length) process.exit(0);

const list = pkgs.slice(0, 8).join(", ");
process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason:
        `SDLC dependency policy — vet BEFORE installing (${list}) so no code gets built on a bad choice. ` +
        `Confirm only once you have checked, for each new package: ` +
        `(1) SAFE — maintained (recent publish, real repo activity), exact name (no typosquat), ` +
        `sane license, no suspicious install scripts, no open CVEs (npm audit / advisory DB); ` +
        `(2) LATEST STABLE — the current stable version (not a stale major, not alpha/beta/rc) — ` +
        `verify the real version via Context7/registry, not memory; ` +
        `(3) COMPATIBLE — its peerDependencies and engines fit this project's stack (framework major, ` +
        `Node version) and it won't force a peer conflict (never --legacy-peer-deps/--force to silence one). ` +
        `See sdlc:security → Dependency policy. If it fails any test, pick an alternative now, before coding.`,
    },
  }),
);
process.exit(0);
