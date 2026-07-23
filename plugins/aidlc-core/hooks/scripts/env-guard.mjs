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
// Why a hook and not a static settings `deny`: a static deny rule ALWAYS wins and can
// never be relaxed by a hook, so a user-flippable switch has to live where its value
// can be read at runtime. This hook is that switch. It fails CLOSED — any doubt about
// the config (missing file, parse error, unknown value) is treated as "deny".
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

// Resolve the switch. ONLY the exact string "ask" opens the gate; anything else —
// including a missing or malformed config — is treated as "deny" (fail closed).
let access = "deny";
try {
  const cfg = JSON.parse(readFileSync(join(cwd, ".claude", "aidlc.config.json"), "utf8"));
  if (cfg && cfg.pipeline && cfg.pipeline.envFileAccess === "ask") access = "ask";
} catch {
  /* no config / unreadable / parse error → deny */
}

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
    `explicit per-change approval, set "pipeline.envFileAccess": "ask" in .claude/aidlc.config.json ` +
    `(the default is "deny"). Ask the user to flip it — do not attempt to edit it yourself.`,
);
process.exit(2);
