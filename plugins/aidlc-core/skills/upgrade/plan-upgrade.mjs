#!/usr/bin/env node
// CLI for /aidlc:upgrade. Reads the project, computes the plan, and — only with
// --write — applies it.
//
//   node plan-upgrade.mjs [workspaceRoot] --plugin-root <dir> [--json] [--write]
//
// Why the writing lives here and not in the skill: every hand-edit of these two files
// has gone wrong at least once. F49 turned "remove these two rules" into two `//`
// comments, which made settings.json unparseable and silently disabled every plugin.
// Producing the new file programmatically and re-parsing it before handing it over is
// the whole mitigation, and it cannot be delegated to prose.
//
// The two files are treated differently on purpose:
//   aidlc.config.json  — written in place. The pipeline owns this file.
//   settings.json      — STAGED to .aidlc/staged-claude/settings.json, never written.
//                        protect-paths.mjs blocks the pipeline from editing its own
//                        guardrails, and that is correct: a pipeline that can rewrite
//                        its permissions has none. A human applies it.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrateConfig, classify } from "./migrate-config.mjs";
import { planSettings } from "./plan-settings.mjs";

const VALUE_FLAGS = new Set(["--plugin-root"]);
const raw = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < raw.length; i++) {
  if (VALUE_FLAGS.has(raw[i])) flags[raw[i]] = raw[++i];
  else if (raw[i].startsWith("--")) flags[raw[i]] = true;
  else positional.push(raw[i]);
}
const ROOT = resolve(positional[0] || process.cwd());
const PLUGIN = resolve(flags["--plugin-root"] ?? join(dirname(fileURLToPath(import.meta.url)), "..", ".."));
const asJson = flags["--json"] === true;
const doWrite = flags["--write"] === true;

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const tryJson = (p) => {
  try {
    return readJson(p);
  } catch {
    return null;
  }
};

const cfgPath = join(ROOT, ".claude", "aidlc.config.json");
const settingsPath = join(ROOT, ".claude", "settings.json");
const templatePath = join(PLUGIN, "templates", "project", ".claude", "settings.json");
const stagedPath = join(ROOT, ".aidlc", "staged-claude", "settings.json");
const pluginVersion = tryJson(join(PLUGIN, ".claude-plugin", "plugin.json"))?.version ?? null;

const result = { root: ROOT, pluginVersion, config: null, settings: null, blockers: [] };

// --- Config -------------------------------------------------------------------------
if (!existsSync(cfgPath)) {
  result.blockers.push(`no .claude/aidlc.config.json at ${ROOT} — there is nothing to upgrade. Run /aidlc:init.`);
} else {
  let cfg;
  try {
    cfg = readJson(cfgPath);
  } catch (e) {
    result.blockers.push(`.claude/aidlc.config.json does not parse (${e.message}). Fix the JSON before upgrading — an upgrade cannot merge into a file it cannot read.`);
  }
  if (cfg) {
    const m = migrateConfig(cfg, { pluginVersion });
    result.config = { shape: m.shape, signals: m.signals, changes: m.changes, conflicts: m.conflicts };
    if (doWrite && !m.conflicts.length && m.changes.length) {
      const next = JSON.stringify(m.config, null, 2) + "\n";
      JSON.parse(next); // prove it parses before it lands
      writeFileSync(cfgPath, next);
      result.config.written = cfgPath;
    }
  }
}

// --- Settings -------------------------------------------------------------------------
const template = tryJson(templatePath);
if (!template) {
  result.blockers.push(`could not read the shipped template at ${templatePath} — reinstall the plugin rather than upgrading against a guess.`);
} else if (!existsSync(settingsPath)) {
  result.settings = { note: "no .claude/settings.json — /aidlc:init scaffolds it; there is nothing to migrate.", changes: [], warnings: [] };
} else {
  const text = readFileSync(settingsPath, "utf8");
  let current;
  try {
    current = JSON.parse(text);
  } catch (e) {
    result.blockers.push(
      `.claude/settings.json does not parse (${e.message}). Claude Code skips the entire file when it cannot parse it — ` +
        `including enabledPlugins — so every plugin is currently disabled for this project (F49). Fix that first; /aidlc:doctor explains it.`,
    );
  }
  if (current) {
    const p = planSettings(current, template);
    const next = JSON.stringify(p.settings, null, 2) + "\n";
    result.settings = { changes: p.changes, warnings: p.warnings, changed: p.changed };

    // A staged file that already matches this plan means the plan was computed, and the
    // human has not applied it yet. Without this the command re-reports the identical
    // plan every run and reads as broken — the settings file legitimately cannot change
    // until a person moves the staged copy over it.
    if (existsSync(stagedPath)) {
      let same = false;
      try {
        same = readFileSync(stagedPath, "utf8") === next;
      } catch {
        /* unreadable — treat as not staged */
      }
      result.settings.alreadyStaged = same ? stagedPath : null;
      if (!same) result.settings.staleStaged = stagedPath;
    }

    if (doWrite && p.changed && !result.settings.alreadyStaged) {
      JSON.parse(next); // the check F49 wishes had existed
      mkdirSync(dirname(stagedPath), { recursive: true });
      writeFileSync(stagedPath, next);
      result.settings.staged = stagedPath;
    }
  }
}

