// Tests for next-id.mjs — markdown-backlog id allocation. Run: `node next-id.test.mjs`.
// Requires git on PATH. Pins the two duplicate-id paths: a sprint worktree's private copy of
// .sequence, and a .sequence that fell behind the files on disk.
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { allocate, highestExisting } from "./next-id.mjs";

let n = 0, fails = 0;
function check(label, actual, expected) {
  n++;
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`ok    ${label}`); return; }
  fails++;
  console.log(`FAIL  ${label}\n      expected ${e}\n      actual   ${a}`);
}

const repo = mkdtempSync(join(tmpdir(), "nextid-"));
const git = (...a) => execFileSync("git", a, { cwd: repo, stdio: ["ignore", "pipe", "ignore"] });
git("init");
git("config", "user.email", "t@t.co");
git("config", "user.name", "test");
mkdirSync(join(repo, "backlog", "items"), { recursive: true });
writeFileSync(join(repo, "backlog", ".sequence"), "5\n");
writeFileSync(join(repo, "backlog", "items", "PROJ-4-old-thing.md"), "x");
git("add", "-A");
git("commit", "-m", "init");

check("first id comes from .sequence", allocate(repo, "PROJ").id, "PROJ-5");
check("and the sequence advances", readFileSync(join(repo, "backlog", ".sequence"), "utf8").trim(), "6");

// A sprint worktree carries its own stale copy of backlog/.sequence (still 5 on its branch).
const wt = join(mkdtempSync(join(tmpdir(), "nextid-wt-")), "w");
git("worktree", "add", "-b", "feature/x", wt);
check("the worktree's copy is stale", readFileSync(join(wt, "backlog", ".sequence"), "utf8").trim(), "5");
const fromWorktree = allocate(wt, "PROJ");
check("allocating from a worktree uses the MAIN worktree's sequence", fromWorktree.id, "PROJ-6");
check("…and says where it allocated", fromWorktree.root.toLowerCase() === repo.toLowerCase(), true);

// A .sequence that fell behind the files never reissues an existing id.
writeFileSync(join(repo, "backlog", "items", "PROJ-30-imported.md"), "x");
writeFileSync(join(repo, "backlog", ".sequence"), "7\n");
check("highest existing id is read from file names", highestExisting(repo, "PROJ"), 30);
check("a lagging sequence jumps past existing ids", allocate(repo, "PROJ").id, "PROJ-31");

rmSync(repo, { recursive: true, force: true });
rmSync(join(wt, ".."), { recursive: true, force: true });
console.log(`\n${n - fails}/${n} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
