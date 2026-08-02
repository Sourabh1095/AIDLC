#!/usr/bin/env node
// Cross-references between skills, agents and shipped files must resolve.
//
// The framework is held together by prose pointers — `aidlc:work-items` → *Repos &
// routing*, `Agent → aidlc-implementer`, `node "<plugin>/skills/run/resolve-gate.mjs"`,
// `${CLAUDE_PLUGIN_ROOT}/templates/run-file.md`. Every one is a name typed by hand
// into a markdown file, and a stale one fails in the worst available way: the model
// reads an instruction to load something that is not there and improvises. There is
// no error, no log line, and the run keeps going.
//
// A rename is the common cause, and a rename is exactly what nothing else catches.
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createReport } from "./lib/report.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const r = createReport("xrefs");
const rel = (p) => p.slice(resolve(ROOT).length + 1).replace(/\\/g, "/");

// --- Inventory: what actually exists ----------------------------------------------
const pluginDirs = readdirSync(join(ROOT, "plugins")).filter((d) =>
  existsSync(join(ROOT, "plugins", d, ".claude-plugin/plugin.json")),
);

const skills = new Set(); // "<pluginName>:<skill>"
const agents = new Set();
const pluginRootFor = new Map(); // pluginName → absolute dir

for (const dir of pluginDirs) {
  const abs = join(ROOT, "plugins", dir);
  const name = JSON.parse(readFileSync(join(abs, ".claude-plugin/plugin.json"), "utf8")).name;
  pluginRootFor.set(name, abs);
  const sdir = join(abs, "skills");
  if (existsSync(sdir)) {
    for (const s of readdirSync(sdir)) if (existsSync(join(sdir, s, "SKILL.md"))) skills.add(`${name}:${s}`);
  }
  const adir = join(abs, "agents");
  if (existsSync(adir)) {
    for (const a of readdirSync(adir)) if (a.endsWith(".md")) agents.add(a.replace(/\.md$/, ""));
  }
}
r.assert(skills.size > 0 && agents.size > 0, "plugins/", "inventory is empty — discovery is broken");

// --- Sources: every markdown that can carry a pointer -----------------------------
function walkMd(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git") continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walkMd(p, out);
    else if (entry.endsWith(".md")) out.push(p);
  }
  return out;
}
const sources = [...walkMd(join(ROOT, "plugins")), ...walkMd(join(ROOT, "docs")), join(ROOT, "README.md")].filter(existsSync);

// Which plugin a file belongs to (for resolving ${CLAUDE_PLUGIN_ROOT}).
function owningPluginRoot(file) {
  for (const [, abs] of pluginRootFor) if (resolve(file).startsWith(resolve(abs))) return abs;
  return null;
}

// Names that look like a skill reference but are not one.
const NOT_A_SKILL = new Set(["Binary", "file", "matches"]);

for (const file of sources) {
  const text = readFileSync(file, "utf8");
  const where = rel(file);

  // 1. `aidlc:<skill>` / `aidlc-ux:<skill>` / `aidlc-stack-web:<skill>`
  for (const m of text.matchAll(/\b(aidlc|aidlc-ux|aidlc-stack-web):([a-z][a-z0-9-]*)\b/g)) {
    const [ref, plugin, skill] = m;
    if (NOT_A_SKILL.has(skill)) continue;
    r.assert(
      skills.has(`${plugin}:${skill}`),
      where,
      `references \`${ref}\`, which is not a skill in any installed plugin. ` +
        `A stale pointer makes the model improvise instead of loading anything.`,
    );
  }

  // 2. Agent names — only where the text is actually dispatching one, so an agent
  //    merely discussed in prose is not mistaken for a dispatch target.
  for (const m of text.matchAll(/(?:Agent\s*(?:→|->)\s*|\bdispatch\s+\*\*|\bAgent → \*\*)(aidlc-[a-z-]+)/g)) {
    r.assert(agents.has(m[1]), where, `dispatches \`${m[1]}\`, which is not a shipped agent`);
  }

  // 3. `${CLAUDE_PLUGIN_ROOT}/<path>` — must exist inside the owning plugin.
  const owner = owningPluginRoot(file);
  if (owner) {
    for (const m of text.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([A-Za-z0-9._\-/]+)/g)) {
      const p = m[1].replace(/[.,)`]+$/, "");
      if (p.includes("{") || p.endsWith("/")) continue; // templated or a directory gesture
      r.assert(existsSync(join(owner, p)), where, `references \${CLAUDE_PLUGIN_ROOT}/${p}, which does not exist`);
    }
    // 4. `<plugin>/skills/...` — the same pointer, written the other shorthand way.
    for (const m of text.matchAll(/<plugin>\/([A-Za-z0-9._\-/]+\.mjs)/g)) {
      r.assert(existsSync(join(owner, m[1])), where, `references <plugin>/${m[1]}, which does not exist`);
    }
  }

  // 5. Relative markdown links inside docs/ and the root README.
  if (!owner) {
    for (const m of text.matchAll(/\]\((?!https?:|#|mailto:)([^)#]+)(?:#[^)]*)?\)/g)) {
      const target = join(dirname(file), m[1]);
      r.assert(existsSync(target), where, `links to \`${m[1]}\`, which does not exist`);
    }
  }
}

r.finish();
