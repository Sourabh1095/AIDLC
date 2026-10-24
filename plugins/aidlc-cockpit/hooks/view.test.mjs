// Tests for view.mjs, the cockpit's logic. Run: `node view.test.mjs`.
//
// The mod itself runs only inside Claude Code (its own tests: `claude plugin test plugins/aidlc-cockpit`).
// Everything that decides what a person sees is here, so CI checks it on every OS.
import { bandModel, boardText, coreCandidates, newestSprintFile, prLabel, runLine, transitions } from "./view.mjs";
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

done();
