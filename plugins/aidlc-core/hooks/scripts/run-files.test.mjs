// Tests for lib/run-files.mjs — where run files are found, and how they are read.
// Run: `node run-files.test.mjs`. Requires git on PATH. It had no tests; the two bugs pinned
// here (absolute repo paths, worktree runs) were both silent: the runs simply never appeared.
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRuns, frontmatter, PHASES, WAITING_ON_HUMAN } from "./lib/run-files.mjs";
import { check, done } from "./lib/testkit.mjs";


const run = (dir, item, phase) => {
  mkdirSync(join(dir, ".aidlc", "runs"), { recursive: true });
  writeFileSync(join(dir, ".aidlc", "runs", `${item}.md`), `---\nitem: ${item}\nphase: ${phase}       # start|…\n---\n\n## Log\n`);
};

// A control plane, a nested repo, and a repo somewhere else entirely, referenced by absolute path.
const ws = mkdtempSync(join(tmpdir(), "runfiles-ws-"));
const elsewhere = mkdtempSync(join(tmpdir(), "runfiles-other-"));
mkdirSync(join(ws, ".claude"), { recursive: true });
writeFileSync(
  join(ws, ".claude", "aidlc.config.json"),
  JSON.stringify({ workspace: { root: "." }, repos: [{ name: "web", path: "web" }, { name: "api", path: elsewhere }] }),
);
run(ws, "CP-1", "implement");
run(join(ws, "web"), "WEB-1", "verify");
run(elsewhere, "API-1", "blocked");

const items = (keep = () => true) => readRuns(ws, keep).map((r) => r.item).sort();
check("control plane, nested repo AND absolute-path repo are all scanned", items(), ["API-1", "CP-1", "WEB-1"]);
check("a trailing # comment is not part of the value", frontmatter(join(ws, ".aidlc", "runs", "CP-1.md")).phase, "implement");

// A mono sprint runs each item in its own worktree; its run file lives on that worktree's branch.
const repo = mkdtempSync(join(tmpdir(), "runfiles-repo-"));
const git = (...a) => execFileSync("git", a, { cwd: repo, stdio: ["ignore", "pipe", "ignore"] });
git("init");
git("config", "user.email", "t@t.co");
git("config", "user.name", "test");
writeFileSync(join(repo, "f.txt"), "x");
git("add", "-A");
git("commit", "-m", "init");
const wt = join(mkdtempSync(join(tmpdir(), "runfiles-wt-")), "item");
git("worktree", "add", "-b", "feature/PROJ-9", wt);
run(wt, "PROJ-9", "implement");
check("a run in a sprint worktree is found from the main checkout", readRuns(repo, () => true).map((r) => r.item), ["PROJ-9"]);

check("review-pending is a phase", PHASES.includes("review-pending"), true);
check("blocked and review-pending wait on a human", [WAITING_ON_HUMAN.has("blocked"), WAITING_ON_HUMAN.has("review-pending"), WAITING_ON_HUMAN.has("verify")], [true, true, false]);

for (const d of [ws, elsewhere, repo, join(wt, "..")]) rmSync(d, { recursive: true, force: true });
done();
