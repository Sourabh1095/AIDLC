// Shared by everything that reads run files from a hook or a script (session-context,
// doctor). They need the same three things — parse a run file's frontmatter, know which
// directories run files live in, and agree on what the phases are — and they must all be
// poly-aware. Kept here so they cannot drift: they had separate copies, which is how one
// gets a fix and the other doesn't (doctor resolved absolute repo paths; this file did not).
//
// Never throws. Every failure degrades to "no data": a hook that reads run state is
// never worth breaking a session over.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

// Every phase a run file can be in (`aidlc:run-state` → Format). `review-pending` was used by five
// skills and accepted by doctor, but missing from the documented list — so readers disagreed about
// whether a run parked for human review was "active".
export const PHASES = ["start", "requirements", "design", "implement", "verify", "pr", "docs", "done", "blocked", "review-pending", "abandoned"];

// Phases that are over: nothing more will happen to the run. `abandoned` is a run reversed by /aidlc:undo.
export const TERMINAL = new Set(["done", "abandoned"]);

// Phases where the run is waiting on a person, not on the pipeline.
export const WAITING_ON_HUMAN = new Set(["blocked", "review-pending"]);

// Parse a markdown file's YAML-ish frontmatter into a flat string map. Deliberately
// not a YAML parser — run-file frontmatter is flat `key: value` by construction
// (`aidlc:run-state` → Format), and a real parser would be a dependency for nothing.
export function frontmatter(file) {
  try {
    const m = readFileSync(file, "utf8").match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!m) return null;
    const fm = {};
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^(\w[\w-]*):\s*(.*?)(?:\s+#.*)?$/); // a trailing `  # comment` is not the value
      if (kv) fm[kv[1]] = kv[2].trim();
    }
    return fm;
  } catch {
    return null;
  }
}

// Linked worktrees of the repo at `dir` (excluding `dir` itself). `/aidlc:sprint` runs each mono
// item in its own worktree, and a run file there lives on that worktree's branch — invisible to a
// scan of the main checkout, so `/aidlc:next` could start an item a sprint was already running.
function worktrees(dir) {
  try {
    const out = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: dir, stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }).toString();
    return out
      .split(/\r?\n/)
      .filter((l) => l.startsWith("worktree "))
      .map((l) => resolve(l.slice(9).trim()))
      .filter((p) => p.toLowerCase() !== resolve(dir).toLowerCase());
  } catch {
    return [];
  }
}

// Every directory run files can live in: the control plane, each declared repo in poly
// (`aidlc:run-state` → Location), and every linked worktree of those. A repo path may be
// ABSOLUTE — a multi-root workspace can put a repo on another drive — so paths are resolved,
// never joined: `join("D:\\ws", ".", "E:\\api")` is `D:\ws\E:\api`, a directory that does not
// exist, and every run in that repo silently vanished from the session snapshot.
// Only existing dirs are returned.
export function runDirs(cwd) {
  const roots = [resolve(cwd)];
  try {
    const cfg = JSON.parse(readFileSync(join(cwd, ".claude", "aidlc.config.json"), "utf8"));
    const root = (cfg.workspace && cfg.workspace.root) || ".";
    for (const r of cfg.repos || []) if (r && typeof r.path === "string" && r.path) roots.push(resolve(cwd, root, r.path));
  } catch {
    /* mono, or no config → control plane only */
  }
  const all = [...roots, ...roots.flatMap(worktrees)];
  const seen = new Set();
  return all
    .map((r) => join(r, ".aidlc", "runs"))
    .filter((d) => (seen.has(d.toLowerCase()) ? false : (seen.add(d.toLowerCase()), true)))
    .filter((d) => existsSync(d));
}

// Every run file across those dirs, parsed, deduped by item (a poly item's run file
// lives in its repo; the control plane may also hold an epic coordination file).
// `keep` filters on the parsed frontmatter.
export function readRuns(cwd, keep) {
  try {
    const seen = new Set();
    return runDirs(cwd)
      .flatMap((d) =>
        readdirSync(d)
          .filter((f) => f.endsWith(".md"))
          .map((f) => frontmatter(join(d, f))),
      )
      .filter(Boolean)
      .filter(keep)
      .filter((r) => (r.item && seen.has(r.item) ? false : (seen.add(r.item), true)));
  } catch {
    return [];
  }
}

// CLI, so skills can ask the same question the hooks do instead of re-describing the scan:
//   node run-files.mjs <workspace-root> [--all]   → one line per non-done run (or every run)
if (process.argv[1] && /run-files\.mjs$/.test(process.argv[1])) {
  const [root = process.cwd(), flag] = process.argv.slice(2);
  for (const r of readRuns(resolve(root), (x) => x.phase && (flag === "--all" || !TERMINAL.has(x.phase))))
    console.log(`${r.item}\t${r.phase}\t${r.repo && r.repo !== "null" ? r.repo : "-"}\t${r.branch || "-"}`);
}
