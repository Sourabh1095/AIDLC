#!/usr/bin/env node
// Project facts — the operational truths this pipeline keeps relearning.
//
//   node facts.mjs add   <root> <area> "<fact>" [--ref PROJ-119] [--stale-days 90]
//   node facts.mjs list  <root> [area] [--stale-days 90]
//   node facts.mjs stale <root> [--stale-days 90]
//
// The gap this fills, stated precisely, because the framework already has four kinds of
// memory and adding a fifth needs a reason:
//
//   aidlc.config.json   machine-readable settings           — what the project IS
//   docs/adr/           decisions                           — WHY the code is like this
//   .aidlc/journal.md   events                              — WHAT HAPPENED, when
//   .aidlc/runs/        per-item pipeline state             — one item, in depth
//   CLAUDE.md           always-loaded facts, capped ~40 ln  — the handful worth every token
//
// None of them holds *"the integration suite hangs unless `docker compose up db` ran
// first"*. That is not a decision, not an event, not a setting, and not important enough
// to spend always-loaded context on — but it costs twenty minutes every time somebody
// rediscovers it. `run` §Plugin-self-feedback already names the symptom exactly: "a
// per-run step you had to save to memory because the plugin didn't encode it". That
// routes plugin gaps to the dogfood inbox and leaves PROJECT gaps with nowhere to go.
//
// Two properties are the whole reason this is code rather than a markdown convention:
//
//   DEDUP     — a facts file dies by accumulating near-duplicates until nobody reads it.
//               An exact restatement REFRESHES the date instead of appending; a similar
//               one is appended but FLAGGED, because auto-merging two facts that merely
//               look alike loses one of them silently.
//   STALENESS — a fact carries the date it was last verified, and `list`/`stale` compute
//               the age. An unverified 8-month-old fact about a codebase that has moved
//               is not neutral, it is confidently wrong, and the only defence is making
//               the age impossible to miss.
//
// Never throws. Losing a fact is not worth losing the work that discovered it.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

/** Closed set, so the file stays greppable and a reader can load only what they need. */
export const AREAS = new Set([
  "environment", // what must be running, installed or exported before anything works
  "gates", //       verification quirks: what is slow, flaky, or lies about success
  "tracker", //     board behaviour the adapter cannot infer
  "codebase", //    non-obvious truths about the code that reading one file will not reveal
  "process", //     team conventions that are real but live in nobody's config
]);

export const DEFAULT_STALE_DAYS = 90;
export const factsPath = (root) => join(root, ".aidlc", "facts.md");

const HEADER = `# Project facts

Operational truths this project keeps relearning — what must be running before the tests pass, which
gate lies about success, which board rejects which transition. Not decisions (those are ADRs), not
events (that is the journal), not settings (that is aidlc.config.json).

**Every fact carries the date it was last verified.** A fact without provenance is a rumour, and a
stale one is worse than none because it is confidently wrong. Re-verify or delete; never leave a fact
sitting past its usefulness.

Tracked in git. Written by the /aidlc:* commands when they learn something the hard way.
`;

const isoDate = (d = new Date()) => d.toISOString().slice(0, 10);

