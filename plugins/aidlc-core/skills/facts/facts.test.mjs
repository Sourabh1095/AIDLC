// Tests for facts.mjs. Run: `node facts.test.mjs`.
//
// Weighted toward the two properties that decide whether a facts file survives contact
// with a real project: re-learning a fact must REFRESH it rather than duplicate it (a
// file of near-duplicates stops being read), and age must be impossible to miss (a stale
// fact is confidently wrong, which is worse than absent).
import { add, list, stale, factsPath, AREAS, DEFAULT_STALE_DAYS } from "./facts.mjs";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let fails = 0;
let n = 0;
const tmps = [];
function check(label, cond) {
  n++;
  if (cond) console.log(`ok    ${label}`);
  else {
    fails++;
    console.log(`FAIL  ${label}`);
  }
}
function ws() {
  const d = mkdtempSync(join(tmpdir(), "facts-"));
  tmps.push(d);
  return d;
}
const T = (iso) => new Date(iso);
const NOW = T("2026-08-02T12:00:00Z");

// --- add ------------------------------------------------------------------------------------
{
  const w = ws();
  const r = add(w, "environment", "integration tests need `docker compose up db` first", { ref: "PROJ-119", now: NOW });
  check("a fact is added", r.action === "added");
  check("it reads back", list(w, { now: NOW }).length === 1);
  const f = list(w, { now: NOW })[0];
  check("the area is recorded", f.area === "environment");
  check("the text is preserved verbatim", f.text === "integration tests need `docker compose up db` first");
  check("the ref is recorded", f.ref === "PROJ-119");
  check("the verified date is today", f.verified === "2026-08-02");
  check("a fresh fact has zero age", f.ageDays === 0 && f.stale === false);
}

// --- the closed area vocabulary ---------------------------------------------------------------
{
  const w = ws();
  check("an unknown area is rejected", add(w, "vibes", "x", { now: NOW }).action === "rejected");
  check("a rejected area writes nothing", list(w).length === 0);
  check("every documented area is accepted", [...AREAS].every((a) => add(ws(), a, "some fact", { now: NOW }).action === "added"));
}
{
  const w = ws();
  check("an empty fact is rejected", add(w, "gates", "   ", { now: NOW }).action === "rejected");
  // `·` is the field separator, so a fact containing one would produce an unparseable line.
  const r = add(w, "gates", "a · b", { now: NOW });
  check("a fact containing the separator is rejected", r.action === "rejected");
  check("the rejection explains why", r.reason.includes("separator"));
}

// --- DEDUP: re-learning refreshes, it does not duplicate -----------------------------------------
{
  const w = ws();
  add(w, "gates", "the e2e suite is flaky under parallelism", { ref: "PROJ-1", now: T("2026-01-10T00:00:00Z") });
  const again = add(w, "gates", "The e2e suite is flaky under parallelism.", { ref: "PROJ-9", now: NOW });
  check("an exact restatement refreshes rather than adds", again.action === "refreshed");
  check("only one copy exists", list(w, { now: NOW }).length === 1);
  const f = list(w, { now: NOW })[0];
  check("the verified date moved forward", f.verified === "2026-08-02");
  check("the refresh reports the previous date", again.previous === "2026-01-10");
  check("the newer ref replaces the old one", f.ref === "PROJ-9");
  check("re-learning resets the age", f.ageDays === 0);
}
{
  // Case, punctuation and whitespace are not the fact.
  const w = ws();
  add(w, "codebase", "the  auth  middleware runs BEFORE tenancy", { now: NOW });
  check(
    "normalization catches case/spacing differences",
    add(w, "codebase", "The auth middleware runs before tenancy!", { now: NOW }).action === "refreshed",
  );
  check("still one fact", list(w, { now: NOW }).length === 1);
}
{
  // A SIMILAR fact is added anyway — auto-merging two facts that merely look alike would
  // silently lose one — but the caller is told so it can ask.
  const w = ws();
  add(w, "gates", "the e2e suite is flaky under parallelism", { now: NOW });
  const r = add(w, "gates", "the e2e suite is flaky when run with parallelism enabled", { now: NOW });
  check("a similar fact is still added", r.action === "added");
  check("both are kept", list(w, { now: NOW }).length === 2);
  check("the near-duplicate is flagged to the caller", r.similar.length === 1);
  check("the flag names the existing fact", r.similar[0].includes("flaky under parallelism"));
}
{
  const w = ws();
  add(w, "gates", "the build takes eleven minutes", { now: NOW });
  const r = add(w, "environment", "postgres must be running on 5432", { now: NOW });
  check("an unrelated fact is not flagged as similar", r.similar.length === 0);
}
{
  // Plural stemming closes the easy half of the synonym problem.
  const w = ws();
  add(w, "gates", "the deploy window is thirty minutes wide", { now: NOW });
  const r = add(w, "gates", "the deploy windows are thirty minute wide", { now: NOW });
  check("plural/singular differences still match", r.similar.length === 1);
}
{
  // KNOWN LIMITATION, pinned so it is a decision rather than a surprise: word overlap
  // cannot see synonyms or numerals. These two are the SAME fact and score 0.50, because
  // min/minutes and ~11/eleven share no characters. Solving it needs a vocabulary;
  // guessing harder would flag unrelated facts. The documented defence is that
  // aidlc:facts tells the writer to list the area first — an area is short enough to read.
  const w = ws();
  add(w, "gates", "the core-api build is ~11 min; scope fan-out windows accordingly", { now: NOW });
  const r = add(w, "gates", "core-api builds take about eleven minutes so plan fan-out windows", { now: NOW });
  check("synonym-level restatement is NOT caught (KNOWN GAP)", r.similar.length === 0);
  check("both are kept, so nothing is lost by the miss", list(w, { now: NOW }).length === 2);
}
{
  // Same words, different area = a different fact. Dedup must not cross areas.
  const w = ws();
  add(w, "gates", "docker must be running", { now: NOW });
  check("the same text in another area is a separate fact", add(w, "environment", "docker must be running", { now: NOW }).action === "added");
  check("both are kept", list(w, { now: NOW }).length === 2);
}

