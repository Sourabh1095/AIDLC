// Finding and reading the AIDLC workspace config from a hook.
//
// Hooks run before the model has said anything about where it is working, so they find
// the config the way git finds a repo: walk up from the directory the action concerns to
// the nearest `.claude/aidlc.config.json`. The nearest one governs. Anchoring on the
// action's own directory (an env file's folder, a `git -C` target) rather than the session
// cwd is what lets a poly product repo see the control-plane config (F50).
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

const _cache = new Map();

// { path, cfg, malformed } for the nearest config at or above `startDir`.
// No config: { path: null, cfg: null, malformed: false }.
export function findConfig(startDir) {
  if (_cache.has(startDir)) return _cache.get(startDir);
  let result = { path: null, cfg: null, malformed: false };
  let dir = startDir;
  for (;;) {
    const p = join(dir, ".claude", "aidlc.config.json");
    if (existsSync(p)) {
      try {
        const cfg = JSON.parse(readFileSync(p, "utf8"));
        result = { path: p, cfg: cfg && typeof cfg === "object" ? cfg : null, malformed: !(cfg && typeof cfg === "object") };
      } catch {
        result = { path: p, cfg: null, malformed: true };
      }
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  _cache.set(startDir, result);
  return result;
}

// Every branch name or pattern the config declares as permanent: the default and
// integration branches and the long-lived list, top-level and per repo. Patterns keep
// their `*` (e.g. `release/*`); `branchMatches` interprets them.
export function configuredBranches(cfg) {
  const out = new Set();
  const take = (block) => {
    if (!block || typeof block !== "object") return;
    for (const k of ["defaultBranch", "integrationBranch"]) if (typeof block[k] === "string" && block[k]) out.add(block[k]);
    if (Array.isArray(block.longLivedBranches)) for (const b of block.longLivedBranches) if (typeof b === "string" && b) out.add(b);
  };
  if (cfg && typeof cfg === "object") {
    take(cfg.git);
    if (Array.isArray(cfg.repos)) for (const r of cfg.repos) take(r);
  }
  return [...out];
}

// Does `branch` match `pattern`? `*` matches within one path segment, `**` across them.
export function branchMatches(branch, pattern) {
  const re = new RegExp(
    "^" +
      pattern
        .split("**")
        .map((part) => part.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*"))
        .join(".*") +
      "$",
  );
  return re.test(branch);
}
