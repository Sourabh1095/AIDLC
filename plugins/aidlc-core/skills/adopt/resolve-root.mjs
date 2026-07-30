#!/usr/bin/env node
// Canonicalise a workspace root path, and decide whether that root is its own git repo.
//
//   node resolve-root.mjs <root> [<root> …]
//
// Prints one line per root: the canonical path, the VCS marker, and the boundary verdict
// (own repo root / inside an enclosing repo / not a repo at all / absent).
// Exits 0 always — classification is not a verdict; exits 2 on bad input.
//
// This is code rather than prose because comparing two paths on Windows fails SILENTLY, and it has
// now produced a confidently-wrong profile twice:
//
//   * Phase 1 used `rev-parse --is-inside-work-tree`, which answers `true` for any folder beneath
//     any repo, so every root inherited its ancestor's branch, remotes and history.
//   * The Phase 3/4 live run found the replacement probe comparing an MSYS path (`/c/Users/…`,
//     which is what Git Bash and the folder scan hand you on Windows) against `rev-parse
//     --show-toplevel`, which always answers in drive form (`C:/Users/…`). They never compare
//     equal, so EVERY repo was classified "not a repo, enclosed by itself".
//
// Both failures look like a working check: the negative case (a folder that really is not a repo)
// still comes out right, so nothing errors and the profile reads as complete.
//
// A third trap this closes: MSYS paths are not valid to non-MSYS tools. `fs.existsSync("/c/x")`
// returns false for a directory that exists, and `not-cloned` is a legitimate classification — so
// an uncanonicalised root reads as "declared but never cloned" while sitting on disk. §1 requires
// running BOTH discovery paths (the workspace file, via node; the folder scan, via the shell), so
// both forms genuinely coexist in one run. Canonicalise once, at discovery, before anything is
// compared, probed or recorded.

