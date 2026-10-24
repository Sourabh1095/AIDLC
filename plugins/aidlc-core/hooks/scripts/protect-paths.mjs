#!/usr/bin/env node
// PreToolUse[Edit|Write|NotebookEdit] guard — the pipeline must not modify its own guardrails.
// Blocks: changes to an EXISTING .claude/settings*.json (creation is allowed — /aidlc:init
// legitimately scaffolds it), the hooks that are running, .git internals.
// Asks: CI workflow files (legitimate for devops items, worth a human glance), and any
// change to the env-file access switch in aidlc.config.json.
//
// What counts as protected is defined once, in ./lib/protected-paths.mjs, and shared with
// the shell-path check in guard.mjs. Any internal failure becomes an "ask", never a silent
// allow (./lib/hook-io.mjs).
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { runGuard, ask, block as blockWith, str, cwdOf } from "./lib/hook-io.mjs";
import { protectedKind, isAidlcConfig, PROTECTED_REASON } from "./lib/protected-paths.mjs";

const block = (reason) => blockWith("AIDLC path guard", reason);

// The env-file switch (`pipeline.envFileAccess`) is the one setting the pipeline must not
// turn up for itself: it is a human's decision to let an agent near secrets. The config
// file as a whole stays editable — the pipeline legitimately writes ports and repo entries
// into it — so only a change that touches the switch is surfaced.
function touchesEnvSwitch(input, absPath) {
  const edits = Array.isArray(input.edits) ? input.edits : [input];
  if (edits.some((e) => /envFileAccess/.test(str(e && e.old_string) + str(e && e.new_string)))) return true;
  if (typeof input.content !== "string") return false;
  const valueIn = (text) => {
    try {
      const v = JSON.parse(text)?.pipeline?.envFileAccess;
      return v === undefined ? "deny" : v;
    } catch {
      return /envFileAccess/.test(text) ? "unparsed" : "deny";
    }
  };
  let before = "deny";
  try {
    if (existsSync(absPath)) before = valueIn(readFileSync(absPath, "utf8"));
  } catch {
    /* unreadable — compare against the default */
  }
  return valueIn(input.content) !== before;
}

function main(data) {
  const input = data.tool_input && typeof data.tool_input === "object" ? data.tool_input : {};
  const raw = str(input.file_path) || str(input.notebook_path);
  if (!raw) process.exit(0);
  const cwd = cwdOf(data);
  const abs = resolve(cwd, raw);
  const shown = raw.replace(/\\/g, "/");

  const kind = protectedKind(raw, cwd);

  // Guardrail self-modification — block only when the file already exists; first-time
  // creation is the /aidlc:init bootstrap and is allowed.
  //
  // This blocks two flows that legitimately need to change the file — /aidlc:init merging
  // into a project's existing settings, and /aidlc:remove reverting them. That is intended:
  // there is no way for a hook to tell "the removal command" from "an agent rewriting its
  // own permissions", and getting that wrong once is worse than the inconvenience. Both
  // skills therefore STAGE the new content to `.aidlc/staged-claude/settings.json` and have
  // the user apply it. Do not "fix" this hook to special-case them.
  if (kind === "settings" && existsSync(abs)) block(`editing ${shown} is not allowed — ${PROTECTED_REASON.settings}.`);
  if (kind === "hooks") block(`editing ${shown} is not allowed — ${PROTECTED_REASON.hooks}.`);
  if (kind === "git") block(`${shown}: ${PROTECTED_REASON.git}.`);
  if (kind === "ci") {
    ask(`AIDLC: modifying CI pipeline file ${shown} — confirm this is intended for the current work item.`);
    process.exit(0);
  }

  if (isAidlcConfig(raw) && touchesEnvSwitch(input, abs)) {
    ask(
      `AIDLC: this change touches pipeline.envFileAccess in ${shown} — the switch that lets the pipeline ` +
        `read and change env files. That is your decision, not the pipeline's: approve only if you asked for it.`,
    );
    process.exit(0);
  }

  process.exit(0);
}

runGuard("path guard", main);
