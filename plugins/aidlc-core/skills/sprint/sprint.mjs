#!/usr/bin/env node
// Launch and watch /aidlc:sprint runs.
//
//   node sprint.mjs launch <ID> --cwd <dir> --run-file <path> --sprint-file <path>
//                          [--mode mono|poly] [--repo <name>] [--worktree <path>] [--effort <level>] [--headless]
//   node sprint.mjs board  --sprint-file <path> [--agents-json <file>] [--json]
//   node sprint.mjs watch  --sprint-file <path> [--interval <seconds>]
//
// Each run is a Claude Code BACKGROUND SESSION (`claude --bg`), not a `claude -p` process. The
// difference is the whole point: a `-p` run has no way to ask anything, so a plan approval, an `ask`
// verification or a local-merge confirmation either stalled it or got skipped. A background session
// can ask. It shows as `blocked` in `claude agents`, the board says who is waiting on what, and the
// person answers from agent view or `claude attach`. Its process is also supervised: a crash restarts
// it, and a blocked run keeps its conversation for later.
//
// `--headless` is the fallback for a Claude Code without background sessions: the old `claude -p`
// launch, detached, with a log file. The board reads both kinds.
//
// Two launch details are load-bearing:
//   - `--settings bg-settings.json` sets `worktree.bgIsolation: "none"`. A background session
//     otherwise moves into a worktree of its own before its first edit. In poly that worktree is of
//     the control plane, which has no product repos in it. AIDLC already owns isolation (one item per
//     working tree, sprint §1.3), so Claude Code must not add a second layer.
//   - Trust is not asked for. Run from a script, `claude --bg` in an untrusted folder exits with
//     "Workspace not trusted" instead of prompting, so mono worktrees are trusted before launch (§2a).
//
// Never throws on bad state. A board that crashes tells nobody which run needs them.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isMain, parseArgs, tryJson } from "../../hooks/scripts/lib/cli.mjs";
import { frontmatter } from "../../hooks/scripts/lib/run-files.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const BG_SETTINGS = join(HERE, "bg-settings.json");
const PLUGIN_ROOT = resolve(HERE, "..", "..");

// The runs must execute the same plugin code as the sprint that launched them. An installed plugin
// lives in Claude Code's plugin cache, and a fresh session loads that copy by itself. Anything else is
// a checkout loaded with `--plugin-dir` (someone developing AIDLC), and without passing it on, every
// child run would quietly load the installed version instead. A `--plugin-dir` copy wins over an
// installed plugin of the same name (verified: it reports as `aidlc@inline`).
export function pluginDirArgs(root = PLUGIN_ROOT) {
  return /[\\/]plugins[\\/]cache[\\/]/i.test(root) ? [] : ["--plugin-dir", root];
}

// ---- talking to Claude Code ---------------------------------------------------------------

