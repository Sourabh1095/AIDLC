#!/usr/bin/env node
// SessionStart — inject a compact AIDLC snapshot so a new session lands oriented.
//
// What this used to say: active runs, plus the top three markdown backlog items. Which
// meant a Jira or ADO project — most team projects — got run frontmatter and nothing
// else, and NO project got any sense of what had been happening. A session could not see
// that a replan re-cut the schedule yesterday, that a PR had come back with comments, or
// that the last consult already settled the question about to be asked again.
//
// What it says now, in priority order, because this is context-window budget and the
// cheapest line has to be the most useful one:
//   1. what needs a human       — blocked runs, PRs awaiting the author
//   2. what is in flight        — active runs, and the wave they belong to
//   3. what is next             — the last board snapshot, whatever the tracker
//   4. what just happened       — the journal tail
//   5. what is stale            — a config or an adoption scan left behind
//
// Hard budget: MAX_LINES. D5 caps always-loaded context for a reason, and a snapshot
// that costs more than it saves is a net loss. Everything is truncated, never paged.
//
// Silent when the cwd is not an AIDLC project. Never throws: a context snapshot is not
// worth breaking a session over, and every section is independently guarded so one bad
// file cannot cost the others.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { frontmatter, readRuns } from "./lib/run-files.mjs";
import { tail, latest } from "../../skills/journal/journal.mjs";

const MAX_LINES = 14;

let data = {};
try {
  data = JSON.parse(readFileSync(0, "utf8"));
} catch {
  /* fall through with empty */
}
const cwd = data.cwd || process.cwd();

const lines = [];
const section = (fn) => {
  try {
    fn();
  } catch {
    /* one bad file must not cost the other sections */
  }
};

let cfg = null;
section(() => {
  cfg = JSON.parse(readFileSync(join(cwd, ".claude", "aidlc.config.json"), "utf8"));
});

// --- 1+2. Runs: blocked first, because that is the only class needing a human now -------
section(() => {
  const runs = readRuns(cwd, (r) => r.phase && r.phase !== "done");
  if (!runs.length) return;
  const blocked = runs.filter((r) => r.phase === "blocked");
  const active = runs.filter((r) => r.phase !== "blocked");
  const fmt = (r) =>
    `- ${r.item} [${r.phase}]${r.repo && r.repo !== "null" ? ` repo=${r.repo}` : ""}` +
    `${r.branch ? ` branch=${r.branch}` : ""}${r.pr && r.pr !== "null" ? ` pr=${r.pr}` : ""}`;
  if (blocked.length) {
    lines.push(`⛔ Blocked — needs you (${blocked.length}):`);
    for (const r of blocked.slice(0, 3)) lines.push(fmt(r));
  }
  if (active.length) {
    lines.push(`Active AIDLC runs (${active.length}):`);
    for (const r of active.slice(0, 3)) lines.push(fmt(r));
    if (active.length > 3) lines.push(`  …and ${active.length - 3} more — /aidlc:status`);
  }
});

// --- 2b. The wave schedule, when one is in force ------------------------------------------
// `/aidlc:next` and `/aidlc:sprint` FOLLOW this, so a session that cannot see it cannot
// explain why the pipeline picked what it picked.
section(() => {
  const p = join(cwd, ".aidlc", "plan.md");
  if (!existsSync(p)) return;
  const fm = frontmatter(p);
  if (fm) lines.push(`Execution plan: ${fm.waves ?? "?"} waves, cut ${fm.plan ?? "?"}${fm.cutBy ? ` by ${fm.cutBy}` : ""} — /aidlc:status`);
});

// --- 3. What is next. Tracker-agnostic: the last `board` line the journal recorded. -------
// The markdown scan below only works for one of three adapters; the journal snapshot
// works for all of them and carries its own timestamp, so staleness is visible rather
// than assumed.
section(() => {
  const b = latest(cwd, "board");
  if (b) {
    lines.push(`Board (as of ${b.at}): ${b.summary}`);
    return;
  }
  const itemsDir = join(cwd, "backlog", "items");
  if (!existsSync(itemsDir)) return;
  const ready = readdirSync(itemsDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => frontmatter(join(itemsDir, f)))
    .filter(Boolean)
    .filter((i) => i.status === "todo")
    .sort((a, b2) => (a.priority || "P4").localeCompare(b2.priority || "P4"));
  if (ready.length) {
    lines.push(`Ready backlog items (${ready.length} todo):`);
    for (const i of ready.slice(0, 2)) lines.push(`- ${i.id} [${i.priority || "?"}, ${i.type}] ${i.title}`);
  }
});

// --- 4. What just happened ------------------------------------------------------------------
section(() => {
  const recent = tail(cwd, 4).filter((e) => e.kind !== "board");
  if (!recent.length) return;
  lines.push("Recently:");
  for (const e of recent.slice(-3)) lines.push(`- ${e.at} ${e.kind}: ${e.summary}`);
});

// --- 5. Staleness worth one line ---------------------------------------------------------------
section(() => {
  if (!cfg) return;
  if (cfg.architecture?.resolvedBy === "codebase-scan" && !cfg.adoption)
    lines.push("Note: config says it came from a scan but records no adoption commit — /aidlc:doctor");
});

if (lines.length) {
  lines.push("/aidlc:status for the board · /aidlc:run <ID> to resume · /aidlc:doctor if commands misbehave");
  process.stdout.write(lines.slice(0, MAX_LINES).join("\n"));
}
process.exit(0);
