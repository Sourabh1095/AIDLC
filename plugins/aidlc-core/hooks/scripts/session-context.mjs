#!/usr/bin/env node
// SessionStart — inject a compact AIDLC snapshot so new sessions land oriented:
// active runs (id, phase, branch, pr) + top ready backlog items. Silent when
// the cwd is not an AIDLC project. Poly-aware: scans the control-plane run dir
// plus each declared repo's .aidlc/runs.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { frontmatter, readRuns } from "./lib/run-files.mjs";

let data = {};
try {
  data = JSON.parse(readFileSync(0, "utf8"));
} catch {
  /* fall through with empty */
}
const cwd = data.cwd || process.cwd();

const lines = [];

try {
  // Active runs. Unlike checkpoint, `blocked` IS surfaced (with ⛔): a session opening
  // on a blocked run is exactly when the user needs to know.
  const runs = readRuns(cwd, (r) => r.phase && r.phase !== "done");
  if (runs.length) {
    lines.push("Active AIDLC runs:");
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
    lines.push("Use /aidlc:status for the full board, /aidlc:run <ID> to resume or start a run.");
    process.stdout.write(lines.join("\n"));
  }
} catch {
  // a context snapshot is never worth breaking a session over
}
process.exit(0);