// --- Output ---------------------------------------------------------------------------
if (asJson) {
  process.stdout.write(JSON.stringify(result, null, 2));
  process.exit(0);
}

const out = [];
if (result.blockers.length) {
  out.push("BLOCKERS — nothing was changed:");
  for (const b of result.blockers) out.push(`  ✗ ${b}`);
  out.push("");
}
if (result.config) {
  const c = result.config;
  out.push(`config: ${c.shape}${c.signals.length ? ` (${c.signals.join("; ")})` : ""}`);
  if (c.conflicts.length) for (const x of c.conflicts) out.push(`  ✗ ${x}`);
  else if (!c.changes.length) out.push("  already current — nothing to do");
  else {
    for (const x of c.changes) out.push(`  · ${x}`);
    out.push(c.written ? `  → written to ${c.written}` : "  (dry run — re-run with --write to apply)");
  }
  out.push("");
}
if (result.settings) {
  const s = result.settings;
  if (s.note) out.push(`settings: ${s.note}`);
  else if (!s.changed && !s.warnings.length) out.push("settings: already current — nothing to do");
  else {
    out.push("settings: permission rules");

    // REMOVALS and WARNINGS are itemized always — each one changes, or fails to change,
    // what the pipeline is permitted to do, and there are never many.
    for (const c of s.changes.filter((x) => x.action === "remove")) out.push(`  - [${c.list}] ${c.rule}\n      ${c.why}`);
    for (const w of s.warnings) out.push(`  ! [${w.list}] ${w.rule}\n      ${w.why}`);

    // ADDITIONS are summarized. Printing 130 lines that all say "shipped by the current
    // template and absent here" buries the three removals that actually matter — and a
    // report nobody reads to the end is the same as no report.
    const adds = s.changes.filter((x) => x.action === "add");
    if (adds.length) {
      const byList = adds.reduce((a, c) => ((a[c.list] = (a[c.list] ?? 0) + 1), a), {});
      const tally = Object.entries(byList).map(([l, c]) => `${l} ${c}`).join(", ");
      out.push(`  + ${adds.length} rule(s) the current template ships and this project lacks (${tally})`);
      if (flags["--verbose"]) for (const c of adds) out.push(`      + [${c.list}] ${c.rule}`);
      else out.push(`      e.g. ${adds.slice(0, 3).map((c) => c.rule).join(", ")} … (--verbose for the full list)`);
      out.push(
        `      Review these before applying: a rule may be absent because you REMOVED it deliberately,\n` +
          `      and this cannot tell that apart from a rule that predates it. Edit the staged file freely.`,
      );
    }

    // Staging state only means something while there is still something to apply. Once
    // the user HAS applied it, the plan is empty and the staged copy is redundant —
    // saying "this will keep reappearing" there tells them the opposite of the truth.
    if (!s.changed) {
      if (s.alreadyStaged || s.staleStaged)
        out.push(`  → permissions are current. The staged copy at ${s.alreadyStaged ?? s.staleStaged} has been applied and can be deleted.`);
    } else if (s.alreadyStaged)
      out.push(
        `  → already staged at ${s.alreadyStaged}, matching this plan — nothing further to compute.\n` +
          `    This plan will keep reappearing until you replace .claude/settings.json with that file.`,
      );
    else if (s.staged)
      out.push(
        `  → staged at ${s.staged}\n` +
          `    Review it, then replace .claude/settings.json with it YOURSELF. The pipeline cannot write that\n` +
          `    file (protect-paths blocks it, correctly). Delete rules outright — never comment them out.`,
      );
    else if (s.staleStaged) out.push(`  ! ${s.staleStaged} exists but does NOT match this plan — it is from an earlier run. Re-run with --write to refresh it.`);
    else if (s.changed) out.push("  (dry run — re-run with --write to stage)");
  }
}
process.stdout.write(out.join("\n") + "\n");
process.exit(0);
