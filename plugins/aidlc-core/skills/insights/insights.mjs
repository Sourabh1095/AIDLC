#!/usr/bin/env node
// What the pipeline actually produced: outcome metrics from the run files.
//
//   node insights.mjs <workspace-root> [--since YYYY-MM-DD] [--json]
//   node insights.mjs <workspace-root> --themes [--json]     → what human reviewers keep asking for
//
// Every run file already records what this needs — its type, its fix cycles and human review rounds,
// every finding with a severity and a source, and a timestamped log — and every finished run is kept
// in runs/archive/. Nothing aggregated it, so there was no way to tell whether a change to the
// pipeline (reuse-first planning, a reviewer cadence, a prompt rewrite) made things better or worse.
// "Cycle-time review" was promised in the user guide and computed by nothing.
//
// Reads, never writes. Poly-aware: the control plane, every repo, their worktrees, and each one's
// archive (shared with the hooks through run-files.mjs).
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { frontmatter, runDirs, WAITING_ON_HUMAN } from "../../hooks/scripts/lib/run-files.mjs";
import { isMain as isEntry } from "../../hooks/scripts/lib/cli.mjs";

// Where a finding came from, from the text before its first colon. The categories are the questions
// worth asking: is the code duplicating things, are humans catching what agents missed, is the gate
// honest about what it cannot check.
export function categoryOf(source) {
  const s = source.trim().toLowerCase();
  if (s.startsWith("reuse")) return "reuse";
  if (s.startsWith("review(")) return "human review";
  if (s.startsWith("reviewer")) return "agent review";
  if (s.startsWith("qa")) return "qa";
  if (s.startsWith("security")) return "security";
  if (s.startsWith("jury") || s.startsWith("fidelity")) return "design";
  if (s.startsWith("coverage hole")) return "gate hole";
  return "other";
}

const FINDING_RE = /^\s*-\s*\[(BLOCKER|MAJOR|MINOR)\]\[(open|resolved|re-opened)[^\]]*\]\s*([^:—]+?)[:—](.*)$/i;
const STAMP_RE = /^\s*-\s*(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?Z?)\s+(.*)$/;

const toDate = (s) => {
  if (!s) return null;
  const d = new Date(/Z$|[+-]\d\d:?\d\d$/.test(s) ? s : s + "Z");
  return isNaN(d) ? null : d;
};

// The body of `## <name>`, up to the next `## ` heading or the end of the file.
function section(text, name) {
  const lines = String(text).split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === `## ${name}`);
  if (start < 0) return "";
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n");
}

// One run file → the facts the metrics need.
export function parseRun(text, fm) {
  const findings = [];
  for (const line of section(text, "Findings").split(/\r?\n/)) {
    const m = line.match(FINDING_RE);
    if (m)
      findings.push({
        severity: m[1].toUpperCase(),
        state: m[2].toLowerCase(),
        category: categoryOf(m[3]),
        // What was said, without the location and the thread id — the part a theme is made of.
        // The format is `<source> <file:line> — <what and why>`, so the text is what follows the dash.
        text: (m[4].includes("—") ? m[4].slice(m[4].indexOf("—") + 1) : m[4]).replace(/·\s*thread:\S+/g, "").trim(),
      });
    else if (/coverage hole/i.test(line)) findings.push({ severity: "NOTE", state: "open", category: "gate hole" });
  }
  const stamps = [];
  const phases = [];
  const dispatches = [];
  for (const line of section(text, "Log").split(/\r?\n/)) {
    const m = line.match(STAMP_RE);
    if (!m) continue;
    const at = toDate(m[1]);
    if (!at) continue;
    stamps.push(at);
    const d = m[2].match(/^dispatch\s+(\S+)\s+effort=(\S+)/);
    if (d) dispatches.push({ agent: d[1], effort: d[2] });
    const p = m[2].match(/(?:phase\b[^→]*)?→\s*([a-z-]+)/i);
    if (p) phases.push({ at, phase: p[1].toLowerCase() });
  }
  const started = toDate(fm.started) || stamps[0] || null;
  const ended = toDate(fm.updated) || stamps[stamps.length - 1] || null;
  const phaseHours = {};
  for (let i = 0; i < phases.length - 1; i++) {
    const h = (phases[i + 1].at - phases[i].at) / 36e5;
    if (h >= 0) phaseHours[phases[i].phase] = (phaseHours[phases[i].phase] || 0) + h;
  }
  return {
    item: fm.item,
    type: fm.type || "?",
    repo: fm.repo && fm.repo !== "null" ? fm.repo : null,
    phase: fm.phase || "?",
    fixCycles: Number(fm.fixCycles) || 0,
    reviewRounds: Number(fm.reviewRounds) || 0,
    started,
    ended,
    hours: started && ended ? (ended - started) / 36e5 : null,
    phaseHours,
    findings,
    dispatches,
  };
}

