// The aidlc-cockpit mod's logic: plain data in, plain data out. The mod (register.tsx) gathers the
// data through Claude Code and draws; everything that decides WHAT to show lives here, so node can
// test it (view.test.mjs) on every OS in CI, where no Claude Code runs.
//
// The data itself is never computed here. Runs come from core's `run-files.mjs --json` and the sprint
// board from core's `sprint.mjs board --json`, so the cockpit cannot disagree with /aidlc:status or
// /aidlc:sprint about what a run is doing.

const MAX_RUN_LINES = 3;
const MAX_NEED_LINES = 2;

export const toSlash = (p) => String(p).replace(/\\/g, "/").replace(/\/+$/, "");
const parent = (p) => {
  const parts = toSlash(p).split("/");
  parts.pop();
  return parts.join("/");
};

function compareVersions(a, b) {
  const pa = String(a).split(".").map((n) => parseInt(n, 10));
  const pb = String(b).split(".").map((n) => parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    const d = (Number.isNaN(pa[i]) ? -1 : pa[i] ?? 0) - (Number.isNaN(pb[i]) ? -1 : pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

// Where the aidlc core plugin can be, given this plugin's root, best guess first:
//   <root>/../aidlc-core              a checkout, a --plugin-dir, or a folder marketplace
//   <root>/../../aidlc/<version>      Claude Code's plugin cache (cache/<marketplace>/<plugin>/<version>),
//                                     newest version first
// `cacheVersions` is the listing of <root>/../../aidlc (directory names), or [] when it does not exist.
export function coreCandidates(root, cacheVersions = []) {
  const r = toSlash(root);
  const out = [`${parent(r)}/aidlc-core`];
  const cache = `${parent(parent(r))}/aidlc`;
  for (const v of [...cacheVersions].sort((a, b) => compareVersions(b, a))) out.push(`${cache}/${v}`);
  return out;
}
export const cacheDirOf = (root) => `${parent(parent(toSlash(root)))}/aidlc`;

// The newest sprint file in a listing of .aidlc/ (`{ name, kind, mtimeMs }` entries), or null.
export function newestSprintFile(entries) {
  const files = (entries ?? []).filter((e) => e.kind === "file" && /^sprint-.+\.json$/.test(e.name));
  files.sort((a, b) => (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0));
  return files[0]?.name ?? null;
}

export function prLabel(pr) {
  if (!pr || pr === "null") return null;
  const n = /\/(?:pull|pullrequest|merge_requests)\/(\d+)/.exec(pr);
  if (n) return `PR #${n[1]}`;
  const local = /^local-merge:([0-9a-f]{7})/.exec(pr);
  return local ? `merged ${local[1]}` : "PR";
}

const WAITING_PHASES = new Set(["blocked", "review-pending"]);
const fixLabel = (n) => (n && n !== "0" && n !== "null" ? `fix-cycle ${n}` : null);
const repoLabel = (r) => (r && r !== "null" && r !== "control-plane" ? r : null);

// One run, as one line.
export function runLine(run) {
  const waiting = WAITING_PHASES.has(run.phase);
  const bits = [run.item, repoLabel(run.repo), run.phase, fixLabel(run.fixCycles), prLabel(run.pr)].filter(Boolean);
  const hint = run.phase === "blocked" ? ` → /aidlc:run ${run.item}` : run.phase === "review-pending" ? " → waiting for your review" : "";
  return { text: bits.join(" · ") + hint, tone: waiting ? "warning" : "subtle" };
}

// The line above the prompt, or null when there is nothing worth the room. A sprint, when one is
// running, takes the band: it is the one place several runs can each be waiting on the person.
export function bandModel(snapshot) {
  if (!snapshot) return null;
  if (snapshot.problem) return { lines: [{ text: `AIDLC cockpit: ${snapshot.problem}`, tone: "subtle" }], needsYou: 0 };
  const rows = snapshot.sprint?.rows ?? [];
  if (rows.length && !snapshot.sprint.allTerminal) {
    const need = rows.filter((r) => r.needsYou && !r.terminal);
    const inFlight = rows.filter((r) => !r.terminal).length;
    const lines = [
      {
        text: `AIDLC sprint · ${rows.length} run${rows.length === 1 ? "" : "s"} · ${inFlight} in flight${need.length ? ` · ${need.length} need${need.length === 1 ? "s" : ""} you` : ""}`,
        tone: need.length ? "warning" : "subtle",
      },
    ];
    for (const r of need.slice(0, MAX_NEED_LINES))
      lines.push({ text: `  ${r.item}: ${r.waitingFor ?? r.status}${r.session ? ` → claude attach ${r.session}` : ""}`, tone: "warning" });
    if (need.length > MAX_NEED_LINES) lines.push({ text: `  +${need.length - MAX_NEED_LINES} more — /aidlc-board`, tone: "subtle" });
    return { lines, needsYou: need.length };
  }
  const runs = snapshot.runs ?? [];
  if (!runs.length) return null;
  // Runs waiting on the person first: they are the reason to look.
  const ordered = [...runs].sort((a, b) => Number(WAITING_PHASES.has(b.phase)) - Number(WAITING_PHASES.has(a.phase)));
  const lines = ordered.slice(0, MAX_RUN_LINES).map(runLine);
  lines[0] = { ...lines[0], text: `AIDLC  ${lines[0].text}` };
  for (let i = 1; i < lines.length; i++) lines[i] = { ...lines[i], text: `       ${lines[i].text}` };
  if (runs.length > MAX_RUN_LINES) lines.push({ text: `       +${runs.length - MAX_RUN_LINES} more — /aidlc-board`, tone: "subtle" });
  return { lines, needsYou: runs.filter((r) => WAITING_PHASES.has(r.phase)).length };
}

// The board as plain text: the /aidlc-board reply, for surfaces that draw no pane.
export function boardText(snapshot) {
  if (!snapshot) return "Not an AIDLC workspace (no .claude/aidlc.config.json here).";
  if (snapshot.problem) return `AIDLC cockpit: ${snapshot.problem}`;
  const out = [];
  const runs = snapshot.runs ?? [];
  out.push(runs.length ? `Runs (${runs.length}):` : "No AIDLC runs in flight.");
  for (const r of runs) out.push(`  ${runLine(r).text}`);
  const rows = snapshot.sprint?.rows ?? [];
  if (rows.length) {
    out.push("", `Sprint (${rows.length}):`);
    for (const r of rows) out.push(`  ${r.item} · ${r.phase ?? "—"} · ${r.waitingFor ? `${r.status} (${r.waitingFor})` : r.status}${r.needsYou ? ` → ${r.needsYou}` : ""}`);
  }
  return out.join("\n");
}

// What changed between two sprint boards that is worth interrupting someone for: a run starting to
// wait on them, and a run finishing. The first board of a session notifies nothing; the person can
// see it, and a notification for every row already on it would be noise.
export function transitions(prevRows, rows) {
  if (!prevRows || !rows) return [];
  const before = new Map(prevRows.map((r) => [r.item, r]));
  const out = [];
  for (const r of rows) {
    const was = before.get(r.item);
    if (!was) continue;
    const waitsNow = r.status === "NEEDS YOU" && !r.terminal;
    const waitedBefore = was.status === "NEEDS YOU" && !was.terminal;
    if (waitsNow && (!waitedBefore || was.waitingFor !== r.waitingFor))
      out.push({ item: r.item, kind: "needs-you", text: `${r.item} needs you: ${r.waitingFor ?? "an answer"}` });
    else if (r.terminal && !was.terminal) out.push({ item: r.item, kind: "over", text: `${r.item}: ${r.status}` });
  }
  return out;
}
