#!/usr/bin/env node
// PreToolUse[Read|Edit|Write] guard — the env-file access switch.
//
// By DEFAULT the pipeline may neither read nor change any env file (`.env`,
// `.env.example`, `.env.local`, `.env.production`, …): env files carry secrets, and
// the safe variable names/shape belong in a human-reviewed template. This is opt-in
// per workspace via `pipeline.envFileAccess` in .claude/aidlc.config.json:
//   "deny" (default / absent / unreadable)  → hard-block the call (exit 2).
//   "ask"                                    → let it through, but surface EVERY
//                                              read/change to the user to approve or
//                                              reject (permissionDecision "ask").
//
// The switch is resolved by walking UP from the ENV FILE'S OWN directory to the nearest
// .claude/aidlc.config.json — the layout is irrelevant: mono finds it at the repo root;
// a poly workspace keeps the switch once at the control plane while the product repos
// are subfolders (each with its own env files), so an env file at any depth still sees
// the workspace's opt-in regardless of what the session cwd is. (A cwd-anchored read
// missed this: a tool call whose cwd was a product subrepo found no config there and
// fell back to deny, hard-blocking env writes in a workspace that HAD opted in — F50.)
//
// Why a hook and not a static settings `deny`: a static deny rule ALWAYS wins and can
// never be relaxed by a hook, so a user-flippable switch has to live where its value
// can be read at runtime. This hook is that switch. It fails CLOSED — any doubt about
// the config (none found up the tree, parse error, unknown value) is treated as "deny".
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

let data;
try {
  data = JSON.parse(readFileSync(0, "utf8"));
} catch {
  // Can't read the tool call at all → can't identify an env file; make no decision.
  process.exit(0);
}

const raw = (data.tool_input && (data.tool_input.file_path || data.tool_input.notebook_path)) || "";
if (!raw) process.exit(0);

// Match the env-file family by BASENAME, anywhere in the tree (mono root, poly
// product subfolders, monorepo apps/*). Catches `.env`, `.env.example`, `.env.local`,
// `.env.production.local`, … but NOT `.envrc` (direnv) or `.env-sample`.
const base = raw.replace(/\\/g, "/").split("/").pop();
if (!/^\.env(\.|$)/.test(base)) process.exit(0);

const cwd = data.cwd || process.cwd();

// Resolve the switch by walking UP from `startDir` to the nearest aidlc.config.json.
// The first config found governs (opted-in or not); ONLY the exact string "ask" opens
// the gate. No config anywhere up the tree, an unreadable/malformed one, or any other
// value → "deny" (fail closed).
function resolveAccess(startDir) {
  let dir = startDir;
  for (;;) {
    const cfgPath = join(dir, ".claude", "aidlc.config.json");
    if (existsSync(cfgPath)) {
      try {
        const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
        return cfg && cfg.pipeline && cfg.pipeline.envFileAccess === "ask" ? "ask" : "deny";
      } catch {
        return "deny"; // present but unreadable/malformed → fail closed
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return "deny"; // reached the filesystem root, no config found
    dir = parent;
  }
}

// Anchor the search on the env file's own directory (relative paths resolved against
// cwd), NOT on cwd itself — that is what lets a poly product-repo env file find the
// control-plane switch no matter where the session cwd sits.
const searchStart = dirname(resolve(cwd, raw));
const access = resolveAccess(searchStart);

const isRead = data.tool_name === "Read";
const verb = isRead ? "read" : "change";
const gerund = isRead ? "reading" : "changing";

if (access === "ask") {
  // The pipeline may proceed, but the user confirms this specific call. For an Edit
  // or Write the confirmation prompt shows the actual diff / content, so the user
  // reviews exactly what changes — user stays in the loop, as requested.
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason:
          `AIDLC: the pipeline wants to ${verb} the env file '${base}'. Env-file access is ` +
          `opt-in for this workspace (pipeline.envFileAccess = "ask") — review this change and ` +
          `approve or reject it. Set it back to "deny" to lock env files again.`,
      },
    }),
  );
  process.exit(0);
}

// Default posture: hard block, with a reason the model can act on.
process.stderr.write(
  `AIDLC env guard: ${gerund} env files ('${base}') is blocked by default — env files can hold ` +
    `secrets. To let the pipeline read and change env files (.env and .env.example) WITH your ` +
    `explicit per-change approval, set "pipeline.envFileAccess": "ask" in the workspace's ` +
    `.claude/aidlc.config.json (the default is "deny"). If it is ALREADY set to "ask", the pipeline ` +
    `could not find that config by searching up from '${searchStart}' — confirm it sits at the ` +
    `workspace control plane. Ask the user to handle the config — do not edit it yourself.`,
);
process.exit(2);
