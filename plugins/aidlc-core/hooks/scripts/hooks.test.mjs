// Tests that hooks.json routes every tool that can do the guarded thing to the hook that
// guards it. Run: `node hooks.test.mjs`.
//
// The script tests start each hook directly with node, so they could never notice the gap
// that mattered most: `PreToolUse` matched `Bash` only, and on Windows the PowerShell tool
// — the only shell tool when Git Bash is absent — reached no guard at all. Grep read env
// files past a matcher that named Read|Edit|Write. This file pins the routing itself.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HOOKS = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "hooks.json"), "utf8")).hooks;

// The scripts a PreToolUse call for `tool` runs, per Claude Code's matcher rules: a matcher
// of only word characters and `|` is an exact list; anything else is an unanchored regex.
function scriptsFor(tool) {
  const out = [];
  for (const entry of HOOKS.PreToolUse || []) {
    const m = entry.matcher || "";
    const hit = /^[\w|]*$/.test(m) ? m === "" || m.split("|").includes(tool) : new RegExp(m).test(tool);
    if (hit) for (const h of entry.hooks) out.push(h.command.match(/scripts\/([\w-]+)\.mjs/)[1]);
  }
  return out;
}

let fails = 0;
let n = 0;
function expectRoutes(tool, scripts) {
  for (const s of scripts) {
    n++;
    if (!scriptsFor(tool).includes(s)) {
      fails++;
      console.log(`FAIL ${tool} does not reach ${s}.mjs (reaches: ${scriptsFor(tool).join(", ") || "nothing"})`);
    } else console.log(`ok   ${tool} → ${s}`);
  }
}

// Shell tools: both reach the command guard and the dependency gate.
expectRoutes("Bash", ["guard", "dep-vet"]);
expectRoutes("PowerShell", ["guard", "dep-vet"]);
// File-writing tools reach the guardrail check and the env switch.
for (const t of ["Edit", "Write", "MultiEdit", "NotebookEdit"]) expectRoutes(t, ["protect-paths", "env-guard"]);
// File-reading tools reach the env switch.
for (const t of ["Read", "Grep"]) expectRoutes(t, ["env-guard"]);

// Every script hooks.json names must exist.
for (const [event, entries] of Object.entries(HOOKS)) {
  for (const entry of entries) {
    for (const h of entry.hooks) {
      n++;
      const m = h.command.match(/\/hooks\/scripts\/([\w-]+\.mjs)/);
      try {
        readFileSync(join(dirname(fileURLToPath(import.meta.url)), m[1]));
        console.log(`ok   ${event}: ${m[1]} exists`);
      } catch {
        fails++;
        console.log(`FAIL ${event}: ${h.command} names a missing script`);
      }
    }
  }
}

// What a guard does when it cannot run at all. `runGuard` turns every failure INSIDE a guard
// into an ask, but it cannot help when node is missing, the plugin folder is gone, or a module
// fails to load: the script never reaches it, and a hook that never ran was a non-blocking
// error — the call went through. `onFailure: "block"` (Claude Code 2.1.295+) closes that.
// The security guards must carry it. dep-vet must say "continue" out loud: it only ever asks,
// so a broken nudge must not stop every shell command (and on Windows without Git Bash an
// UNSET onFailure on a shell-form hook already blocks, which is not what dep-vet wants).
const ON_FAILURE = { guard: "block", "protect-paths": "block", "env-guard": "block", "dep-vet": "continue" };
for (const entry of HOOKS.PreToolUse || []) {
  for (const h of entry.hooks) {
    const script = h.command.match(/scripts\/([\w-]+)\.mjs/)[1];
    n++;
    const want = ON_FAILURE[script];
    if (!want) {
      fails++;
      console.log(`FAIL PreToolUse ${script}.mjs: new guard — decide its onFailure and add it to ON_FAILURE here`);
    } else if (h.onFailure !== want) {
      fails++;
      console.log(`FAIL PreToolUse ${script}.mjs: onFailure is ${JSON.stringify(h.onFailure)}, must be "${want}"`);
    } else console.log(`ok   PreToolUse ${script}.mjs: onFailure ${want}`);
  }
}

console.log(`\n${n - fails}/${n} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
