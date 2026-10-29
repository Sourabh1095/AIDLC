// Tests for view.mjs, the cockpit's logic. Run: `node view.test.mjs`.
//
// The mod itself runs only inside Claude Code (its own tests: `claude plugin test plugins/aidlc-cockpit`).
// Everything that decides what a person sees is here, so CI checks it on every OS.
import { advance, bandModel, boardText, checksIn, commandItem, contextModel, coreCandidates, coreTooOld, editedPath, ledgerName, makesCommit, mergeLedger, newestSprintFile, noteChecks, noteCommit, noteEdit, parseGitStatus, phaseOf, prLabel, repoOf, repoRoots, runFileTarget, runLine, sessionModel, transitions, treeModel, treeRows, workLine, workspacePath } from "./view.mjs";
import { check, done } from "../../aidlc-core/hooks/scripts/lib/testkit.mjs";

// ---- finding core
check(
  "a checkout looks beside itself first",
  coreCandidates("D:\\src\\AIDLC\\plugins\\aidlc-cockpit")[0],
  "D:/src/AIDLC/plugins/aidlc-core",
);
check(
  "the plugin cache is tried newest version first",
  coreCandidates("C:\\Users\\u\\.claude\\plugins\\cache\\aidlc\\aidlc-cockpit\\0.1.0", ["0.9.0", "0.63.1", "0.63.0"]).slice(1),
  [
    "C:/Users/u/.claude/plugins/cache/aidlc/aidlc/0.63.1",
    "C:/Users/u/.claude/plugins/cache/aidlc/aidlc/0.63.0",
    "C:/Users/u/.claude/plugins/cache/aidlc/aidlc/0.9.0",
  ],
);
check("a non-version folder in the cache sorts last", coreCandidates("/c/aidlc/aidlc-cockpit/1.0.0", ["abc123", "0.1.0"]).slice(1), ["/c/aidlc/aidlc/0.1.0", "/c/aidlc/aidlc/abc123"]);

// ---- the sprint file
check(
  "the newest sprint file wins",
  newestSprintFile([
    { name: "sprint-2026-10-20.json", kind: "file", mtimeMs: 1 },
    { name: "sprint-2026-10-25.json", kind: "file", mtimeMs: 5 },
    { name: "journal.md", kind: "file", mtimeMs: 9 },
    { name: "sprint-old.json", kind: "dir", mtimeMs: 9 },
  ]),
  "sprint-2026-10-25.json",
);
check("no sprint file → null", newestSprintFile([{ name: "plan.md", kind: "file" }]), null);

// ---- a run as a line
check("a running item", runLine({ item: "P-1", phase: "verify", fixCycles: "1", pr: "null" }), { text: "P-1 · verify · fix-cycle 1", tone: "subtle" });
check("a blocked item says how to resume", runLine({ item: "P-2", phase: "blocked", repo: "api" }), { text: "P-2 · api · blocked → /aidlc:run P-2", tone: "warning" });
check("control-plane is not shown as a repo", runLine({ item: "P-3", phase: "design", repo: "control-plane" }).text, "P-3 · design");
check("PR numbers read from GitHub and Azure urls", [prLabel("https://github.com/o/r/pull/12"), prLabel("https://dev.azure.com/o/p/_git/r/pullrequest/7")], ["PR #12", "PR #7"]);

// ---- the band
check("nothing in flight, no sprint → no band", bandModel({ runs: [], sprint: null, at: 0, problem: null }), null);
check("not an AIDLC workspace → no band", bandModel(null), null);
const runsBand = bandModel({
  runs: [
    { item: "P-1", phase: "implement" },
    { item: "P-2", phase: "blocked" },
    { item: "P-3", phase: "verify" },
    { item: "P-4", phase: "design" },
  ],
  sprint: null,
  at: 0,
  problem: null,
});
check("a run waiting on you comes first", runsBand.lines[0].text, "AIDLC  P-2 · blocked → /aidlc:run P-2");
check("at most three runs, then a pointer to the board", [runsBand.lines.length, runsBand.lines[3].text.trim()], [4, "+1 more — /aidlc-board"]);
check("the band counts what waits on you", runsBand.needsYou, 1);

