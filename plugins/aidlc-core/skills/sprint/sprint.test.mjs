// Tests for sprint.mjs. Run: `node sprint.test.mjs`.
//
// The launch itself needs a real Claude Code and is exercised by hand (see the 0.63.0 CHANGELOG
// entry). What is pinned here is everything a sprint decides FROM what Claude Code tells it: the
// launch output it parses, and the board that says which run needs a person. That mapping is where a
// silent mistake would hide — a blocked run shown as "running" waits forever and nobody knows.
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { boardRows, launchFailure, parseBackgrounded, pluginDirArgs, prLabel, renderBoard, rowFor } from "./sprint.mjs";
import { check, done } from "../../hooks/scripts/lib/testkit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// ---- launch output
check("parses the backgrounded line", parseBackgrounded("Starting background service…\nbackgrounded · 96e838a6 · aidlc-PROJ-1\n  claude agents"), { session: "96e838a6", name: "aidlc-PROJ-1" });
check("parses it without a name", parseBackgrounded("backgrounded · 37887968"), { session: "37887968", name: null });
check("no backgrounded line is no launch", parseBackgrounded("error: Workspace not trusted"), null);
check("untrusted is its own failure — trust the worktree, do not fall back", launchFailure("Error: Workspace not trusted"), "untrusted");
check("an unknown --bg is the fallback signal", launchFailure("error: unknown option '--bg'"), "bg-unavailable");
check("anything else is a plain failure", launchFailure("something odd"), "failed");

// ---- which plugin the runs load
check("an installed plugin adds nothing — the session loads it itself", pluginDirArgs("C:\\Users\\u\\.claude\\plugins\\cache\\aidlc\\aidlc\\0.63.0"), []);
check("…on macOS/Linux too", pluginDirArgs("/home/u/.claude/plugins/cache/aidlc/aidlc/0.63.0"), []);
check("a checkout passes itself on, so runs use the same code", pluginDirArgs("D:\\src\\AIDLC\\plugins\\aidlc-core"), ["--plugin-dir", "D:\\src\\AIDLC\\plugins\\aidlc-core"]);

// ---- PR labels
check("GitHub PR url", prLabel("https://github.com/o/r/pull/42"), "PR #42 open");
check("Azure Repos PR url", prLabel("https://dev.azure.com/o/p/_git/r/pullrequest/7"), "PR #7 open");
check("local merge", prLabel("local-merge:abcdef1234"), "merged locally abcdef1");
check("no PR", prLabel("null"), null);

// ---- rows: background sessions
const bg = { item: "P-1", launch: "bg", session: "abc12345", name: "aidlc-P-1" };
const row = (agent, fm) => rowFor(bg, { agent, fm });
check("working, no run file yet → starting", row({ state: "working" }, null).status, "starting");
check("working with a run file → running", row({ state: "working" }, { phase: "implement" }).status, "running");
const blocked = row({ state: "blocked", status: "waiting", waitingFor: "input needed" }, { phase: "design" });
// The shapes below are what `claude agents --json` reported live: a turn that ended on a reply it
// needs is `blocked` + `idle` with no `waitingFor`.
check("blocked+idle mid-run → waiting for a reply, still in flight", [row({ state: "blocked", status: "idle" }, { phase: "verify" }).waitingFor, row({ state: "blocked", status: "idle" }, { phase: "verify" }).terminal], ["a reply", false]);
check("blocked+idle with no run file → dead on arrival (F42)", [row({ state: "blocked", status: "idle" }, null).status, row({ state: "blocked", status: "idle" }, null).terminal], ["dead on arrival", true]);
check("a blocked session NEEDS YOU", [blocked.status, blocked.terminal], ["NEEDS YOU", false]);
check("…and says how to answer", /claude attach abc12345/.test(blocked.needsYou), true);
check("a permission prompt is named", row({ state: "blocked", waitingFor: "permission prompt" }, { phase: "verify" }).waitingFor, "permission prompt");
check("session done + run done → the PR, over", [row({ state: "done" }, { phase: "done", pr: "https://github.com/o/r/pull/9" }).status, row({ state: "done" }, { phase: "done" }).terminal], ["PR #9 open", true]);
const stopped = row({ state: "done" }, { phase: "verify" });
check("session ended its turn mid-run → a person must look, not 'running'", [stopped.status, stopped.terminal, !!stopped.needsYou], ["stopped at verify", false, true]);
check("session done with no run file → dead on arrival (F42)", row({ state: "done" }, null).status, "dead on arrival");
check("session failed → over, with its logs", [row({ state: "failed" }, { phase: "implement" }).terminal, /claude logs/.test(row({ state: "failed" }, { phase: "implement" }).needsYou)], [true, true]);
check("session no longer listed → gone", row(undefined, { phase: "implement" }).status, "session gone");
check("agents listing failed → unknown, not dead", [row(null, { phase: "implement" }).status, row(null, { phase: "implement" }).terminal], ["session state unknown", false]);
check("pipeline blocked → over for the sprint, needs you", [row({ state: "done" }, { phase: "blocked" }).status, row({ state: "done" }, { phase: "blocked" }).terminal], ["blocked", true]);
check("review-pending → over, needs your review", row({ state: "done" }, { phase: "review-pending" }).status, "waiting for your review");

