#!/usr/bin/env node
// Tests for resolve-root.mjs — the §3 boundary probe.
//
// The cases that matter are the ones where a WRONG answer still looks like a right one: a repo
// that reports itself enclosed by itself, and a directory that exists being reported absent.
// Both were live-run defects; both are pinned here.

import {
  normaliseRootPath, canonicalPath, samePath, classifyBoundary, resolveRoot,
} from "./resolve-root.mjs";

let n = 0, fails = 0;
function check(name, got, want) {
  n++;
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { fails++; console.error(`FAIL ${name}\n  got:  ${g}\n  want: ${w}`); }
}
function ok(name, cond) { check(name, !!cond, true); }

// ---- normalisation: the forms one run genuinely holds at once -------------------------------
check("MSYS drive form equals Windows drive form",
  normaliseRootPath("/c/Users/x/ws"), normaliseRootPath("C:\\Users\\x\\ws"));
check("WSL /mnt form equals Windows drive form",
  normaliseRootPath("/mnt/c/Users/x/ws"), normaliseRootPath("C:/Users/X/WS"));
check("Cygwin /cygdrive form equals Windows drive form",
  normaliseRootPath("/cygdrive/d/repos/api"), normaliseRootPath("D:\\repos\\api"));
check("a trailing slash does not change the identity",
  normaliseRootPath("C:/x/y/"), normaliseRootPath("C:/x/y"));
check("case is folded for comparison",
  normaliseRootPath("C:/Users/Ada/WS"), normaliseRootPath("c:/users/ada/ws"));
check("a bare drive root survives normalisation", normaliseRootPath("C:\\"), "c:/");

// UNC and extended-length prefixes — the paths §2 calls hostile
check("a UNC path keeps both leading slashes",
  normaliseRootPath("\\\\server\\share\\team ws"), "//server/share/team ws");
check("the \\\\?\\UNC\\ prefix resolves to the plain UNC form",
  normaliseRootPath("\\\\?\\UNC\\server\\share\\p"), normaliseRootPath("\\\\server\\share\\p"));
check("the \\\\?\\ prefix resolves to the plain drive form",
  normaliseRootPath("\\\\?\\C:\\x\\y"), normaliseRootPath("C:/x/y"));
check("spaces are preserved, not collapsed",
  normaliseRootPath("C:/Users/x/design docs"), "c:/users/x/design docs");

// things that must NOT compare equal
ok("a parent is not the same path as its child", !samePath("/c/x/y", "/c/x/y/z"));
ok("sibling roots do not collide", !samePath("C:/x/api", "C:/x/apis"));
ok("different drives never match", !samePath("C:/x", "D:/x"));
ok("an empty path matches nothing, including another empty path", !samePath("", ""));
ok("a null path matches nothing", !samePath(null, "C:/x"));

// ---- canonicalPath: what gets STORED, so case must survive ----------------------------------
check("canonicalPath upper-cases the drive letter and keeps the rest verbatim",
  canonicalPath("/c/Users/Ada/WS"), "C:/Users/Ada/WS");
check("canonicalPath does not lower-case the path body",
  canonicalPath("C:\\Users\\Ada\\Design Docs"), "C:/Users/Ada/Design Docs");
ok("canonicalPath and normaliseRootPath agree on identity",
  samePath(canonicalPath("/mnt/d/Repos/API"), "D:\\repos\\api"));

// ---- the boundary verdict --------------------------------------------------------------------
const gitDir = { system: "git", marker: "dir" };
const noVcs = { system: "none", marker: "none" };

check("a repo whose toplevel is itself, in a DIFFERENT path form, is its own root",
  classifyBoundary("/c/ws/api", "C:/ws/api", gitDir).isOwnRepoRoot, true);
check("...and records no enclosing repo",
  classifyBoundary("/c/ws/api", "C:/ws/api", gitDir).enclosingRepo, null);
check("a folder inside another repo is not its own root",
  classifyBoundary("C:/ws/design docs", "C:/ws", noVcs).isOwnRepoRoot, false);
check("...and names the enclosing repo",
  classifyBoundary("C:/ws/design docs", "C:/ws", noVcs).enclosingRepo, "C:/ws");
check("a non-repo inside a repo keeps its OWN vcs system, never the ancestor's",
  classifyBoundary("C:/ws/design docs", "C:/ws", noVcs).vcsSystem, "none");
check("a mercurial checkout inside a git repo is recorded as mercurial",
  classifyBoundary("C:/ws/legacy", "C:/ws", { system: "mercurial", marker: "dir" }).vcsSystem, "mercurial");
check("a root that never answers rev-parse is not claimed as a repo",
  classifyBoundary("C:/ws/notes", null, noVcs).isOwnRepoRoot, false);
check("...and is not given a fabricated enclosing repo either",
  classifyBoundary("C:/ws/notes", null, noVcs).enclosingRepo, null);
ok("a .git marker with no rev-parse answer is called unreadable, not absent",
  /unreadable rather than absent/.test(classifyBoundary("C:/ws/api", null, gitDir).note));

// The regression that motivated the file: an own-repo verdict must never carry enclosingRepo,
// because the validator rejects a root claiming both — and the profile that claimed both said
// every repo was enclosed by itself.
for (const [root, top] of [
  ["/c/ws", "C:/ws"], ["/c/ws/api", "C:/ws/api"], ["/mnt/c/ws/platform", "C:/ws/platform"],
  ["\\\\?\\C:\\ws\\edge", "C:/ws/edge"],
]) {
  const v = classifyBoundary(root, top, gitDir);
  ok(`${root} is its own root and claims no enclosing repo`, v.isOwnRepoRoot && v.enclosingRepo === null);
}

// A root with NO marker of its own must still be probed: that is the enclosing-repo case, and
// skipping the probe when .git is missing loses the hazard on exactly the roots that have it.
{
  let asked = false;
  const spy = () => { asked = true; return "C:/ws"; };
  const v = resolveRoot(process.cwd(), spy); // cwd has no .git in a plain checkout of this skill dir
  ok("rev-parse is asked even when the root carries no VCS marker of its own", asked);
  ok("...and an answer that differs from the root yields an enclosing repo, not a bare non-repo",
    v.enclosingRepo !== null || v.isOwnRepoRoot);
}

// ---- absent roots ------------------------------------------------------------------------------
const absent = resolveRoot("C:/definitely/not/here/legacy-portal");
check("a genuinely absent root is reported absent", absent.exists, false);
ok("...and says not-cloned rather than inventing a classification",
  /not-cloned/.test(absent.note));
ok("...and never fabricates a path", /never fabricate/.test(absent.note));

// The second face of the live-run defect: an MSYS path handed to node's fs. Canonicalising first
// is what stops a directory that exists from being reported as never cloned.
const here = canonicalPath(process.cwd());
ok("the current directory resolves as existing when given in Windows form",
  resolveRoot(here).exists);
ok("the current directory ALSO resolves as existing when given in MSYS form",
  resolveRoot(here.replace(/^([a-zA-Z]):/, (_, d) => `/${d.toLowerCase()}`)).exists);

console.log(`\n${n - fails}/${n} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
