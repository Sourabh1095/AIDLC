#!/usr/bin/env node
// PreToolUse[Read|Edit|Write|NotebookEdit|Grep] guard — the env-file access switch.
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
// Grep is a read too: its matching lines ARE the file's content, so a Grep whose `path`
// is `.env` printed the secrets this switch exists to keep out of the transcript. It is
// covered when it names an env file directly (`path`) or targets one by `glob`.
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
// the config (none found up the tree, parse error, unknown value) is treated as "deny",
// and any failure of the hook itself becomes an "ask" (./lib/hook-io.mjs).
import { dirname, resolve } from "node:path";
import { isEnvFile, envFileAccess } from "./lib/env-access.mjs";
import { runGuard, ask, block, str, cwdOf } from "./lib/hook-io.mjs";

// The env file this call touches, or "".
function envTarget(toolName, input) {
  const direct = str(input.file_path) || str(input.notebook_path);
  if (direct) return isEnvFile(direct) ? direct : "";
  if (toolName === "Grep") {
    const path = str(input.path);
    if (path && isEnvFile(path)) return path;
    // A glob naming the env family (`.env*`, `**/.env.local`) points the search at them.
    const glob = str(input.glob);
    if (/(^|[\\/{,])\.env/i.test(glob)) return path ? `${path.replace(/[\\/]+$/, "")}/.env` : ".env";
  }
  return "";
}

function main(data) {
  const input = data.tool_input && typeof data.tool_input === "object" ? data.tool_input : {};
  const toolName = str(data.tool_name);
  const raw = envTarget(toolName, input);
  if (!raw) process.exit(0);

  const base = raw.replace(/\\/g, "/").split("/").pop();
  const cwd = cwdOf(data);

  // Anchor the search on the env file's own directory (relative paths resolved against
  // cwd), NOT on cwd itself — that is what lets a poly product-repo env file find the
  // control-plane switch no matter where the session cwd sits. Resolver + fail-closed
  // semantics: ./lib/env-access.mjs, shared with the shell-path backstop in guard.mjs.
  const searchStart = dirname(resolve(cwd, raw));
  const access = envFileAccess(searchStart);

  const isRead = toolName === "Read" || toolName === "Grep";
  const verb = isRead ? "read" : "change";
  const gerund = isRead ? "reading" : "changing";

  if (access === "ask") {
    // The pipeline may proceed, but the user confirms this specific call. For an Edit
    // or Write the confirmation prompt shows the actual diff / content, so the user
    // reviews exactly what changes — user stays in the loop, as requested.
    ask(
      `AIDLC: the pipeline wants to ${verb} the env file '${base}'. Env-file access is ` +
        `opt-in for this workspace (pipeline.envFileAccess = "ask") — review this ${isRead ? "read" : "change"} and ` +
        `approve or reject it. Set it back to "deny" to lock env files again.`,
    );
    process.exit(0);
  }

  // Default posture: hard block, with a reason the model can act on.
  block(
    "AIDLC env guard",
    `${gerund} env files ('${base}') is blocked by default — env files can hold ` +
      `secrets. To let the pipeline read and change env files (.env and .env.example) WITH your ` +
      `explicit per-change approval, set "pipeline.envFileAccess": "ask" in the workspace's ` +
      `.claude/aidlc.config.json (the default is "deny"). If it is ALREADY set to "ask", the pipeline ` +
      `could not find that config by searching up from '${searchStart}' — confirm it sits at the ` +
      `workspace control plane. Ask the user to handle the config — do not edit it yourself.`,
  );
}

runGuard("env guard", main);