const rows = [
  { item: "S-1", status: "running", terminal: false, phase: "verify", session: "aaaa1111" },
  { item: "S-2", status: "NEEDS YOU", waitingFor: "input needed", needsYou: "…", terminal: false, phase: "design", session: "bbbb2222" },
  { item: "S-3", status: "PR #9 open", terminal: true, phase: "done", session: "cccc3333" },
];
const sprintBand = bandModel({ runs: [{ item: "P-1", phase: "implement" }], sprint: { rows, allTerminal: false }, at: 0, problem: null });
check("a live sprint takes the band", sprintBand.lines[0].text, "AIDLC sprint · 3 runs · 2 in flight · 1 needs you");
check("…and names who waits, with the attach command", sprintBand.lines[1].text, "  S-2: input needed → claude attach bbbb2222");
check("a finished sprint gives the band back to the runs", bandModel({ runs: [{ item: "P-1", phase: "implement" }], sprint: { rows, allTerminal: true }, at: 0, problem: null }).lines[0].text, "AIDLC  P-1 · implement");
check("a problem is shown, not hidden", bandModel({ runs: [], sprint: null, at: 0, problem: "core not found" }).lines[0].text, "AIDLC cockpit: core not found");

// ---- board text
const text = boardText({ runs: [{ item: "P-1", phase: "implement" }], sprint: { rows, allTerminal: false }, at: 0, problem: null });
check("board text lists runs and the sprint", [/Runs \(1\):/.test(text), /Sprint \(3\):/.test(text), /S-2 · design · NEEDS YOU \(input needed\)/.test(text)], [true, true, true]);
check("board text outside a workspace says so", boardText(null).startsWith("Not an AIDLC workspace"), true);

// ---- what is worth a notification
check("the first board notifies nothing", transitions(null, rows), []);
const later = [
  { ...rows[0], status: "NEEDS YOU", waitingFor: "permission prompt" },
  rows[1],
  rows[2],
];
check("a run starting to wait notifies once", transitions(rows, later), [{ item: "S-1", kind: "needs-you", text: "S-1 needs you: permission prompt" }]);
check("still waiting on the same thing → silence", transitions(later, later), []);
check("waiting on something new → notify again", transitions(rows, [{ ...rows[0] }, { ...rows[1], waitingFor: "permission prompt" }, rows[2]]).map((t) => t.item), ["S-2"]);
check("a run finishing notifies", transitions(rows, [{ ...rows[0], status: "PR #4 open", terminal: true }, rows[1], rows[2]]), [{ item: "S-1", kind: "over", text: "S-1: PR #4 open" }]);

// ---- the cost ledger
check("Write to a run file names its item", runFileTarget("Write", { file_path: String.raw`D:\ws\.aidlc\runs\PROJ-7.md` }), { item: "PROJ-7", path: String.raw`D:\ws\.aidlc\runs\PROJ-7.md` });
check("a heredoc into a run file is a write too", runFileTarget("Bash", { command: "cat > .aidlc/runs/PROJ-1.md <<'END'\n---\nphase: start\n---\nEND" }), { item: "PROJ-1", path: ".aidlc/runs/PROJ-1.md" });
check("a poly repo's run file keeps its folder", runFileTarget("Bash", { command: "sed -i 's/phase: design/phase: implement/' backend/.aidlc/runs/API-3.md" })?.path, "backend/.aidlc/runs/API-3.md");
check("the archive is not a live run", runFileTarget("Bash", { command: "git mv .aidlc/runs/P-1.md .aidlc/runs/archive/P-1.md" })?.item, "P-1");
check("…but writing inside archive/ is ignored", runFileTarget("Write", { file_path: "/ws/.aidlc/runs/archive/P-1.md" }), null);
check("other files and tools are ignored", [runFileTarget("Write", { file_path: "/ws/src/a.ts" }), runFileTarget("Read", { file_path: "/ws/.aidlc/runs/P-1.md" })], [null, null]);
check("phase from frontmatter, comment and all", phaseOf("---\nitem: P-1\nphase: verify      # start|…\n---\n## Log"), "verify");
check("a typed /aidlc:run names its item", [commandItem({ name: "aidlc:run", args: "PROJ-12 --sprint" }), commandItem({ name: "aidlc:run", args: "add avatar upload" }), commandItem({ name: "aidlc:do", args: "PROJ-1" })], ["PROJ-12", null, null]);

