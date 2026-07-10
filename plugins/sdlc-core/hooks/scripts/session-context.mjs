#!/usr/bin/env node
// SessionStart — inject a compact SDLC snapshot so new sessions land oriented:
// active runs (id, phase, branch, pr) + top ready backlog items. Silent when
// the cwd is not an SDLC project. Poly-aware: scans the control-plane run dir
// plus each declared repo's .sdlc/runs.
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

// Run dirs to scan: the control plane, plus each declared repo (poly).
function runDirs() {
  const dirs = [join(cwd, ".sdlc", "runs")];
  try {
    const cfg = JSON.parse(readFileSync(join(cwd, ".claude", "sdlc.config.json"), "utf8"));
    const root = (cfg.workspace && cfg.workspace.root) || ".";
    for (const r of cfg.repos || [])
      if (r && r.path) dirs.push(join(cwd, root, r.path, ".sdlc", "runs"));
  } catch {
    /* mono or no config → control plane only */
  }
  return dirs.filter((d) => existsSync(d));
}

const lines = [];

try {
  // Active runs (deduped by item across all repo dirs)
  const seen = new Set();
  const runs = runDirs()
    .flatMap((d) => readdirSync(d).filter((f) => f.endsWith(".md")).map((f) => frontmatter(join(d, f))))
    .filter(Boolean)
    .filter((r) => r.phase && r.phase !== "done")
    .filter((r) => (r.item && seen.has(r.item) ? false : (seen.add(r.item), true)));
  if (runs.length) {
    lines.push("Active SDLC runs:");
    for (const r of runs)
      lines.push(
        `- ${r.item} [${r.phase}${r.phase === "blocked" ? " ⛔" : ""}]${r.repo && r.repo !== "null" ? ` repo=${r.repo}` : ""} branch=${r.branch || "?"}${r.pr && r.pr !== "null" ? ` pr=${r.pr}` : ""}`
      );
  }

  // Ready backlog items (markdown source only — cheap; backlog lives at the control plane)
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
} catch {
  // a context snapshot is never worth breaking a session over
}
process.exit(0);