// ---- rows: headless fallback
const hl = { item: "P-2", launch: "headless", pid: 1, logfile: "x.log" };
check("headless alive → running", rowFor(hl, { fm: { phase: "verify" }, alive: true }).status, "running");
check("headless gone mid-run → exited", rowFor(hl, { fm: { phase: "verify" }, alive: false }).status, "exited mid-run");
check("headless gone, no run file → dead on arrival", rowFor(hl, { fm: null, alive: false }).status, "dead on arrival");

// ---- the rendered board
const rendered = renderBoard([
  { item: "P-1", repo: "api", phase: "verify", fixCycles: "1", status: "running", terminal: false },
  { item: "P-2", repo: "web", phase: "design", fixCycles: "0", status: "NEEDS YOU", waitingFor: "input needed", terminal: false, needsYou: "input needed → `claude attach x`" },
]);
check("board header counts who needs you", rendered.split("\n")[0], "Sprint board — 2 runs · 2 in flight · 1 needs you");
check("board lists the waiting run under Needs you", /Needs you:\n  P-2: input needed/.test(rendered), true);
check("repo column shows in poly", /P-1\s+api/.test(rendered), true);

// ---- end to end over files: sprint file + run files + an agents listing
const ws = mkdtempSync(join(tmpdir(), "sprint-"));
try {
  const runs = join(ws, ".aidlc", "runs");
  mkdirSync(join(runs, "archive"), { recursive: true });
  writeFileSync(join(runs, "P-1.md"), "---\nitem: P-1\nphase: implement\nfixCycles: 0\n---\n");
  writeFileSync(join(runs, "archive", "P-3.md"), "---\nitem: P-3\nphase: done\npr: https://github.com/o/r/pull/5\n---\n");
  const sprint = {
    runs: [
      { item: "P-1", launch: "bg", session: "aaaa1111", name: "aidlc-P-1", runFile: join(runs, "P-1.md") },
      { item: "P-3", launch: "bg", session: "cccc3333", name: "aidlc-P-3", runFile: join(runs, "P-3.md") },
    ],
  };
  const agents = [
    { id: "aaaa1111", state: "blocked", waitingFor: "input needed" },
    { id: "cccc3333", state: "done" },
  ];
  const rows = boardRows(sprint, agents);
  check("reads the live run file", [rows[0].phase, rows[0].status], ["implement", "NEEDS YOU"]);
  check("finds an archived run file", rows[1].status, "PR #5 open");

  writeFileSync(join(ws, "sprint.json"), JSON.stringify(sprint));
  writeFileSync(join(ws, "agents.json"), JSON.stringify(agents));
  const out = JSON.parse(execFileSync("node", [join(HERE, "sprint.mjs"), "board", "--sprint-file", join(ws, "sprint.json"), "--agents-json", join(ws, "agents.json"), "--json"], { encoding: "utf8" }));
  check("CLI board --json reports not all over while one waits", [out.rows.length, out.allTerminal], [2, false]);
} finally {
  rmSync(ws, { recursive: true, force: true });
}

done();
