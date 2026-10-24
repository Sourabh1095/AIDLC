#!/usr/bin/env node
// Duplicated code introduced by a branch — the deterministic half of the reuse check.
//
//   node dup-check.mjs <repoRoot> [--base <ref>] [--min-lines 8] [--fuzzy] [--json]
//
// Compares the branch's ADDED lines (committed, uncommitted and untracked, against the merge-base
// with --base, default origin's default branch) with every tracked source file of the same kinds,
// and reports each run of at least --min-lines significant lines that also exists somewhere else:
//
//   copy of existing code   — the branch re-wrote something the repo already had. Reuse it, or
//                             extract it into a shared function and call it from both places.
//   copy within the change  — the branch wrote the same thing twice (the six-screens case).
//                             Extract it once.
//
// Exit 0 = no duplication; 1 = duplication found; 2 = bad input. So it can stand in a gate, and the
// verify phase turns each clone into a finding.
//
// WHY ONLY ADDED LINES. A whole-repo duplication score fails every legacy codebase on day one and
// says nothing about the change in front of the reviewer. What a run can act on is what THIS branch
// duplicated, so that is all it measures.
//
// WHY NOT jscpd. It is good, and it is a dependency — fetched at run time, which this plugin's own
// supply-chain gate would (rightly) stop to ask about. This is a line-window matcher, dependency-free
// and language-agnostic: lines are whitespace-normalized, string and number literals are folded
// ("S", "N"), and blank, brace-only, import and comment lines are skipped, so formatting and
// reordered imports do not hide a copy. `--fuzzy` also folds identifiers, which catches a copy whose
// variables were renamed (users → orders) at the cost of more matches on boilerplate.
import { readFileSync, statSync, existsSync } from "node:fs";
import { join, extname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { isMain as isEntry, parseArgs } from "../../hooks/scripts/lib/cli.mjs";

const SOURCE_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".vue", ".svelte", ".py", ".go", ".java", ".kt",
  ".cs", ".rs", ".php", ".rb", ".swift", ".scala", ".c", ".h", ".cpp", ".hpp", ".css", ".scss", ".sql",
]);
const SKIP_PATH = /(^|\/)(node_modules|dist|build|out|\.next|coverage|vendor|target|__snapshots__|migrations|generated|__generated__|\.aidlc|\.claude)\/|\.min\.[a-z]+$|\.d\.ts$|(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/i;
const MAX_BYTES = 400_000;

const KEYWORDS = new Set(
  ("if else for while do switch case break continue return function const let var class new this super import export " +
    "from default async await try catch finally throw typeof instanceof in of def elif lambda pass yield with as is not " +
    "and or None True False self func go defer chan map struct interface type package public private protected static " +
    "void int string bool fn pub impl mut match use mod true false null undefined nil").split(" "),
);

// The comparison form of a line, or "" when the line is not significant.
export function normalizeLine(line, fuzzy = false) {
  let s = line.trim();
  if (!s) return "";
  if (/^(\/\/|#|\/\*|\*|\*\/|<!--|--)/.test(s)) return ""; // comment
  if (/^(import\b|from\s+\S+\s+import\b|using\s|require\(|#include|package\s|use\s+[\w:]+;)/.test(s)) return "";
  s = s
    .replace(/(["'`])(?:\\.|(?!\1).)*\1/g, "S")
    .replace(/\b\d+(\.\d+)?\b/g, "N")
    .replace(/\s+/g, " ");
  if (fuzzy) s = s.replace(/\b[A-Za-z_$][\w$]*\b/g, (w) => (KEYWORDS.has(w) ? w : "I"));
  if (/^[\s{}()[\];,.:<>/=]*$/.test(s)) return ""; // braces, closing tags, punctuation only
  if (s.length < 4) return "";
  return s;
}

// Significant lines of a file: [{ text, line }].
export function significant(text, fuzzy) {
  const out = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const t = normalizeLine(raw, fuzzy);
    if (t) out.push({ text: t, line: i + 1 });
  });
  return out;
}

function git(root, args) {
  return execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 256 * 1024 * 1024 }).toString();
}

export function mergeBase(root, ref) {
  const refs = ref ? [ref] : ["origin/HEAD", "origin/main", "origin/master", "main", "master"];
  for (const r of refs) {
    try {
      return git(root, ["merge-base", "HEAD", r]).trim();
    } catch {
      /* next */
    }
  }
  return null;
}

// { file → Set(addedLineNumbers) } for the working tree against `base`, untracked files included.
export function addedLines(root, base) {
  const out = new Map();
  const diff = git(root, ["diff", "-U0", "--no-color", "--no-ext-diff", base, "--"]);
  let file = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      file = line.startsWith("+++ b/") ? line.slice(6).trim() : null;
      if (file && !out.has(file)) out.set(file, new Set());
    } else if (file && line.startsWith("@@")) {
      const m = line.match(/\+(\d+)(?:,(\d+))?/);
      const start = Number(m[1]);
      const count = m[2] === undefined ? 1 : Number(m[2]);
      for (let k = 0; k < count; k++) out.get(file).add(start + k);
    }
  }
  for (const f of git(root, ["ls-files", "--others", "--exclude-standard"]).split(/\r?\n/).filter(Boolean)) {
    try {
      const n = readFileSync(join(root, f), "utf8").split(/\r?\n/).length;
      out.set(f, new Set(Array.from({ length: n }, (_, i) => i + 1)));
    } catch {
      /* unreadable */
    }
  }
  for (const [f] of out) if (!SOURCE_EXT.has(extname(f).toLowerCase()) || SKIP_PATH.test(f)) out.delete(f);
  return out;
}

const readText = (root, f) => {
  try {
    const p = join(root, f);
    if (statSync(p).size > MAX_BYTES) return null;
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
};

// Clones the branch introduced. Each: { file, from, to, lines, other: { file, from, to }, kind }.
export function findClones(root, base, { minLines = 8, fuzzy = false } = {}) {
  const added = addedLines(root, base);
  if (!added.size) return [];
  const exts = new Set([...added.keys()].map((f) => extname(f).toLowerCase()));
  const tracked = git(root, ["ls-files"]).split(/\r?\n/).filter((f) => f && exts.has(extname(f).toLowerCase()) && !SKIP_PATH.test(f));
  const files = [...new Set([...tracked, ...added.keys()])];

  // Index every window of `minLines` significant lines in every candidate file.
  const index = new Map();
  const sig = new Map();
  for (const f of files) {
    const text = readText(root, f);
    if (text == null) continue;
    const lines = significant(text, fuzzy);
    sig.set(f, lines);
    for (let i = 0; i + minLines <= lines.length; i++) {
      const key = lines.slice(i, i + minLines).map((l) => l.text).join("\n");
      if (!index.has(key)) index.set(key, []);
      index.get(key).push({ file: f, i });
    }
  }

  const clones = [];
  for (const [f, addedSet] of added) {
    const lines = sig.get(f);
    if (!lines) continue;
    let open = null;
    const close = () => {
      if (open) clones.push(open);
      open = null;
    };
    for (let i = 0; i + minLines <= lines.length; i++) {
      const win = lines.slice(i, i + minLines);
      // The window must be (mostly) new code: at least all but one of its lines added on this branch.
      const newLines = win.filter((l) => addedSet.has(l.line)).length;
      if (newLines < minLines - 1) {
        close();
        continue;
      }
      // A run of near-identical lines is a table (`check(S, S, S);` × 8 rows of test data, a list
      // of route registrations), not copied logic: literals are folded, so every row normalizes to
      // the same text. Logic varies line to line; require that.
      if (new Set(win.map((l) => l.text)).size < Math.ceil(minLines * 0.6)) {
        close();
        continue;
      }
      const key = win.map((l) => l.text).join("\n");
      const candidates = (index.get(key) || []).filter((o) => o.file !== f || Math.abs(o.i - i) >= minLines); // same file: non-overlapping
      // Prefer the location that continues the clone already open, so one copied block reads as one.
      const elsewhere =
        (open && candidates.find((o) => o.file === open.other.file && o.i === open.otherI + 1)) || candidates[0];
      if (!elsewhere) {
        close();
        continue;
      }
      const oLines = sig.get(elsewhere.file);
      const otherNew = (added.get(elsewhere.file) || new Set()).has(oLines[elsewhere.i].line);
      const kind = otherNew ? "within-change" : "existing";
      const to = win[win.length - 1].line;
      const oTo = oLines[elsewhere.i + minLines - 1].line;
      if (open && open.lastI === i - 1 && open.other.file === elsewhere.file && open.otherI === elsewhere.i - 1 && open.kind === kind) {
        open.to = to;
        open.other.to = oTo;
      } else {
        close();
        open = { file: f, from: win[0].line, to, other: { file: elsewhere.file, from: oLines[elsewhere.i].line, to: oTo }, kind };
      }
      open.lastI = i;
      open.otherI = elsewhere.i;
    }
    close();
  }

  // A within-change pair is found from both sides; keep one.
  const seen = new Set();
  // `test`: the copy is in test code, where a repeated arrange block costs less than in product
  // code — still worth a shared fixture, but the verify phase ranks it lower.
  const isTest = (f) => /\.(test|spec)\.[a-z]+$|(^|\/)(tests?|__tests__|spec)\/|(^|\/)test_[^/]*\.py$|_test\.(go|py)$/i.test(f);
  return clones
    .map(({ lastI, otherI, ...c }) => ({ ...c, lines: c.to - c.from + 1, test: isTest(c.file) }))
    .filter((c) => {
      const a = `${c.file}:${c.from}`;
      const b = `${c.other.file}:${c.other.from}`;
      const key = c.kind === "within-change" ? [a, b].sort().join("|") : a;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function describe(c) {
  const where = `${c.file}:${c.from}-${c.to}`;
  const other = `${c.other.file}:${c.other.from}-${c.other.to}`;
  return c.kind === "existing"
    ? `${where} (${c.lines} lines) repeats existing code at ${other} — call or extend what exists, or extract it into one shared function used by both`
    : `${where} (${c.lines} lines) repeats ${other}, which this change also adds — write it once, in a shared place, and use it from both`;
}

const isMain = isEntry(import.meta.url);
if (isMain) {
  const { flags, positional } = parseArgs(process.argv.slice(2), ["--base", "--min-lines"]);
  const root = positional[0] ? resolve(positional[0]) : null;
  if (!root || !existsSync(root)) {
    console.error("usage: node dup-check.mjs <repoRoot> [--base <ref>] [--min-lines 8] [--fuzzy] [--json]");
    process.exit(2);
  }
  const base = mergeBase(root, flags["--base"]);
  if (!base) {
    console.error("dup-check: cannot find a base to compare against — pass --base <ref>");
    process.exit(2);
  }
  const minLines = Math.max(4, Number(flags["--min-lines"]) || 8);
  const clones = findClones(root, base, { minLines, fuzzy: !!flags["--fuzzy"] });
  if (flags["--json"]) console.log(JSON.stringify({ base, minLines, clones }, null, 2));
  else if (!clones.length) console.log(`dup-check: no duplicated code added (≥${minLines} lines) against ${base.slice(0, 10)}`);
  else {
    console.log(`dup-check: ${clones.length} duplicated block(s) added against ${base.slice(0, 10)}`);
    for (const c of clones) console.log(`  ${describe(c)}`);
  }
  process.exit(clones.length ? 1 : 0);
}
