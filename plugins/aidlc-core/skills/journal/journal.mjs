#!/usr/bin/env node
// The workspace journal — one line per thing that happened, at the control plane.
//
//   node journal.mjs append <root> <kind> <summary…>
//   node journal.mjs tail   <root> [n]
//   node journal.mjs latest <root> <kind>
//
// Why this exists. Run files are excellent per-item memory and useless as project memory:
// each records one item in depth, they are committed to feature branches, and completed
// ones move to archive/. So nothing could answer "what has been happening here" — the
// question every new session actually opens with. A session could see which runs were
// in flight and the top three markdown backlog items, and that was the whole of it. It
// could not see that a replan re-cut the schedule yesterday, that six direct fixes
// landed on main, or that the last consult concluded billing does NOT belong in the API
// repo — and it would happily re-litigate that conclusion from scratch.
//
// The design constraint that shapes everything below: this is read at SessionStart, into
// a context window, on every session. So it is ONE line per event, it is bounded, and
// reading the tail must never require parsing the whole history. A memory system that
// costs more context than it saves is a net loss, and the framework's own D5 caps
// always-loaded context at ~120 lines for exactly that reason.
//
// Never throws. A journal that breaks a run is worse than no journal at all.
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";

/** Rotate once the file passes this many entries. Keeps the tail read cheap forever. */
export const MAX_ENTRIES = 500;

/** The kinds a journal line may carry. A closed set so the file stays greppable and the
 *  SessionStart reader can prioritise — an open vocabulary degrades into prose. */
export const KINDS = new Set([
  "run", //      a pipeline run reached a terminal state
  "direct", //   a tier-1 change: edited, gated, committed, no item
  "tracked", //  a tier-2 change: branch + run file, no ticket
  "consult", //  a /aidlc:do CONSULT and what it concluded
  "decision", // something settled that is not big enough for an ADR
  "replan", //   the delivery order changed
  "board", //    a backlog snapshot — the tracker-agnostic answer to "what's next"
  "adopt", //    a scan or an adopt-apply landed
  "upgrade", //  the project caught up with a plugin version
  "release", //  a version was cut
  "blocked", //  a run stopped and needs a human
]);

export const journalPath = (root) => join(root, ".aidlc", "journal.md");
const archiveDir = (root) => join(root, ".aidlc", "journal-archive");

const HEADER = `# AIDLC journal

Append-only. One line per event, newest last. Written by the /aidlc:* commands at the
moment they finish something; read back at session start so a new session opens knowing
what has been happening rather than cold.

This file is durable project memory and is TRACKED in git. Rotates automatically.

| when (UTC) | kind | what |
`;

/** ISO-8601 UTC to the minute, matching the run-file frontmatter convention. */
export const stamp = (now = new Date()) => now.toISOString().replace(/:\d{2}\.\d+Z$/, "Z");

/** Parse one line → {at, kind, summary} or null. */
export function parseEntry(line) {
  const m = /^- (\S+)\s+`([a-z]+)`\s+(.*)$/.exec(line.trim());
  return m ? { at: m[1], kind: m[2], summary: m[3].trim() } : null;
}

/** Every entry, oldest first. Missing/unreadable file → []. */
export function readEntries(root) {
  try {
    return readFileSync(journalPath(root), "utf8").split(/\r?\n/).map(parseEntry).filter(Boolean);
  } catch {
    return [];
  }
}

/** The last `n` entries, oldest first. `n <= 0` is empty — note `slice(-0)` is `slice(0)`,
 *  which returns the WHOLE file, so the guard has to come before the slice. */
export const tail = (root, n = 5) => (n > 0 ? readEntries(root).slice(-n) : []);

/** The most recent entry of a kind, or null. */
export function latest(root, kind) {
  const all = readEntries(root);
  for (let i = all.length - 1; i >= 0; i--) if (all[i].kind === kind) return all[i];
  return null;
}

/**
 * Append one entry. Returns the line written, or null if it was rejected/failed —
 * callers must treat a null as "carry on", never as an error worth stopping for.
 *
 * Summaries are collapsed to a single line on purpose. A journal entry is a POINTER:
 * the depth lives in the run file, the ADR or the git history, and duplicating it here
 * would make the file expensive to read at exactly the moment context is scarcest.
 */
export function append(root, kind, summary, { now = new Date(), maxEntries = MAX_ENTRIES } = {}) {
  try {
    if (!KINDS.has(kind)) return null;
    const text = String(summary ?? "").replace(/\s+/g, " ").trim();
    if (!text) return null;
    const line = `- ${stamp(now)} \`${kind}\` ${text.length > 200 ? text.slice(0, 197) + "…" : text}`;

    const p = journalPath(root);
    mkdirSync(dirname(p), { recursive: true });
    if (!existsSync(p)) writeFileSync(p, HEADER);
    else if (readEntries(root).length >= maxEntries) rotate(root, now);

    appendFileSync(existsSync(journalPath(root)) ? journalPath(root) : p, line + "\n");
    return line;
  } catch {
    return null;
  }
}

/** Move the current journal aside and start a fresh one. */
function rotate(root, now) {
  try {
    const dir = archiveDir(root);
    mkdirSync(dir, { recursive: true });
    const date = stamp(now).slice(0, 10);
    let target = join(dir, `journal-${date}.md`);
    for (let i = 2; existsSync(target); i++) target = join(dir, `journal-${date}-${i}.md`);
    renameSync(journalPath(root), target);
    writeFileSync(journalPath(root), HEADER);
  } catch {
    /* rotation is housekeeping — never let it block an append */
  }
}

// --- CLI ---------------------------------------------------------------------------------
// Only when run directly. Import-safe so the SessionStart hook can use the functions
// without spawning a process.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  const [cmd, root, ...rest] = process.argv.slice(2);
  const at = root || process.cwd();
  if (cmd === "append") {
    const line = append(at, rest[0], rest.slice(1).join(" "));
    if (line) process.stdout.write(line + "\n");
    else process.stderr.write(`journal: not written (unknown kind '${rest[0]}' or empty summary). Kinds: ${[...KINDS].join(", ")}\n`);
  } else if (cmd === "tail") {
    for (const e of tail(at, Number(rest[0]) || 5)) process.stdout.write(`- ${e.at} \`${e.kind}\` ${e.summary}\n`);
  } else if (cmd === "latest") {
    const e = latest(at, rest[0]);
    if (e) process.stdout.write(`- ${e.at} \`${e.kind}\` ${e.summary}\n`);
  } else {
    process.stderr.write("usage: journal.mjs append|tail|latest <root> …\n");
  }
  process.exit(0);
}
