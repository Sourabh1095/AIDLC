#!/usr/bin/env node
// Static lint for every shipped `settings.json` permission list.
//
// This exists because four dogfood findings were the SAME class of bug — a
// permission rule that is accepted by Claude Code, looks correct, and matches
// nothing — and three of them were found in production by a user rather than here:
//
//   F44  `Write(<path>)` deny rules are never matched (only Read/Edit are), and warn
//        at every session start.
//   F48  the identical `Write(<path>)` mistake, reapplied to the `ask` list one cycle
//        after F44 fixed it in `deny`. Its own write-up asks for exactly this lint:
//        "Consider a template lint that rejects any Write(<path>) rule outright."
//   F45  `:*` does not compose with a mid-pattern `*`, and a trailing ` *` does not
//        match end-of-string. Every F43 rule was one suffix from working, allow and
//        deny alike — and the deny half fails SILENTLY.
//   F49  a `//` comment makes settings.json unparseable; Claude Code then skips the
//        whole file, including `enabledPlugins`, disabling every plugin with no
//        symptom near the cause.
//
// What this can and cannot do, stated plainly: it is a lint of the known-bad SHAPES,
// not a matcher. It cannot prove a rule matches the command you meant — F45
// established the documentation is wrong on both points, so only a live probe can do
// that. What it can do is guarantee a shape already known to match nothing never
// ships again, which is the half that kept recurring.
//
// The rules themselves live in the PLUGIN (skills/doctor/lint-rules.mjs), not here.
// This file lints the templates the marketplace ships; `/aidlc:doctor` lints the user's
// real settings with the same module. Two callers, one definition — a lint that means
// something different in CI than it does on a user's machine is not a lint.
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createReport } from "./lib/report.mjs";
import { lintPermissionRules, lintSettingsText } from "../plugins/aidlc-core/skills/doctor/lint-rules.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const r = createReport("permissions");

// Every settings-shaped file the repo SHIPS. The repo's own .claude/settings.local.json
// is developer-local and gitignored, so it is deliberately out of scope.
function findSettings(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git") continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) findSettings(p, out);
    else if (/^settings(\.local)?\.json$/.test(entry)) out.push(p);
  }
  return out;
}

const files = existsSync(join(ROOT, "plugins")) ? findSettings(join(ROOT, "plugins")) : [];
r.assert(files.length > 0, "plugins/", "found no shipped settings.json to lint — discovery is broken");

for (const file of files) {
  const rel = file.slice(resolve(ROOT).length + 1).replace(/\\/g, "/");
  const raw = readFileSync(file, "utf8");

  for (const f of lintSettingsText(raw)) r.error(rel, f.message);

  let cfg;
  try {
    cfg = JSON.parse(raw);
  } catch {
    continue; // lintSettingsText already reported it
  }

  const lists = cfg.permissions ?? {};
  // Count every rule as a check so the summary reflects the real surface area, not
  // just the number of problems found.
  r.counted(["allow", "deny", "ask"].reduce((n, l) => n + (lists[l]?.length ?? 0), 0));

  for (const f of lintPermissionRules(lists)) {
    const at = `${rel} → permissions.${f.list}`;
    if (f.severity === "error") r.error(at, f.message);
    else r.warn(at, f.message);
  }
}

r.finish();