// The running session's own binary when the environment names it, else `claude` on PATH. On Windows
// an npm install is `claude.cmd`, which only a shell can start, so PATH lookups go through one there.
function claudeInvocation(args) {
  const exec = process.env.CLAUDE_CODE_EXECPATH;
  if (exec && existsSync(exec) && /claude(\.exe)?$/i.test(basename(exec))) return { cmd: exec, args, shell: false };
  if (process.platform === "win32") return { cmd: "claude", args: args.map((a) => (/[\s"&|<>^]/.test(a) ? `"${a}"` : a)), shell: true };
  return { cmd: "claude", args, shell: false };
}

function runClaude(args, cwd, timeout = 60000) {
  const inv = claudeInvocation(args);
  const r = spawnSync(inv.cmd, inv.args, { cwd, shell: inv.shell, encoding: "utf8", timeout, windowsHide: true });
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}`, error: r.error };
}

// `backgrounded · 96e838a6 · aidlc-PROJ-124` → { session, name }
export function parseBackgrounded(out) {
  const m = /backgrounded\s*·\s*([0-9a-f]{6,})(?:\s*·\s*(\S+))?/i.exec(String(out));
  return m ? { session: m[1], name: m[2] ?? null } : null;
}

// Why a `--bg` launch did not start, in the terms the skill acts on.
export function launchFailure(out) {
  const s = String(out);
  if (/not trusted/i.test(s)) return "untrusted";
  if (/unknown option|unrecognized option|unknown argument|--bg.*(not|un)(available|supported)/i.test(s)) return "bg-unavailable";
  return "failed";
}

// ---- the sprint file ----------------------------------------------------------------------

export function readSprint(path) {
  const j = tryJson(path);
  return j && Array.isArray(j.runs) ? j : { runs: [] };
}

function recordRun(path, entry) {
  const s = readSprint(path);
  s.runs = s.runs.filter((r) => r.item !== entry.item).concat(entry);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(s, null, 2)}\n`);
}

// ---- the board ----------------------------------------------------------------------------

const TERMINAL_PHASE = new Set(["done", "review-pending", "blocked", "abandoned"]);

// The run file, or its archived copy once the run moved it.
function runState(runFile) {
  if (!runFile) return null;
  const archived = join(dirname(runFile), "archive", basename(runFile));
  return frontmatter(runFile) ?? frontmatter(archived);
}

const pidAlive = (pid) => {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
};

export function prLabel(pr) {
  if (!pr || pr === "null") return null;
  const n = /\/(?:pull|pullrequest|merge_requests)\/(\d+)/.exec(pr);
  if (n) return `PR #${n[1]} open`;
  const local = /^local-merge:([0-9a-f]{7})/.exec(pr);
  return local ? `merged locally ${local[1]}` : "PR open";
}

// One row of the board: what the run is doing and whether it is over (for this sprint) or needs a
// person. `agent` is the session's `claude agents --json` entry (undefined: not listed; null: the
// listing itself failed); `fm` is the run file's frontmatter (null: no run file yet); `alive` is for
// headless runs only.
export function rowFor(entry, { agent, fm, alive }) {
  const phase = fm?.phase ?? null;
  const base = { item: entry.item, repo: entry.repo ?? null, phase, fixCycles: fm?.fixCycles ?? null, branch: fm?.branch ?? null };
  const howToAnswer =
    entry.launch === "bg" ? `\`claude agents\` (Space on ${entry.name ?? entry.session}) or \`claude attach ${entry.session}\`` : `\`/aidlc:run ${entry.item}\``;

  if (phase && TERMINAL_PHASE.has(phase)) {
    if (phase === "done") return { ...base, status: prLabel(fm.pr) ?? "done", terminal: true };
    if (phase === "review-pending") return { ...base, status: "waiting for your review", terminal: true, needsYou: `review the branch, then ${howToAnswer}` };
    if (phase === "abandoned") return { ...base, status: "abandoned", terminal: true };
    return { ...base, status: "blocked", terminal: true, needsYou: `read \`## Findings\` in its run file, then ${howToAnswer}` };
  }

  if (entry.launch === "headless") {
    if (alive) return { ...base, status: phase ? "running" : "starting", terminal: false };
    return { ...base, status: phase ? "exited mid-run" : "dead on arrival", terminal: true, needsYou: `read ${entry.logfile ?? "its log"}` };
  }

  if (agent === null) return { ...base, status: "session state unknown", terminal: false };
  if (agent === undefined) return { ...base, status: phase ? "session gone" : "dead on arrival", terminal: true, needsYou: `\`claude logs ${entry.session}\`` };
  switch (agent.state) {
    case "working":
      return { ...base, status: phase ? "running" : "starting", terminal: false };
    case "blocked":
      // Two different waits share this state. `status: "waiting"` with a `waitingFor` is an open
      // dialog (a question, a permission prompt). `status: "idle"` with no `waitingFor` is a turn that
      // ENDED on something the person must answer. That second shape is also what a run that died
      // before writing its run file looks like, and that is F42's dead-on-arrival case (observed live:
      // `/aidlc:run` in a folder with no config).
      if (agent.status === "waiting" || agent.waitingFor)
        return { ...base, status: "NEEDS YOU", waitingFor: agent.waitingFor ?? "your answer", terminal: false, needsYou: `${agent.waitingFor ?? "it is waiting on you"} → ${howToAnswer}` };
      if (!phase) return { ...base, status: "dead on arrival", terminal: true, needsYou: `\`claude logs ${entry.session}\`` };
      return { ...base, status: "NEEDS YOU", waitingFor: "a reply", terminal: false, needsYou: `it ended its turn asking you something → ${howToAnswer}` };
    case "done":
      // The session ended its turn, but the run file says the pipeline is not over: it most likely
      // asked something in plain text, or stopped short. Either way a person has to look.
      if (!phase) return { ...base, status: "dead on arrival", terminal: true, needsYou: `\`claude logs ${entry.session}\`` };
      return { ...base, status: "stopped at " + phase, terminal: false, needsYou: `it ended its turn mid-run — read its last message: ${howToAnswer}` };
    default:
      return { ...base, status: `session ${agent.state ?? "unknown"}`, terminal: true, needsYou: `\`claude logs ${entry.session}\`` };
  }
}

export function boardRows(sprint, agents) {
  return sprint.runs.map((entry) => {
    const fm = runState(entry.runFile);
    if (entry.launch === "headless") return rowFor(entry, { fm, alive: pidAlive(entry.pid) });
    const agent = agents === null ? null : agents.find((a) => a.id === entry.session || a.sessionId === entry.sessionId);
    return rowFor(entry, { agent, fm });
  });
}

export function renderBoard(rows) {
  const poly = rows.some((r) => r.repo);
  const need = rows.filter((r) => r.needsYou);
  const running = rows.filter((r) => !r.terminal).length;
  const lines = [`Sprint board — ${rows.length} run${rows.length === 1 ? "" : "s"} · ${running} in flight${need.length ? ` · ${need.length} need${need.length === 1 ? "s" : ""} you` : ""}`];
  for (const r of rows) {
    const cols = [r.item.padEnd(10)];
    if (poly) cols.push(String(r.repo ?? "-").padEnd(10));
    cols.push(String(r.phase ?? "—").padEnd(14));
    cols.push((r.fixCycles && r.fixCycles !== "0" ? `fix-cycle ${r.fixCycles}` : "—").padEnd(12));
    cols.push(r.waitingFor ? `${r.status} · ${r.waitingFor}` : r.status);
    lines.push(`  ${cols.join(" ")}`);
  }
  if (need.length) {
    lines.push("Needs you:");
    for (const r of need) lines.push(`  ${r.item}: ${r.needsYou}`);
  }
  return lines.join("\n");
}

function listAgents(agentsJson) {
  if (agentsJson) return tryJson(agentsJson);
  const r = runClaude(["agents", "--json", "--all"], process.cwd(), 30000);
  try {
    const j = JSON.parse(r.out.slice(r.out.indexOf("[")));
    return Array.isArray(j) ? j : null;
  } catch {
    return null;
  }
}

// ---- launch -------------------------------------------------------------------------------

function launch(id, flags) {
  const cwd = resolve(flags["--cwd"] ?? process.cwd());
  const effort = flags["--effort"] ?? "medium";
  const name = `aidlc-${id}`;
  // `--sprint` tells the run it is one of several: ask at gates, take the default at offers.
  const prompt = `/aidlc:run ${id} --sprint`;
  const entry = {
    item: id,
    repo: flags["--repo"] ?? null,
    mode: flags["--mode"] ?? "mono",
    cwd,
    worktree: flags["--worktree"] ?? null,
    runFile: resolve(cwd, flags["--run-file"] ?? join(".aidlc", "runs", `${id}.md`)),
    launchedAt: new Date().toISOString(),
  };

  if (flags["--headless"]) {
    // `.aidlc/logs/` is already git-ignored by the project template.
    const logfile = join(dirname(resolve(flags["--sprint-file"])), "logs", `sprint-${id}.log`);
    mkdirSync(dirname(logfile), { recursive: true });
    const fd = openSync(logfile, "a");
    const inv = claudeInvocation(["-p", prompt, "--permission-mode", "acceptEdits", "--effort", effort, ...pluginDirArgs()]);
    const child = spawn(inv.cmd, inv.args, { cwd, shell: inv.shell, detached: true, stdio: ["ignore", fd, fd], windowsHide: true });
    child.unref();
    recordRun(flags["--sprint-file"], { ...entry, launch: "headless", pid: child.pid, logfile });
    return { ok: true, item: id, launch: "headless", pid: child.pid, logfile };
  }

  const r = runClaude(["--bg", "--name", name, "--permission-mode", "acceptEdits", "--effort", effort, "--settings", BG_SETTINGS, ...pluginDirArgs(), prompt], cwd);
  const started = parseBackgrounded(r.out);
  if (!started) return { ok: false, item: id, reason: launchFailure(r.out), output: r.out.trim().split("\n").slice(-6).join("\n") };
  const agent = (listAgents() ?? []).find((a) => a.id === started.session);
  recordRun(flags["--sprint-file"], { ...entry, launch: "bg", session: started.session, sessionId: agent?.sessionId ?? null, name: started.name ?? name });
  return { ok: true, item: id, launch: "bg", session: started.session, name: started.name ?? name };
}

// ---- CLI ----------------------------------------------------------------------------------

if (isMain(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  const { flags, positional } = parseArgs(rest, ["--cwd", "--run-file", "--sprint-file", "--mode", "--repo", "--worktree", "--effort", "--agents-json", "--interval"]);
  if (!flags["--sprint-file"] || !["launch", "board", "watch"].includes(cmd) || (cmd === "launch" && !positional[0])) {
    console.error("usage: sprint.mjs launch <ID> --cwd <dir> --run-file <path> --sprint-file <path> [--mode mono|poly] [--repo <r>] [--worktree <p>] [--effort <lvl>] [--headless]\n       sprint.mjs board|watch --sprint-file <path> [--agents-json <file>] [--json] [--interval <s>]");
    process.exit(2);
  }
  const sprintFile = resolve(flags["--sprint-file"]);

  if (cmd === "launch") {
    const res = launch(positional[0], { ...flags, "--sprint-file": sprintFile });
    console.log(JSON.stringify(res));
    process.exit(res.ok ? 0 : 1);
  }

  const snapshot = () => boardRows(readSprint(sprintFile), listAgents(flags["--agents-json"]));

  if (cmd === "board") {
    const rows = snapshot();
    console.log(flags["--json"] ? JSON.stringify({ rows, allTerminal: rows.every((r) => r.terminal) }, null, 2) : renderBoard(rows));
    process.exit(0);
  }

  // watch: one line per change, for the Monitor tool. Ends when every run is over for this sprint.
  const interval = Math.max(15, Number(flags["--interval"] ?? 60)) * 1000;
  const seen = new Map();
  const tick = () => {
    const rows = snapshot();
    for (const r of rows) {
      const key = `${r.status}|${r.phase}|${r.fixCycles}|${r.waitingFor ?? ""}`;
      if (seen.get(r.item) === key) continue;
      seen.set(r.item, key);
      const stamp = new Date().toISOString().slice(11, 16);
      console.log(`${stamp} ${r.item}: ${r.status}${r.waitingFor ? ` (${r.waitingFor})` : ""} · phase ${r.phase ?? "—"}${r.needsYou ? ` · needs you: ${r.needsYou}` : ""}`);
    }
    if (rows.length && rows.every((r) => r.terminal)) {
      console.log("all sprint runs are over — render the board and wrap up");
      process.exit(0);
    }
  };
  tick();
  setInterval(tick, interval);
}
