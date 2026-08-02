// Shared by the run-file-reading hooks (session-context, checkpoint). Both need the
// same two things — parse a run file's frontmatter, and know which directories run
// files live in — and both must be poly-aware. Kept here so the two cannot drift:
// they had identical copies, which is how one gets a fix and the other doesn't.
//
// Never throws. Every failure degrades to "no data": a hook that reads run state is
// never worth breaking a session over.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

// Parse a markdown file's YAML-ish frontmatter into a flat string map. Deliberately
// not a YAML parser — run-file frontmatter is flat `key: value` by construction
// (`aidlc:run-state` → Format), and a real parser would be a dependency for nothing.
export function frontmatter(file) {
  try {
    const m = readFileSync(file, "utf8").match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!m) return null;
    const fm = {};
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
      if (kv) fm[kv[1]] = kv[2].trim();
    }
    return fm;
  } catch {
    return null;
  }
}

// Every directory run files can live in: the control plane, plus each declared repo
// in poly (`aidlc:run-state` → Location). A mono workspace or a folder with no config
// yields the control plane alone. Only existing dirs are returned.
export function runDirs(cwd) {
  const dirs = [join(cwd, ".aidlc", "runs")];
  try {
    const cfg = JSON.parse(readFileSync(join(cwd, ".claude", "aidlc.config.json"), "utf8"));
    const root = (cfg.workspace && cfg.workspace.root) || ".";
    for (const r of cfg.repos || []) if (r && r.path) dirs.push(join(cwd, root, r.path, ".aidlc", "runs"));
  } catch {
    /* mono, or no config → control plane only */
  }
  return dirs.filter((d) => existsSync(d));
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
