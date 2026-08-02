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
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createReport } from "./lib/report.mjs";

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

// A rule's tool prefix and body: `Bash(git -C * status*)` → ["Bash", "git -C * status*"].
const parseRule = (rule) => {
  const m = /^([A-Za-z]+)\((.*)\)$/s.exec(rule);
  return m ? { tool: m[1], body: m[2] } : { tool: rule, body: null };
};

for (const file of files) {
  const rel = file.slice(resolve(ROOT).length + 1).replace(/\\/g, "/");
  const raw = readFileSync(file, "utf8");

  // F49 — strict JSON, no comments. Checked on the TEXT before parsing, because a
  // `//` inside a string value is legal and JSON.parse alone would not distinguish
  // "has a comment" from "is otherwise broken".
  const withoutStrings = raw.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  r.assert(
    !/(^|\s)\/\/|\/\*/.test(withoutStrings),
    rel,
    "contains a `//` or `/* */` comment. settings.json is STRICT JSON — Claude Code skips the entire file, " +
      "including enabledPlugins, so every plugin silently disappears (F49). Delete the line instead.",
  );

  let cfg;
  try {
    cfg = JSON.parse(raw);
  } catch (e) {
    r.error(rel, `does not parse as strict JSON: ${e.message}`);
    continue;
  }

  const lists = cfg.permissions ?? {};
  for (const listName of ["allow", "deny", "ask"]) {
    const rules = lists[listName] ?? [];
    r.counted(rules.length);
    const asSet = new Set(rules);

    for (const rule of rules) {
      const at = `${rel} → permissions.${listName}`;
      const { tool, body } = parseRule(rule);

      // F44 / F48 — file permission checks match only Read(path) and Edit(path).
      // A Write(path) rule is accepted, matched by nothing, and warns at startup.
      // Edit already covers every file-editing tool including Write.
      r.assert(
        tool !== "Write" || body === null,
        at,
        `\`${rule}\` — a Write(<path>) rule is never matched by file permission checks (F44/F48). ` +
          `Use Edit(${body}) instead; it already covers the Write tool.`,
      );

      if (tool !== "Bash" || body === null) continue;

      // F45 (1) — `:*` does not compose with a mid-pattern `*`. Strip the trailing
      // `:*`; if a `*` remains, the rule matches nothing.
      if (body.endsWith(":*")) {
        r.assert(
          !body.slice(0, -2).includes("*"),
          at,
          `\`${rule}\` — a trailing \`:*\` does not compose with a mid-pattern \`*\` (F45). ` +
            `This rule matches NOTHING. Write the trailing wildcard as \`*\`, not \`:*\`.` +
            (listName === "deny" ? " On a deny list this fails silently — there is no protection here." : ""),
        );
      }

      // F45 (2) — a trailing ` *` (space-star) does not match end-of-string, so the
      // argument-less spelling slips through. Require an exact-match sibling. Enforced
      // on `deny`/`ask` (a miss is silent and dangerous) and warned on `allow` (a miss
      // merely blocks the run, loudly).
      if (body.endsWith(" *")) {
        const exact = `Bash(${body.slice(0, -2)})`;
        const message =
          `\`${rule}\` — a trailing \` *\` does not match end-of-string (F45), so the argument-less ` +
          `spelling is not covered. Add \`${exact}\` alongside it.`;
        if (listName === "allow") {
          if (!asSet.has(exact)) r.warn(at, message);
        } else {
          r.assert(asSet.has(exact), at, message);
        }
      }
    }

    // Duplicates are harmless at runtime but always mean two people edited the same
    // list without reading it — and a near-duplicate is how a stale rule survives a
    // migration (F49's root cause was a migration applied by hand).
    const dupes = rules.filter((x, i) => rules.indexOf(x) !== i);
    r.assert(dupes.length === 0, `${rel} → permissions.${listName}`, `duplicate rule(s): ${[...new Set(dupes)].join(", ")}`);
  }

  // The pre-0.28 hard env denies can never be relaxed by pipeline.envFileAccess, so
  // leaving them in place makes that switch do nothing (init's migration step, F48).
  for (const stale of ["Read(./.env)", "Read(./.env.*)"]) {
    r.assert(
      !(lists.deny ?? []).includes(stale),
      `${rel} → permissions.deny`,
      `\`${stale}\` is the pre-0.28 hard deny. It overrides pipeline.envFileAccess permanently — ` +
        `enforcement now lives in env-guard.mjs and settings carries only the \`ask\` floor.`,
    );
  }
}

r.finish();
