// Tests for journal.mjs. Run: `node journal.test.mjs`.
//
// The journal is read at SessionStart, into a context window, on every session. So two
// properties matter more than features: it must never throw (a memory system that breaks
// a run is worse than no memory system), and the tail must stay cheap no matter how long
// the project has run — which is what rotation is for.
import { append, tail, latest, readEntries, parseEntry, stamp, journalPath, KINDS, MAX_ENTRIES } from "./journal.mjs";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, chmodSync } from "node:fs";
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
  const d = mkdtempSync(join(tmpdir(), "journal-"));
  tmps.push(d);
  return d;
}
const T = (iso) => new Date(iso);

// --- stamp + parse ----------------------------------------------------------------------
check("stamp is UTC to the minute", stamp(T("2026-08-02T14:02:33.123Z")) === "2026-08-02T14:02Z");
check("a well-formed line parses", parseEntry("- 2026-08-02T14:02Z `run` PROJ-1 done").kind === "run");
check("the summary survives parsing", parseEntry("- 2026-08-02T14:02Z `run` PROJ-1 done · PR #8").summary === "PROJ-1 done · PR #8");
check("a header line does not parse as an entry", parseEntry("| when (UTC) | kind | what |") === null);
check("prose does not parse as an entry", parseEntry("Append-only. One line per event.") === null);
check("an empty line does not parse", parseEntry("") === null);

// --- append ------------------------------------------------------------------------------
{
  const w = ws();
  check("append returns the line", append(w, "run", "PROJ-1 done").includes("`run` PROJ-1 done"));
  check("the file is created", existsSync(journalPath(w)));
  check("the entry reads back", readEntries(w).length === 1);
  append(w, "board", "12 todo");
  check("entries accumulate", readEntries(w).length === 2);
  check("order is oldest first", readEntries(w)[0].kind === "run");
}

// --- the closed kind vocabulary -------------------------------------------------------------
{
  const w = ws();
  check("an unknown kind is rejected", append(w, "musings", "x") === null);
  check("a rejected kind writes nothing", readEntries(w).length === 0);
  check("every documented kind is accepted", [...KINDS].every((k) => append(ws(), k, "x") !== null));
}

// --- summaries are one line, and bounded -------------------------------------------------------
{
  const w = ws();
  append(w, "run", "line one\nline two\n\tand   three");
  check("newlines and runs of whitespace collapse", readEntries(w)[0].summary === "line one line two and three");
  check("a multi-line summary still occupies ONE line", readFileSync(journalPath(w), "utf8").trim().split("\n").filter((l) => l.startsWith("- ")).length === 1);
}
{
  const w = ws();
  append(w, "run", "x".repeat(400));
  const s = readEntries(w)[0].summary;
  check("an overlong summary is truncated", s.length <= 200);
  check("truncation is marked", s.endsWith("…"));
}
{
  const w = ws();
  check("an empty summary is rejected", append(w, "run", "   ") === null);
  check("a null summary is rejected", append(w, "run", null) === null);
}

// --- tail + latest ------------------------------------------------------------------------------
{
  const w = ws();
  for (let i = 1; i <= 10; i++) append(w, i % 2 ? "run" : "board", `entry ${i}`);
  check("tail returns the last n", tail(w, 3).length === 3);
  check("tail is oldest-first within the window", tail(w, 3)[2].summary === "entry 10");
  check("tail beyond the length is the whole file", tail(w, 99).length === 10);
  check("tail(0) is empty", tail(w, 0).length === 0);
  check("latest finds the most recent of a kind", latest(w, "board").summary === "entry 10");
  check("latest finds an older kind correctly", latest(w, "run").summary === "entry 9");
  check("latest of an absent kind is null", latest(w, "release") === null);
}

// --- rotation ---------------------------------------------------------------------------------------
{
  const w = ws();
  const max = 8;
  for (let i = 1; i <= max; i++) append(w, "run", `e${i}`, { maxEntries: max });
  check("no rotation before the threshold", !existsSync(join(w, ".aidlc", "journal-archive")));
  append(w, "run", "trigger", { maxEntries: max, now: T("2026-08-02T10:00:00Z") });
  const arch = join(w, ".aidlc", "journal-archive");
  check("rotation creates the archive", existsSync(arch));
  check("the archive is dated", readdirSync(arch)[0] === "journal-2026-08-02.md");
  check("the archived file holds the old entries", readFileSync(join(arch, readdirSync(arch)[0]), "utf8").includes("e1"));
  check("the live file restarts with only the new entry", readEntries(w).length === 1 && readEntries(w)[0].summary === "trigger");
  check("the live file keeps its header", readFileSync(journalPath(w), "utf8").startsWith("# AIDLC journal"));
}
{
  // Two rotations on the same day must not overwrite each other's archive.
  const w = ws();
  const max = 3;
  const now = T("2026-08-02T10:00:00Z");
  for (let i = 0; i < 9; i++) append(w, "run", `e${i}`, { maxEntries: max, now });
  const files = readdirSync(join(w, ".aidlc", "journal-archive"));
  check("same-day rotations get distinct filenames", new Set(files).size === files.length && files.length >= 2);
}
check("the default threshold is large enough to be rare", MAX_ENTRIES >= 200);

// --- never throws --------------------------------------------------------------------------------------
{
  const w = ws();
  // A journal file that is not a journal at all.
  mkdirSync(join(w, ".aidlc"), { recursive: true });
  writeFileSync(journalPath(w), "not a journal\n\x00\x01 garbage\n");
  check("garbage in the file does not throw on read", Array.isArray(readEntries(w)));
  check("garbage yields no entries rather than crashing", readEntries(w).length === 0);
  check("append still works over a garbage file", append(w, "run", "recovered") !== null);
  check("the recovered entry is readable", latest(w, "run").summary === "recovered");
}
check("reading a workspace with no journal yields []", readEntries(ws()).length === 0);
check("tail on a missing journal is empty", tail(ws(), 5).length === 0);
check("latest on a missing journal is null", latest(ws(), "run") === null);
{
  // An unwritable location must degrade to null, not explode mid-run.
  const w = ws();
  mkdirSync(join(w, ".aidlc"), { recursive: true });
  mkdirSync(journalPath(w), { recursive: true }); // a DIRECTORY where the file should be
  check("an unwritable journal path returns null instead of throwing", append(w, "run", "x") === null);
}

// --- the file stays human-readable ------------------------------------------------------------------------
{
  const w = ws();
  append(w, "consult", "billing in the API repo? → no (ADR-0007), confidence medium");
  const text = readFileSync(journalPath(w), "utf8");
  check("the file opens with a heading", text.startsWith("# AIDLC journal"));
  check("the header explains what it is for", text.includes("session start"));
  check("entries render as a markdown list", text.includes("\n- 2026-"));
}

for (const t of tmps) rmSync(t, { recursive: true, force: true });
console.log(`\n${n - fails}/${n} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