/** Normalize for comparison: case, punctuation and whitespace are not the fact. */
const normalize = (s) =>
  String(s)
    .toLowerCase()
    .replace(/`|"|'/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

// Overlap coefficient — shared words over the SMALLER set — not Jaccard.
//
// Measured, not assumed: "the e2e suite is flaky under parallelism" vs "the e2e suite is
// flaky when run with parallelism enabled" is a textbook restatement and scores Jaccard
// 0.50, because Jaccard divides by the union and so punishes one sentence being wordier
// than the other. That is exactly the case this check exists to catch. Overlap scores it
// 0.83, because the question being asked is "is the shorter fact contained in the longer
// one", not "are these the same length".
//
// Sets under 3 content words are skipped: at that size any shared word swamps the ratio
// and everything looks similar to everything.
//
// KNOWN LIMITATION, pinned by a test rather than left to surprise someone: word overlap
// cannot see synonyms or numerals. "the core-api build is ~11 min" and "core-api builds
// take about eleven minutes" are the same fact and score 0.50, because `min`/`minutes`
// and `~11`/`eleven` share no characters. Plural stemming below closes the easy half
// (`build`/`builds`); the rest is not solvable without a vocabulary, and guessing harder
// would mean flagging unrelated facts, which costs more than it saves. The real defence
// is cheap and human: `aidlc:facts` tells the writer to LIST the area before adding, and
// an area is short enough to read.
function similarity(a, b) {
  // Naive plural stripping — `windows`→`window`, `builds`→`build`. Deliberately not a
  // stemmer: a real one would need a dependency, and this catches the common case.
  const stem = (w) => (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
  const words = (s) => new Set(normalize(s).split(" ").filter((w) => w.length > 2).map(stem));
  const A = words(a);
  const B = words(b);
  const smaller = Math.min(A.size, B.size);
  if (smaller < 3) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared / smaller;
}

const LINE = /^- (.*?)\s+·\s+verified (\d{4}-\d{2}-\d{2})(?:\s+·\s+(.*))?$/;

/** Every fact, with its area, verified date and age in days. */
export function list(root, { now = new Date(), staleDays = DEFAULT_STALE_DAYS } = {}) {
  let text;
  try {
    text = readFileSync(factsPath(root), "utf8");
  } catch {
    return [];
  }
  const out = [];
  let area = null;
  for (const raw of text.split(/\r?\n/)) {
    const h = /^##\s+(\S+)/.exec(raw);
    if (h) {
      area = h[1];
      continue;
    }
    const m = LINE.exec(raw.trim());
    if (!m || !area) continue;
    const ageDays = Math.floor((now - new Date(m[2] + "T00:00:00Z")) / 86400000);
    out.push({ area, text: m[1], verified: m[2], ref: m[3] || null, ageDays, stale: ageDays > staleDays });
  }
  return out;
}

/** Facts past the staleness threshold, oldest first. */
export const stale = (root, opts = {}) =>
  list(root, opts)
    .filter((f) => f.stale)
    .sort((a, b) => b.ageDays - a.ageDays);

/**
 * Record a fact.
 * Returns { action: "added"|"refreshed"|"rejected", fact?, similar?[] }.
 *  - an EXACT restatement refreshes the verified date (and the ref) in place
 *  - a SIMILAR one is added, with the near-matches returned so the caller can say so
 */
export function add(root, area, text, { ref = null, now = new Date(), similarAt = 0.7 } = {}) {
  try {
    if (!AREAS.has(area)) return { action: "rejected", reason: `unknown area '${area}'` };
    const clean = String(text ?? "").replace(/\s+/g, " ").trim();
    if (!clean) return { action: "rejected", reason: "empty fact" };
    if (clean.includes("·")) return { action: "rejected", reason: "a fact may not contain '·' — it is the field separator" };

    const existing = list(root, { now });
    const exact = existing.find((f) => f.area === area && normalize(f.text) === normalize(clean));
    const similar = existing.filter((f) => f !== exact && similarity(f.text, clean) >= similarAt).map((f) => f.text);

    const line = (t, r) => `- ${t}  ·  verified ${isoDate(now)}${r ? `  ·  ${r}` : ""}`;
    const p = factsPath(root);
    mkdirSync(dirname(p), { recursive: true });
    let doc = existsSync(p) ? readFileSync(p, "utf8") : HEADER;

    if (exact) {
      // Refresh in place. Re-learning a fact is EVIDENCE it is still true, which is the
      // single most valuable thing that can happen to a facts file — appending a second
      // copy instead would turn that evidence into clutter.
      const old = new RegExp(`^- ${exact.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+·\\s+verified .*$`, "m");
      doc = doc.replace(old, line(exact.text, ref ?? exact.ref));
      writeFileSync(p, doc);
      return { action: "refreshed", fact: exact.text, previous: exact.verified, similar };
    }

    const heading = `## ${area}`;
    if (!doc.includes(heading)) doc = doc.replace(/\s*$/, "\n\n") + heading + "\n" + line(clean, ref) + "\n";
    else {
      // Append under the existing heading, after its last entry.
      const lines = doc.split(/\r?\n/);
      let i = lines.findIndex((l) => l.trim() === heading);
      let last = i;
      for (let j = i + 1; j < lines.length; j++) {
        if (/^##\s/.test(lines[j])) break;
        if (lines[j].trim()) last = j;
      }
      lines.splice(last + 1, 0, line(clean, ref));
      doc = lines.join("\n");
    }
    writeFileSync(p, doc);
    return { action: "added", fact: clean, similar };
  } catch (e) {
    return { action: "rejected", reason: e.message };
  }
}

// --- CLI ---------------------------------------------------------------------------------------
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  const argv = process.argv.slice(2);
  const flag = (name, dflt = null) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : dflt;
  };
  const positional = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--ref" && argv[i - 1] !== "--stale-days");
  const [cmd, root, ...rest] = positional;
  const at = root || process.cwd();
  const staleDays = Number(flag("--stale-days", DEFAULT_STALE_DAYS));

  if (cmd === "add") {
    const r = add(at, rest[0], rest.slice(1).join(" "), { ref: flag("--ref") });
    if (r.action === "rejected") process.stderr.write(`facts: ${r.reason}. Areas: ${[...AREAS].join(", ")}\n`);
    else {
      process.stdout.write(`${r.action}: ${r.fact}${r.previous ? ` (was verified ${r.previous})` : ""}\n`);
      for (const s of r.similar ?? []) process.stdout.write(`  ! looks similar to an existing fact: ${s}\n`);
    }
  } else if (cmd === "list") {
    const area = rest[0];
    for (const f of list(at, { staleDays })) {
      if (area && f.area !== area) continue;
      process.stdout.write(`[${f.area}] ${f.text}  (verified ${f.verified}, ${f.ageDays}d${f.stale ? " — STALE" : ""})\n`);
    }
  } else if (cmd === "stale") {
    const s = stale(at, { staleDays });
    if (!s.length) process.stdout.write(`no facts unverified for more than ${staleDays} days\n`);
    for (const f of s) process.stdout.write(`[${f.area}] ${f.text}  (verified ${f.verified}, ${f.ageDays}d)\n`);
  } else process.stderr.write("usage: facts.mjs add|list|stale <root> …\n");
  process.exit(0);
}