import { existsSync, statSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Canonical form: forward slashes, drive-letter form, no trailing slash, lower-cased.
// Lower-casing is safe for COMPARISON only — never store the result as the path you display or
// hand to a command. Use canonicalPath() for that.
export function normaliseRootPath(p) {
  if (typeof p !== "string" || p.trim() === "") return "";
  let s = p.trim().replace(/\\/g, "/");
  s = s.replace(/^\/\/\?\/UNC\//i, "//");     // \\?\UNC\server\share -> //server/share
  s = s.replace(/^\/\/\?\//, "");             // \\?\C:\x             -> C:/x
  s = s.replace(/^\/mnt\/([a-zA-Z])(?=\/|$)/, "$1:");  // WSL   /mnt/c/x -> c:/x
  s = s.replace(/^\/cygdrive\/([a-zA-Z])(?=\/|$)/, "$1:"); // Cygwin
  s = s.replace(/^\/([a-zA-Z])(?=\/|$)/, "$1:");       // MSYS  /c/x     -> c:/x
  if (!s.startsWith("//")) s = s.replace(/\/{2,}/g, "/");
  if (!/^[a-zA-Z]:\/?$/.test(s) && s !== "//") s = s.replace(/\/+$/, "");
  return s.toLowerCase();
}

// The path to actually USE — same canonicalisation, original case preserved. Windows compares
// case-insensitively but displays and stores what the user typed; a lower-cased absolutePath in
// the profile would be wrong on a case-sensitive share and ugly everywhere.
export function canonicalPath(p) {
  if (typeof p !== "string" || p.trim() === "") return "";
  let s = p.trim().replace(/\\/g, "/");
  s = s.replace(/^\/\/\?\/UNC\//i, "//").replace(/^\/\/\?\//, "");
  s = s.replace(/^\/mnt\/([a-zA-Z])(?=\/|$)/, (_, d) => `${d.toUpperCase()}:`);
  s = s.replace(/^\/cygdrive\/([a-zA-Z])(?=\/|$)/, (_, d) => `${d.toUpperCase()}:`);
  s = s.replace(/^\/([a-zA-Z])(?=\/|$)/, (_, d) => `${d.toUpperCase()}:`);
  if (!s.startsWith("//")) s = s.replace(/\/{2,}/g, "/");
  if (!/^[a-zA-Z]:\/?$/.test(s) && s !== "//") s = s.replace(/\/+$/, "");
  return s;
}

export function samePath(a, b) {
  const na = normaliseRootPath(a);
  return na !== "" && na === normaliseRootPath(b);
}

// Step 1 of §3's two-step probe: what marker is at the root?
//   "dir"  -> a normal repo root
//   "file" -> a linked worktree or a submodule (.git holds a `gitdir:` pointer)
//   "hg" | "svn" | "perforce" | "tfvc" | "none"
export function vcsMarker(root, fs = { existsSync, statSync, readFileSync }) {
  const at = (rel) => `${canonicalPath(root)}/${rel}`;
  if (fs.existsSync(at(".git"))) {
    const isDir = fs.statSync(at(".git")).isDirectory();
    if (isDir) return { system: "git", marker: "dir" };
    let pointer = null;
    try {
      pointer = String(fs.readFileSync(at(".git"), "utf8")).trim();
    } catch { /* unreadable pointer is still a pointer */ }
    return { system: "git", marker: "file", pointer };
  }
  if (fs.existsSync(at(".hg"))) return { system: "mercurial", marker: "dir" };
  if (fs.existsSync(at(".svn"))) return { system: "svn", marker: "dir" };
  if (fs.existsSync(at(".p4config")) || fs.existsSync(at("P4CONFIG")))
    return { system: "perforce", marker: "file" };
  if (fs.existsSync(at("$tf"))) return { system: "tfvc", marker: "dir" };
  return { system: "none", marker: "none" };
}

// Step 2: confirm the boundary. `topLevel` is the raw output of
// `git -C "<root>" rev-parse --show-toplevel`, or null when the command failed.
export function classifyBoundary(root, topLevel, marker) {
  const canonical = canonicalPath(root);
  if (topLevel == null || String(topLevel).trim() === "") {
    return {
      canonical,
      isOwnRepoRoot: false,
      enclosingRepo: null,
      vcsSystem: marker.system === "git" ? "none" : marker.system,
      note:
        marker.system === "git"
          ? "a .git marker is present but rev-parse --show-toplevel did not answer — treat the repo as unreadable rather than absent, and record why"
          : "not a git repo; VCS read from markers only",
    };
  }
  if (samePath(topLevel, root)) {
    return { canonical, isOwnRepoRoot: true, enclosingRepo: null, vcsSystem: "git", note: null };
  }
  // Different -> the root sits INSIDE the returned repo. Its own VCS comes from its own markers,
  // never from the ancestor: that substitution is the confidently-wrong profile this guards.
  return {
    canonical,
    isOwnRepoRoot: false,
    enclosingRepo: canonicalPath(topLevel),
    vcsSystem: marker.system === "git" ? "git" : marker.system,
    note:
      "this root is not its own repo — it sits inside the enclosing one, so its files are in someone else's index and one `git add -A` from being committed there. Do not record the ancestor's branch, remotes, history or size against this root.",
  };
}

// Convenience: do the whole probe for a root, shelling out for step 2.
export function resolveRoot(root, run = defaultRun) {
  const canonical = canonicalPath(root);
  if (!existsSync(canonical)) {
    return { canonical, exists: false, isOwnRepoRoot: false, enclosingRepo: null, vcsSystem: "unknown",
             note: "declared but absent on disk — classify not-cloned, and never fabricate a path for it" };
  }
  const marker = vcsMarker(canonical);
  // Always ask, even with no marker at the root. A root with NO .git is precisely the case the
  // enclosing-repo hazard is about: a docs folder sitting inside the control plane's work tree is
  // one `git add -A` from being committed to it, and skipping the probe here would report it as a
  // free-standing non-repo and lose the hazard entirely.
  let topLevel = null;
  try { topLevel = run(canonical); } catch { topLevel = null; }
  return { ...classifyBoundary(canonical, topLevel, marker), exists: true, marker: marker.marker };
}

function defaultRun(root) {
  return execFileSync("git", ["-C", root, "rev-parse", "--show-toplevel"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const roots = process.argv.slice(2);
  if (roots.length === 0) {
    console.error("usage: node resolve-root.mjs <root> [<root> …]");
    process.exit(2);
  }
  for (const r of roots) {
    const v = resolveRoot(r);
    const verdict = !v.exists ? "ABSENT (not-cloned)"
      : v.isOwnRepoRoot ? "own repo root"
      : v.enclosingRepo ? `inside ${v.enclosingRepo}`
      : `not a repo (${v.vcsSystem})`;
    console.log(`${v.canonical}\n  marker=${v.marker ?? "-"}  vcs=${v.vcsSystem}  ${verdict}`);
    if (v.note) console.log(`  note: ${v.note}`);
  }
}