{
  let l = { item: null, phase: null, baseline: null };
  let r = advance(l, { item: "P-1", phase: "start" }, 2);
  check("starting a run charges nothing", [r.charges, r.ledger], [[], { item: "P-1", phase: "start", baseline: 2 }]);
  r = advance(r.ledger, { item: "P-1", phase: "implement" }, 2.5);
  check("a phase change charges the phase that ended", r.charges, [{ item: "P-1", phase: "start", usd: 0.5 }]);
  r = advance(r.ledger, { item: "P-1", phase: "implement" }, 3.5);
  check("a flush charges so far and carries on", [r.charges, r.ledger.phase, r.ledger.baseline], [[{ item: "P-1", phase: "implement", usd: 1 }], "implement", 3.5]);
  r = advance(r.ledger, { item: "P-1", phase: "done" }, 4);
  check("done charges the last phase and stops", [r.charges[0].usd, r.ledger.item], [0.5, null]);
  r = advance(r.ledger, null, 9);
  check("spend after the run is charged to nothing", r.charges, []);
  r = advance({ item: "P-1", phase: "verify", baseline: 5 }, { item: "P-1", phase: "verify" }, 1);
  check("a cost that went down charges nothing and restarts", [r.charges, r.ledger.baseline], [[], 1]);
}
check("ledger names are path-safe", [ledgerName("PROJ-1", "1a2b3c4d-5e6f"), ledgerName("../x", "ab/cd")], ["PROJ-1--1a2b3c4d.json", ".._x--abcd.json"]);
{
  const first = mergeLedger(null, { item: "P-1", session: "s1", now: "2026-10-25T10:00:00Z" }, [{ item: "P-1", phase: "start", usd: 0.5 }]);
  const second = mergeLedger(first, { item: "P-1", session: "s1", now: "2026-10-25T11:00:00Z" }, [{ item: "P-1", phase: "start", usd: 0.25 }, { item: "P-1", phase: "verify", usd: 1 }]);
  check("charges add up per phase, started is kept", [second.phases, second.started, second.updated], [{ start: 0.75, verify: 1 }, "2026-10-25T10:00:00Z", "2026-10-25T11:00:00Z"]);
}
check("the band shows what a run has cost", bandModel({ runs: [{ item: "P-1", phase: "verify" }], sprint: null, costs: { "P-1": 1.84 }, at: 0, problem: null }).lines[0].text, "AIDLC  P-1 · verify · $1.84");
check("an unmeasured run shows no price", runLine({ item: "P-1", phase: "verify" }).text, "P-1 · verify");
check("a sub-cent run is not shown as free", runLine({ item: "P-1", phase: "verify" }, 0.0015).text, "P-1 · verify · <$0.01");

