// What the pipeline must never modify about itself, defined once for both enforcement
// points: protect-paths.mjs (the Edit/Write tools) and guard.mjs (shell commands).
//
// Three things were wrong with the old, per-hook version:
//   - Only the tool path was guarded, so `echo {} > .claude/settings.json` or `cp x <hook>`
//     rewrote the guardrails with nothing in the way.
//   - It matched case-sensitively, so on Windows and macOS `.Claude\settings.json` — the
//     same file — was not protected.
//   - It protected hooks by NAME (any path containing `aidlc-core`), which is both too wide
//     and too narrow: it blocked a maintainer editing the plugin's source in its own repo
//     (not the copy that is running), and it said nothing about the installed copy of a
//     plugin whose folder is named `aidlc`. What matters is which hooks are LIVE: the ones
//     in this plugin's own folder, and anything under a `.claude/` directory (installed
//     plugins, project hooks). Under `--plugin-dir`, the source checkout IS the running
//     copy, so it stays protected there.
//
// Every pattern is case-insensitive: on Linux that over-matches a file Claude Code never
// reads, which is harmless; under-matching on the other two platforms was not.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normPath, isWithin, fromShellPath, unquote } from "./paths.mjs";

// The hooks/ directory of the plugin these scripts are running from (lib → scripts → hooks).
const LIVE_HOOKS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

// `kind` of a protected path, or null:
//   "settings" — .claude/settings.json / settings.local.json (permission rules)
//   "hooks"    — the running plugin's hooks, or any hooks under a .claude/ directory
//   "git"      — files inside a .git directory (git's own hooks live there)
//   "ci"       — CI pipeline definitions (allowed, but confirmed)
// `cwd` resolves relative paths; `toolName` decides whether Git Bash drive paths apply.
export function protectedKind(rawPath, cwd = process.cwd(), toolName = "") {
  const raw = unquote(rawPath);
  if (!raw) return null;
  const abs = resolve(cwd, fromShellPath(raw, toolName));
  const p = normPath(abs);
  if (/(^|\/)\.claude\/settings(\.local)?\.json$/.test(p)) return "settings";
  if (isWithin(abs, LIVE_HOOKS_DIR) || /(^|\/)\.claude\/(.*\/)?hooks\//.test(p)) return "hooks";
  if (/(^|\/)\.git\/(?!hooks\/readme)/.test(p)) return "git";
  if (/(^|\/)\.github\/workflows\/|azure-pipelines[^/]*\.ya?ml$|(^|\/)\.azuredevops\//.test(p)) return "ci";
  return null;
}

// Is this path the AIDLC workspace config (where the env-file switch lives)?
export const isAidlcConfig = (rawPath) => /(^|[\\/])aidlc\.config\.json$/i.test(unquote(rawPath));

export const PROTECTED_REASON = {
  settings: "permission settings are human-managed",
  hooks: "the pipeline cannot change the hooks that guard it",
  git: "direct modification of git internals is not allowed — use git commands",
};
