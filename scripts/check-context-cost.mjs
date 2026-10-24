#!/usr/bin/env node
// What each plugin costs every session, before anyone runs a command.
//
// Claude Code puts the name and description of every model-visible skill and every agent into the
// context of every session where the plugin is enabled: that is how it knows when to load them. Those
// descriptions are the plugin's always-on cost, paid on every machine, in every session, whether AIDLC
// is used or not. Skill bodies cost nothing until they load (architecture.md → D5).
//
// Command-only skills (`disable-model-invocation: true`) are left out: they are never listed to the
// model, though `claude plugin details` counts them in its "Always-on" figure.
//
// Two limits:
//   - a budget per plugin, so the total cannot creep back up one reasonable-looking line at a time;
//   - a cap per description. A description says WHEN to load the component; what it covers belongs
//     in its body, where it costs nothing until used.
// Raising a budget is allowed. It should be a decision someone writes down in the PR, not a side effect.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createReport } from "./lib/report.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const r = createReport("context-cost");

// Characters of description text that every session carries, per plugin. Roughly four characters
// to a token. Measured 2026-10-25 after the 0.63.1 trim, with ~10% headroom.
const BUDGET = {
  "aidlc-core": 9200,
  "aidlc-ux": 3100,
  "aidlc-stack-web": 2100,
  "aidlc-tracker-jira": 0,
  "aidlc-tracker-ado": 0,
};
const MAX_DESCRIPTION = 340;

function frontmatter(file) {
  const m = readFileSync(file, "utf8").match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2];
  }
  return out;
}

const pluginsDir = join(ROOT, "plugins");
for (const plugin of readdirSync(pluginsDir)) {
  const base = join(pluginsDir, plugin);
  const parts = [];
  const skills = join(base, "skills");
  if (existsSync(skills))
    for (const d of readdirSync(skills)) {
      const f = join(skills, d, "SKILL.md");
      if (!existsSync(f)) continue;
      const fm = frontmatter(f);
      if (/^(true|yes)$/i.test(fm["disable-model-invocation"] ?? "")) continue;
      parts.push({ where: `plugins/${plugin}/skills/${d}/SKILL.md`, text: `${fm.description ?? ""} ${fm.when_to_use ?? ""}`.trim() });
    }
  const agents = join(base, "agents");
  if (existsSync(agents))
    for (const f of readdirSync(agents).filter((x) => x.endsWith(".md")))
      parts.push({ where: `plugins/${plugin}/agents/${f}`, text: frontmatter(join(agents, f)).description ?? "" });

  for (const p of parts)
    r.assert(
      p.text.length <= MAX_DESCRIPTION,
      p.where,
      `description is ${p.text.length} characters (cap ${MAX_DESCRIPTION}). Say when to load it; move what it covers into the body.`,
    );

  const total = parts.reduce((n, p) => n + p.text.length, 0);
  const budget = BUDGET[plugin];
  if (budget === undefined) {
    r.error(`plugins/${plugin}`, `no context budget — add one to BUDGET in scripts/check-context-cost.mjs (currently ${total} characters)`);
    continue;
  }
  r.assert(
    total <= budget,
    `plugins/${plugin}`,
    `model-visible descriptions total ${total} characters, over the ${budget} budget. Shorten descriptions, or make a command that only a person starts \`disable-model-invocation: true\`.`,
  );
  console.log(`  ${plugin.padEnd(20)} ${String(parts.length).padStart(3)} components · ${String(total).padStart(5)} / ${budget} chars · ~${Math.round(total / 4)} tokens per session`);
}

r.finish();
