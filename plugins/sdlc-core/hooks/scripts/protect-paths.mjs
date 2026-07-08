#!/usr/bin/env node
// PreToolUse[Edit|Write] guard — the pipeline must not modify its own guardrails.
// Blocks: changes to an EXISTING .claude/settings*.json (creation is allowed — /sdlc:init
// legitimately scaffolds it), hook scripts, .git internals.
// Flags for confirmation: CI workflow files (legitimate for devops items, worth a human glance).
import { readFileSync, existsSync } from "node:fs";

let data;
try {
  data = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.exit(0);
}

const raw = (data.tool_input && (data.tool_input.file_path || data.tool_input.notebook_path)) || "";
if (!raw) process.exit(0);
const p = raw.replace(/\\/g, "/");

function block(reason) {
  process.stderr.write(`SDLC path guard: ${reason}`);
  process.exit(2);
}

// Guardrail self-modification — block only when the file already exists; first-time
// creation is the /sdlc:init bootstrap and is allowed.
if (/\/\.claude\/settings(\.local)?\.json$/.test(p) || /^\.claude\/settings(\.local)?\.json$/.test(p)) {
  let exists = true;
  try {
    exists = existsSync(raw);
  } catch {
    /* treat as existing → block conservatively */
  }
  if (exists) block(`editing ${p} is not allowed — permission settings are human-managed.`);
}
if (/\/hooks\/(hooks\.json|scripts\/)/.test(p) && /(sdlc-core|\/\.claude\/)/.test(p))
  block(`editing hook configuration or scripts (${p}) is not allowed.`);

// Git internals (worktree-safe: .git can be a file; block paths inside a .git dir)
if (/\/\.git\/(?!hooks\/README)/.test(p) || /^\.git\//.test(p))
  block(`direct modification of git internals (${p}) is not allowed — use git commands.`);

// CI workflows: allowed but surfaced for confirmation
if (/\.github\/workflows\/|azure-pipelines.*\.ya?ml$|\.azuredevops\//.test(p)) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: `SDLC: modifying CI pipeline file ${p} — confirm this is intended for the current work item.`,
      },
    })
  );
  process.exit(0);
}

process.exit(0);
