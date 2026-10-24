// Tests for insights.mjs. Run: `node insights.test.mjs`.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { categoryOf, parseRun, collectRuns, summarize, render, reviewThemes } from "./insights.mjs";

let n = 0, fails = 0;
function check(label, actual, expected) {
  n++;
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`ok    ${label}`); return; }
  fails++;
  console.log(`FAIL  ${label}\n      expected ${e}\n      actual   ${a}`);
}

check("categories", ["reuse", "review(@priya) src/a.ts", "reviewer", "qa", "security", "jury (round cap", "coverage hole"].map(categoryOf),
  ["reuse", "human review", "agent review", "qa", "security", "design", "gate hole"]);

const runFile = (item, phase, fix, rounds, findings, log, archived = false) => `---
item: ${item}
type: story
phase: ${phase}
fixCycles: ${fix}
reviewRounds: ${rounds}
started: ${log[0][0]}
updated: ${log[log.length - 1][0]}
---

## Item snapshot

## Findings
${findings.join("\n")}

## Log
${log.map(([t, s]) => `- ${t} ${s}`).join("\n")}
`;

const r1 = runFile("PROJ-1", "done", 1, 1,
  [
    "- [MAJOR][resolved] reuse: src/orders.ts:10-30 repeats src/users.ts:8-28",
    "- [MAJOR][resolved] review(@priya) src/a.ts:4 — use the shared helper · thread:X",
    "- [MINOR][open] reviewer: src/a.ts:9 — naming",
    "coverage hole: no lint gate in web (recorded absent at adoption)",
  ],
  [["2026-09-01T09:00Z", "phase start → requirements"], ["2026-09-01T09:30Z", "phase requirements → design"], ["2026-09-01T10:00Z", "phase design → implement"], ["2026-09-01T12:00Z", "phase implement → verify"], ["2026-09-01T13:00Z", "phase verify → done"]],
);
const parsed = parseRun(r1, { item: "PROJ-1", type: "story", phase: "done", fixCycles: "1", reviewRounds: "1", started: "2026-09-01T09:00Z", updated: "2026-09-01T13:00Z" });
check("findings parsed with category and severity", parsed.findings.map((f) => [f.category, f.severity]),
  [["reuse", "MAJOR"], ["human review", "MAJOR"], ["agent review", "MINOR"], ["gate hole", "NOTE"]]);
check("elapsed hours", parsed.hours, 4);
check("hours per phase from the log", parsed.phaseHours, { requirements: 0.5, design: 0.5, implement: 2, verify: 1 });
{
  const withDispatch = parseRun("## Log\n- 2026-09-01T10:00Z dispatch aidlc-implementer effort=medium\n- 2026-09-01T11:00Z dispatch aidlc-reviewer effort=high\n", { item: "X" });
  check("dispatch lines carry the effort", withDispatch.dispatches, [{ agent: "aidlc-implementer", effort: "medium" }, { agent: "aidlc-reviewer", effort: "high" }]);
  const s2 = summarize([{ ...withDispatch, item: "X", phase: "done", findings: [], fixCycles: 0, reviewRounds: 0 }]);
  check("effort totals by level", s2.effort.byLevel, { medium: 1, high: 1 });
  check("render shows the effort line", render(s2).includes("agent dispatches by effort: medium 1 · high 1"), true);
}

// A workspace: one archived done run, one blocked, one live; the archived copy of PROJ-1 wins.
const ws = mkdtempSync(join(tmpdir(), "insights-"));
mkdirSync(join(ws, ".aidlc", "runs", "archive"), { recursive: true });
writeFileSync(join(ws, ".aidlc", "runs", "archive", "PROJ-1.md"), r1);
writeFileSync(join(ws, ".aidlc", "runs", "PROJ-1.md"), runFile("PROJ-1", "verify", 0, 0, [], [["2026-09-01T09:00Z", "phase start → requirements"]]));
writeFileSync(join(ws, ".aidlc", "runs", "PROJ-2.md"), runFile("PROJ-2", "blocked", 2, 0, ["- [BLOCKER][open] reuse: x repeats y"], [["2026-10-02T09:00Z", "phase start → requirements"], ["2026-10-02T11:00Z", "phase verify → blocked"]]));
writeFileSync(join(ws, ".aidlc", "runs", "PROJ-3.md"), runFile("PROJ-3", "implement", 0, 0, [], [["2026-10-03T09:00Z", "phase start → requirements"]]));

const runs = collectRuns(ws);
check("runs deduplicated, archive wins", runs.map((r) => [r.item, r.phase]).sort(), [["PROJ-1", "done"], ["PROJ-2", "blocked"], ["PROJ-3", "implement"]]);
const s = summarize(runs);
check("counts", [s.runs, s.done, s.blocked, s.inFlight], [3, 1, 1, 1]);
check("median time to done", s.medianHoursToDone, 4);
check("fix cycles per run", s.meanFixCycles, 1);
check("reuse findings counted across runs", s.categories.reuse, { total: 2, blockerOrMajor: 2, runs: 2 });
check("by month", Object.keys(s.byMonth), ["2026-09", "2026-10"]);
check("signals name the duplication", s.signals.some((x) => /duplication in 2\/3 runs/.test(x)), true);
check("--since filters by start", summarize(runs, { since: "2026-10-01" }).runs, 2);
check("render leads with the counts", render(s).split("\n")[0], "AIDLC insights — 3 run(s): 1 done · 0 awaiting review · 1 blocked · 1 in flight");
check("an empty workspace renders one line", render(summarize([])).trim().split("\n").length, 1);

// ---- what human reviewers keep asking for
{
  const fake = (item, texts) => ({ item, findings: texts.map((t) => ({ category: "human review", text: t })) });
  const runs2 = [
    fake("PROJ-10", ["use the project logger instead of console.log"]),
    fake("PROJ-11", ["console.log again — we have a logger for this", "rename this variable"]),
    fake("PROJ-12", ["please use our `logger` util"]),
    { item: "PROJ-13", findings: [{ category: "agent review", text: "logger missing" }] },
  ];
  const themes = reviewThemes(runs2);
  check("a comment recurring in 3 runs is a theme", themes[0] && [themes[0].word, themes[0].runs.length], ["logger", 3]);
  check("agent findings do not count", themes[0].runs.includes("PROJ-13"), false);
  check("a one-off comment is not a theme", themes.some((t) => t.word === "rename"), false);
  check("finding text is parsed without location or thread", parseRun("## Findings\n- [MAJOR][open] review(@a) src/x.ts:4 — use the logger · thread:PRRT_1\n", { item: "X" }).findings[0].text, "use the logger");
}

rmSync(ws, { recursive: true, force: true });
console.log(`\n${n - fails}/${n} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