// ---- this session's work
check("editing tools name their file; others do not", [editedPath("Edit", { file_path: "a.ts" }), editedPath("NotebookEdit", { notebook_path: "n.ipynb" }), editedPath("Read", { file_path: "a.ts" })], ["a.ts", "n.ipynb", null]);
check("a workspace path, whatever the spelling", workspacePath("D:\\RTO Tool", "d:\\RTO Tool\\core-api\\src\\a.ts"), "core-api/src/a.ts");
check("…and on posix", workspacePath("/ws", "/ws/src/a.ts"), "src/a.ts");
check("outside the workspace, or bookkeeping, is not work", [workspacePath("/ws", "/other/a.ts"), workspacePath("/ws", "/ws/.aidlc/runs/P-1.md"), workspacePath("/ws", "/ws/api/.claude/x.json")], [null, null, null]);
check("checks a shell line runs", checksIn("npm run lint && npm test -- --run && npx tsc --noEmit"), ["lint", "tests", "typecheck"]);
check("…a check named in a commit message is not one", checksIn('git commit -m "add tests for lint"'), []);
check("…nor a search for one", checksIn("grep -r test src | head"), []);
check("python and go too", [checksIn("python -m pytest -q"), checksIn("go test ./..."), checksIn("uv run ruff check .")], [["tests"], ["tests"], ["lint"]]);
check("a commit is spotted, a dry run is not", [makesCommit('git add -A && git commit -m "x"'), makesCommit('git -C "core api" commit -m x'), makesCommit("git commit --dry-run"), makesCommit("git status")], [true, true, false, false]);
{
  let w = noteEdit(null, "src/a.ts", 1000);
  w = noteEdit(w, "src/b.ts", 2000);
  w = noteChecks(w, ["tests"], true, 1500);
  w = noteChecks(w, ["lint"], false, 2500);
  w = noteCommit(w);
  check("work is kept as plain data", w, { files: { "src/a.ts": 1000, "src/b.ts": 2000 }, checks: { tests: { at: 1500, ok: true }, lint: { at: 2500, ok: false } }, commits: 1 });

  const git = [parseGitStatus("## feature/x...origin/feature/x [ahead 2]\0 M src/a.ts\0R  src/new.ts\0src/old.ts\0?? src/c.ts\0", ".")];
  check("git status: branch, ahead, and each changed path (a rename's new name)", git[0], { repo: ".", branch: "feature/x", ahead: 2, behind: 0, dirty: ["src/a.ts", "src/new.ts", "src/c.ts"] });
  check("…a poly repo's paths carry its folder", parseGitStatus("## main\0 M x.ts\0", "core-api").dirty, ["core-api/x.ts"]);

  const ctx = { modules: [{ name: "bookings", page: "modules/bookings", area: null, title: "Bookings", purpose: "Booking requests and their approval.", rules: ["Approvals never skip the manager."], connectsTo: ["Payments"], usedBy: [{ name: "invoices", recorded: true, live: true }, { name: "reports", recorded: false, live: true }], assumed: 2, gaps: 0, state: "behind", behindFiles: 3, files: ["src/a.ts"] }], unmapped: ["src/b.ts"], partial: false };
  const s = sessionModel(w, git, ctx);
  check("the session: files, uncommitted, by module", [s.title, s.lines.map((l) => l.text).filter((t) => /^(bookings|other files):/.test(t))], ["This session · 2 files changed, 1 uncommitted", ["other files: b.ts · committed", "bookings: a.ts · 1 uncommitted"]]);
  check("…a check run before the last edit is stale; one after says how it went", s.checks.map((c) => [c.kind, c.state]), [["tests", "stale"], ["lint", "failed"]]);
  check("the band's work line names the module, what uses it and the worst check", workLine(s, ctx), { text: "bookings · 2 files (1 uncommitted) · used by 2 · lint failed", tone: "warning" });
  check("…and leads the band", bandModel({ runs: [{ item: "P-1", phase: "implement" }], sprint: null, context: ctx, git, at: 0, problem: null }, w).lines.map((l) => l.text), ["AIDLC  bookings · 2 files (1 uncommitted) · used by 2 · lint failed", "       P-1 · implement"]);
  check("nothing changed → no work line", workLine(sessionModel(null, git, null), null), null);

  const [here] = contextModel(ctx);
  check("you're in: the page's title, purpose, rules and what uses it", [here.title, here.lines.map((l) => l.text).slice(0, 3)], ["You're in: Bookings", ["Booking requests and their approval.", "Rule: Approvals never skip the manager.", "Used by: invoices, reports (1 not on its page yet)"]]);
  check("…what waits on a person, and that the page is behind, with the command that fixes it", [here.lines.some((l) => /2 assumptions waiting on a person/.test(l.text)), here.lines.some((l) => /behind the code \(3 files moved/.test(l.text)), here.learn], [true, true, "/aidlc:learn bookings"]);
  const [bare] = contextModel({ modules: [{ ...ctx.modules[0], page: null, title: null, purpose: null, rules: [], usedBy: [], assumed: 0, state: null }], unmapped: [], partial: false });
  check("a module with no page says how to start one", [bare.title, bare.lines.map((l) => l.text)], ["You're in: bookings", ["Nothing else in the code uses it.", "Connects to: Payments", "No brain page yet — /aidlc:learn bookings writes one."]]);

  check("repo roots: declared repos first, then the workspace", repoRoots({ workspace: { root: "." }, repos: [{ path: "core-api" }, { path: "E:/elsewhere" }] }, "D:/ws"), [{ key: "core-api", dir: "D:/ws/core-api" }, { key: ".", dir: "D:/ws" }]);
  check("…and a path's repo", [repoOf(repoRoots({ repos: [{ path: "core-api" }] }, "/ws"), "core-api/src/a.ts").key, repoOf(repoRoots({}, "/ws"), "x.ts").key], ["core-api", "."]);
}

// ---- the board as a tree
{
  const leaf = (id, type, status, extra = {}) => ({ id, type, title: `${type} ${id}`, status, parent: null, run: null, counts: { total: 0, done: 0, openBugs: 0 }, children: [], ...extra });
  const story = leaf("12", "story", "in_progress", { run: "implement", counts: { total: 2, done: 1, openBugs: 1 }, children: [leaf("13", "task", "done"), leaf("14", "bug", "todo")] });
  const epic = leaf("10", "epic", "in_progress", { title: "Bookings", counts: { total: 4, done: 2, openBugs: 1 }, children: [leaf("11", "story", "done"), story] });
  const later = leaf("20", "epic", "todo", { title: "Invoices", counts: { total: 1, done: 0, openBugs: 0 }, children: [leaf("21", "story", "todo")] });
  const rows = treeRows([epic, later]);
  check(
    "an epic under way opens one level; children drawn as a tree",
    rows.map((r) => r.text),
    [
      "▾ #10 epic · Bookings · in progress · 2/4 done · 1 open bug",
      "├─ #11 story · story 11 · done",
      "└─ ▸ #12 story · story 12 · in progress · run: implement · 1/2 done · 1 open bug",
      "▸ #20 epic · Invoices · to do · 0/1 done",
    ],
  );
  const opened = treeRows([epic], { 12: true });
  check("opening a story shows its tasks and bugs, indented under it", opened.slice(-2).map((r) => r.text), ["   ├─ #13 task · task 13 · done", "   └─ #14 bug · bug 14 · to do"]);
  check("an open bug stands out; done is green", [opened.at(-1).tone, opened[1].tone], ["warning", "success"]);
  check("closing an open epic hides its children", treeRows([epic], { 10: false }).length, 1);
  check("markdown ids are shown as they are", treeRows([leaf("P-3", "bug", "todo")])[0].text, "P-3 bug · bug P-3 · to do");

  const m = treeModel({ source: "ado", roots: [epic], loose: [leaf("30", "bug", "todo")], hiddenDone: 2 });
  check("the tree's title counts open and finished epics", m.title, "Epics · 1 open · 2 finished not shown");
  check("…bugs under no epic are listed apart", m.loose.map((r) => r.text), ["#30 bug · bug 30 · to do"]);
  check("a snapshot says how old it is and who refreshes it", treeModel({ source: "snapshot", at: "2026-10-30T09:15:00Z", note: "az not signed in (az login)", roots: [], loose: [], hiddenDone: 0 }).note, "from the snapshot of 2026-10-30 09:15 (az not signed in (az login)) — /aidlc:status refreshes it");
  check("a board that cannot be read says why", treeModel({ error: "az not signed in (az login)" }).note, "az not signed in (az login)");
  const text = boardText({ runs: [], sprint: null, tree: { source: "ado", roots: [epic], loose: [], hiddenDone: 0 }, at: 0, problem: null }, null, {});
  check("the board text carries the tree", /Epics · 1 open\n  ▾ #10 epic · Bookings/.test(text), true);
}

check("core version check", [coreTooOld("0.66.0", "0.67.0"), coreTooOld("0.67.0", "0.67.0"), coreTooOld("1.0.0", "0.67.0"), coreTooOld(undefined, "0.67.0")], [true, false, false, true]);

done();