// Every run file, live and archived, deduplicated by item (the archived copy wins: it is final).
export function collectRuns(root) {
  const byItem = new Map();
  for (const dir of runDirs(root)) {
    for (const d of [dir, join(dir, "archive")]) {
      if (!existsSync(d)) continue;
      for (const f of readdirSync(d).filter((x) => x.endsWith(".md"))) {
        const p = join(d, f);
        const fm = frontmatter(p);
        if (!fm || !fm.item) continue;
        let text = "";
        try {
          text = readFileSync(p, "utf8");
        } catch {
          continue;
        }
        const run = { ...parseRun(text, fm), archived: d.endsWith("archive") };
        if (!byItem.has(run.item) || run.archived) byItem.set(run.item, run);
      }
    }
  }
  return [...byItem.values()];
}

const median = (xs) => {
  const s = xs.filter((x) => x != null).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round = (x, d = 1) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

export function summarize(runs, { since } = {}) {
  const sinceDate = since ? toDate(since + "T00:00:00Z") : null;
  const rs = runs.filter((r) => !sinceDate || (r.started && r.started >= sinceDate));
  const done = rs.filter((r) => r.phase === "done");
  const abandoned = rs.filter((r) => r.phase === "abandoned");
  const blocked = rs.filter((r) => r.phase === "blocked");
  const waiting = rs.filter((r) => WAITING_ON_HUMAN.has(r.phase) && r.phase !== "blocked");
  const byCategory = {};
  for (const r of rs)
    for (const f of r.findings) {
      const c = (byCategory[f.category] ??= { total: 0, blockerOrMajor: 0, runs: new Set() });
      c.total++;
      if (f.severity === "BLOCKER" || f.severity === "MAJOR") c.blockerOrMajor++;
      c.runs.add(r.item);
    }
  const categories = Object.fromEntries(
    Object.entries(byCategory)
      .sort((a, b) => b[1].total - a[1].total)
      .map(([k, v]) => [k, { total: v.total, blockerOrMajor: v.blockerOrMajor, runs: v.runs.size }]),
  );
  const phaseTotals = {};
  for (const r of done) for (const [p, h] of Object.entries(r.phaseHours)) (phaseTotals[p] ??= []).push(h);
  const months = {};
  for (const r of rs) {
    if (!r.started) continue;
    const k = r.started.toISOString().slice(0, 7);
    const m = (months[k] ??= { runs: 0, fixCycles: 0, reuse: 0, humanReview: 0 });
    m.runs++;
    m.fixCycles += r.fixCycles;
    m.reuse += r.findings.filter((f) => f.category === "reuse").length;
    m.humanReview += r.findings.filter((f) => f.category === "human review").length;
  }
  const s = {
    runs: rs.length,
    done: done.length,
    blocked: blocked.length,
    awaitingReview: waiting.length,
    abandoned: abandoned.length,
    inFlight: rs.length - done.length - abandoned.length - blocked.length - waiting.length,
    medianHoursToDone: round(median(done.map((r) => r.hours))),
    meanFixCycles: round(rs.length ? rs.reduce((n, r) => n + r.fixCycles, 0) / rs.length : null, 2),
    runsNeedingAFixCycle: rs.filter((r) => r.fixCycles > 0).length,
    runsWithHumanReviewFindings: rs.filter((r) => r.findings.some((f) => f.category === "human review")).length,
    reviewRounds: rs.reduce((n, r) => n + r.reviewRounds, 0),
    categories,
    medianHoursByPhase: Object.fromEntries(Object.entries(phaseTotals).map(([p, hs]) => [p, round(median(hs), 2)])),
    // Where the thinking budget goes (pipeline.effort): dispatches per level, and per agent.
    effort: rs.flatMap((r) => r.dispatches ?? []).reduce(
      (acc, d) => {
        acc.byLevel[d.effort] = (acc.byLevel[d.effort] || 0) + 1;
        (acc.byAgent[d.agent] ??= {})[d.effort] = (acc.byAgent[d.agent][d.effort] || 0) + 1;
        return acc;
      },
      { byLevel: {}, byAgent: {} },
    ),
    byMonth: Object.fromEntries(Object.entries(months).sort()),
  };
  s.signals = signals(s);
  return s;
}

// The few readings worth acting on, stated as what to do — numbers without a "so what" get ignored.
export function signals(s) {
  const out = [];
  if (!s.runs) return out;
  const reuse = s.categories.reuse;
  if (reuse && reuse.runs / s.runs >= 0.3)
    out.push(`duplication in ${reuse.runs}/${s.runs} runs — check that reuse.sharedPaths covers where this project keeps shared code, and read which existing code keeps being re-written`);
  const human = s.categories["human review"];
  const agent = s.categories["agent review"];
  if (human && human.total > (agent?.total ?? 0))
    out.push(`human reviewers raised more findings (${human.total}) than the review agents (${agent?.total ?? 0}) — consider pipeline.verification.reviewer: per-item, and turn repeated comments into rules`);
  if (s.meanFixCycles != null && s.meanFixCycles >= 1.5)
    out.push(`${s.meanFixCycles} fix cycles per run on average — plans may be too coarse, or the gate is catching what planning should have`);
  if (s.blocked / s.runs >= 0.2) out.push(`${s.blocked}/${s.runs} runs blocked — read their ## Findings for a common cause`);
  if (s.categories["gate hole"]) out.push(`${s.categories["gate hole"].runs} run(s) reported gate coverage holes — the project cannot verify something every time`);
  return out;
}

// Words that say nothing about WHAT a reviewer asked for.
const THEME_STOP = new Set(
  ("this that with from have should would could please here there into when then than they them their " +
    "also just like make made more less some only same each every other which what where while because " +
    "about does done dont isnt cant need needs file line code change changes instead using used else").split(" "),
);
const themeWords = (text) =>
  new Set(
    String(text)
      .toLowerCase()
      .replace(/`[^`]*`/g, (m) => m.replace(/[^a-z0-9]+/g, " "))
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4 && !THEME_STOP.has(w))
      .map((w) => w.replace(/(ing|ed|es|s)$/, "")),
  );

/**
 * What human reviewers keep asking for: words that recur in human-review findings across at least
 * `minRuns` different runs, with the findings that carry them. A comment made once is a review; made in
 * three runs it is a project convention nobody wrote down — the thing to turn into a rule, a fact or a
 * lint rule, so the next run does not need a person to say it again.
 */
export function reviewThemes(runs, { minRuns = 2, limit = 8 } = {}) {
  const byWord = new Map();
  for (const r of runs)
    for (const f of r.findings) {
      if (f.category !== "human review" || !f.text) continue;
      for (const w of themeWords(f.text)) {
        if (!byWord.has(w)) byWord.set(w, { runs: new Set(), examples: [] });
        const t = byWord.get(w);
        t.runs.add(r.item);
        if (t.examples.length < 3) t.examples.push(`${r.item}: ${f.text}`);
      }
    }
  return [...byWord.entries()]
    .filter(([, t]) => t.runs.size >= minRuns)
    .sort((a, b) => b[1].runs.size - a[1].runs.size || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word, t]) => ({ word, runs: [...t.runs], examples: t.examples }));
}

export function renderThemes(themes) {
  if (!themes.length) return "No review comment recurs across runs yet.\n";
  const out = ["What human reviewers keep asking for (recurring across runs):"];
  for (const t of themes) {
    out.push(`  "${t.word}" — ${t.runs.length} runs (${t.runs.join(", ")})`);
    for (const e of t.examples) out.push(`      ${e.slice(0, 140)}`);
  }
  return out.join("\n") + "\n";
}

export function render(s) {
  const lines = [];
  lines.push(`AIDLC insights — ${s.runs} run(s): ${s.done} done · ${s.awaitingReview} awaiting review · ${s.blocked} blocked · ${s.inFlight} in flight${s.abandoned ? ` · ${s.abandoned} undone` : ""}`);
  if (!s.runs) return lines.join("\n") + "\n";
  lines.push(`  median time to done: ${s.medianHoursToDone ?? "?"} h · fix cycles/run: ${s.meanFixCycles} (${s.runsNeedingAFixCycle} needed one) · human review rounds: ${s.reviewRounds}`);
  const ph = Object.entries(s.medianHoursByPhase);
  if (ph.length) lines.push(`  median hours by phase: ${ph.map(([p, h]) => `${p} ${h}`).join(" · ")}`);
  const ef = ["low", "medium", "high", "xhigh", "max"].filter((l) => s.effort?.byLevel[l]);
  if (ef.length) lines.push(`  agent dispatches by effort: ${ef.map((l) => `${l} ${s.effort.byLevel[l]}`).join(" · ")}`);
  lines.push("", "Findings by source:");
  for (const [k, v] of Object.entries(s.categories)) lines.push(`  ${k.padEnd(14)} ${String(v.total).padStart(4)} total · ${String(v.blockerOrMajor).padStart(3)} blocker/major · in ${v.runs} run(s)`);
  const months = Object.entries(s.byMonth);
  if (months.length > 1) {
    lines.push("", "By month (runs · fix cycles · reuse findings · human-review findings):");
    for (const [m, v] of months) lines.push(`  ${m}  ${v.runs} · ${v.fixCycles} · ${v.reuse} · ${v.humanReview}`);
  }
  if (s.signals.length) {
    lines.push("", "Worth acting on:");
    for (const x of s.signals) lines.push(`  - ${x}`);
  }
  return lines.join("\n") + "\n";
}

if (isEntry(import.meta.url)) {
  const argv = process.argv.slice(2);
  const root = argv[0] && !argv[0].startsWith("--") ? resolve(argv[0]) : process.cwd();
  const i = argv.indexOf("--since");
  const runs = collectRuns(root);
  if (argv.includes("--themes")) {
    const themes = reviewThemes(runs);
    if (argv.includes("--json")) console.log(JSON.stringify(themes, null, 2));
    else process.stdout.write(renderThemes(themes));
  } else {
    const s = summarize(runs, { since: i >= 0 ? argv[i + 1] : undefined });
    if (argv.includes("--json")) console.log(JSON.stringify(s, null, 2));
    else process.stdout.write(render(s));
  }
}
