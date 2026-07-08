#!/usr/bin/env node
// SessionStart — inject a compact SDLC snapshot so new sessions land oriented:
// active runs (id, phase, branch, pr) + top ready backlog items. Silent when
// the cwd is not an SDLC project.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

let data = {};
try {
  data = JSON.parse(readFileSync(0, "utf8"));
} catch {
  /* fall through with empty */
}
const cwd = data.cwd || process.cwd();

function frontmatter(file) {
  try {
    const text = readFileSync(file, "utf8");
    const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!m) return null;
    const fm = {};
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
      if (kv) fm[kv[1]] = kv[2].trim();
    }
    return fm;
  } catch {
    return null;
  }
}

const lines = [];

// Active runs
const runsDir = join(cwd, ".sdlc", "runs");
if (existsSync(runsDir)) {
  const runs = readdirSync(runsDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => frontmatter(join(runsDir, f)))
    .filter(Boolean)
    .filter((r) => r.phase && r.phase !== "done");
  if (runs.length) {
    lines.push("Active SDLC runs:");
    for (const r of runs)
      lines.push(
        `- ${r.item} [${r.phase}${r.phase === "blocked" ? " ⛔" : ""}] branch=${r.branch || "?"}${r.pr && r.pr !== "null" ? ` pr=${r.pr}` : ""}`
      );
  }
}

// Ready backlog items (markdown source only — cheap)
const itemsDir = join(cwd, "backlog", "items");
if (existsSync(itemsDir)) {
  const ready = readdirSync(itemsDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => frontmatter(join(itemsDir, f)))
    .filter(Boolean)
    .filter((i) => i.status === "todo")
    .sort((a, b) => (a.priority || "P4").localeCompare(b.priority || "P4"));
  if (ready.length) {
    lines.push(`Ready backlog items (${ready.length} todo):`);
    for (const i of ready.slice(0, 3)) lines.push(`- ${i.id} [${i.priority || "?"}, ${i.type}] ${i.title}`);
  }
}

if (lines.length) {
  lines.push("Use /sdlc:status for the full board, /sdlc:run <ID> to resume or start a run.");
  process.stdout.write(lines.join("\n"));
}
process.exit(0);