// --- STALENESS -------------------------------------------------------------------------------------
{
  const w = ws();
  add(w, "environment", "fresh fact", { now: T("2026-07-30T00:00:00Z") });
  add(w, "gates", "old fact", { now: T("2026-01-01T00:00:00Z") });
  add(w, "tracker", "ancient fact", { now: T("2025-06-01T00:00:00Z") });
  const all = list(w, { now: NOW });
  check("age is computed in days", all.find((f) => f.text === "fresh fact").ageDays === 3);
  check("a recent fact is not stale", all.find((f) => f.text === "fresh fact").stale === false);
  check("an old fact is stale", all.find((f) => f.text === "old fact").stale === true);
  const s = stale(w, { now: NOW });
  check("stale() returns only the stale ones", s.length === 2);
  check("stale() is oldest first", s[0].text === "ancient fact");
  check("the threshold is configurable", stale(w, { now: NOW, staleDays: 3650 }).length === 0);
  check("a tighter threshold catches more", stale(w, { now: NOW, staleDays: 1 }).length === 3);
  check("the default threshold is a quarter", DEFAULT_STALE_DAYS === 90);
}

// --- grouping and file shape --------------------------------------------------------------------------
{
  const w = ws();
  add(w, "environment", "first env fact", { now: NOW });
  add(w, "gates", "a gate fact", { now: NOW });
  add(w, "environment", "second env fact", { now: NOW });
  const text = readFileSync(factsPath(w), "utf8");
  check("each area gets one heading", (text.match(/^## environment$/gm) || []).length === 1);
  check("a second area gets its own heading", text.includes("## gates"));
  check(
    "a later fact joins its own area, not the end of the file",
    text.indexOf("second env fact") < text.indexOf("## gates"),
  );
  check("all three read back", list(w, { now: NOW }).length === 3);
  check("the file opens with a heading", text.startsWith("# Project facts"));
  check("the header explains the provenance rule", text.includes("last verified"));
}

// --- never throws -----------------------------------------------------------------------------------------
check("listing a workspace with no facts file is empty", list(ws()).length === 0);
check("stale() with no file is empty", stale(ws()).length === 0);
{
  const w = ws();
  mkdirSync(join(w, ".aidlc"), { recursive: true });
  writeFileSync(factsPath(w), "garbage\n- malformed line without provenance\n## \n\x00");
  check("garbage does not throw", Array.isArray(list(w)));
  check("malformed lines are skipped, not guessed at", list(w).length === 0);
  check("append still works over a garbage file", add(w, "gates", "recovered", { now: NOW }).action === "added");
  check("the recovered fact reads back", list(w, { now: NOW }).some((f) => f.text === "recovered"));
}
{
  const w = ws();
  mkdirSync(factsPath(w), { recursive: true }); // a directory where the file should be
  check("an unwritable path is rejected, not thrown", add(w, "gates", "x", { now: NOW }).action === "rejected");
}

for (const t of tmps) rmSync(t, { recursive: true, force: true });
console.log(`\n${n - fails}/${n} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
