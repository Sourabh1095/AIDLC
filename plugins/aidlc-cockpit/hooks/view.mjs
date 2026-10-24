// The aidlc-cockpit mod's logic: plain data in, plain data out. The mod (register.tsx) gathers the
// data through Claude Code and draws; everything that decides WHAT to show lives here, so node can
// test it (view.test.mjs) on every OS in CI, where no Claude Code runs.
//
// The data itself is never computed here. Runs come from core's `run-files.mjs --json` and the sprint
// board from core's `sprint.mjs board --json`, so the cockpit cannot disagree with /aidlc:status or
// /aidlc:sprint about what a run is doing.

const MAX_RUN_LINES = 3;
const MAX_NEED_LINES = 2;
const MAX_PR_LINES = 2;

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

export const money = (usd) => (usd == null || !(usd > 0) ? null : usd >= 10 ? `$${usd.toFixed(0)}` : usd < 0.01 ? "<$0.01" : `$${usd.toFixed(2)}`);

// One run, as one line. `usd` is what it has cost so far, when the ledger measured it.
export function runLine(run, usd) {
  const waiting = WAITING_PHASES.has(run.phase);
  const bits = [run.item, repoLabel(run.repo), run.phase, fixLabel(run.fixCycles), prLabel(run.pr), money(usd)].filter(Boolean);
  const hint = run.phase === "blocked" ? ` → /aidlc:run ${run.item}` : run.phase === "review-pending" ? " → waiting for your review" : "";
  return { text: bits.join(" · ") + hint, tone: waiting ? "warning" : "subtle" };
}

// One PR that needs something, as one line.
export const prLine = (p) => `${p.item} PR #${p.number}: ${p.next}`;

// The line above the prompt, or null when there is nothing worth the room. A sprint, when one is
// running, takes the band: it is the one place several runs can each be waiting on the person. Pull
// requests that need something (review comments, a red check, a merge to clean up) follow either.
export function bandModel(snapshot) {
  if (!snapshot) return null;
  if (snapshot.problem) return { lines: [{ text: `AIDLC cockpit: ${snapshot.problem}`, tone: "subtle" }], needsYou: 0 };
  const lines = [];
  let needsYou = 0;
  const rows = snapshot.sprint?.rows ?? [];
  if (rows.length && !snapshot.sprint.allTerminal) {
    const need = rows.filter((r) => r.needsYou && !r.terminal);
    const inFlight = rows.filter((r) => !r.terminal).length;
    lines.push({
      text: `AIDLC sprint · ${rows.length} run${rows.length === 1 ? "" : "s"} · ${inFlight} in flight${need.length ? ` · ${need.length} need${need.length === 1 ? "s" : ""} you` : ""}`,
      tone: need.length ? "warning" : "subtle",
    });
    for (const r of need.slice(0, MAX_NEED_LINES))
      lines.push({ text: `  ${r.item}: ${r.waitingFor ?? r.status}${r.session ? ` → claude attach ${r.session}` : ""}`, tone: "warning" });
    if (need.length > MAX_NEED_LINES) lines.push({ text: `  +${need.length - MAX_NEED_LINES} more — /aidlc-board`, tone: "subtle" });
    needsYou += need.length;
  } else {
    const runs = snapshot.runs ?? [];
    // Runs waiting on the person first: they are the reason to look.
    const ordered = [...runs].sort((a, b) => Number(WAITING_PHASES.has(b.phase)) - Number(WAITING_PHASES.has(a.phase)));
    for (const r of ordered.slice(0, MAX_RUN_LINES)) lines.push(runLine(r, snapshot.costs?.[r.item]));
    if (runs.length > MAX_RUN_LINES) lines.push({ text: `+${runs.length - MAX_RUN_LINES} more — /aidlc-board`, tone: "subtle" });
    needsYou += runs.filter((r) => WAITING_PHASES.has(r.phase)).length;
  }
  const prs = (snapshot.prs ?? []).filter((p) => p.next);
  for (const p of prs.slice(0, MAX_PR_LINES)) lines.push({ text: prLine(p), tone: "warning" });
  if (prs.length > MAX_PR_LINES) lines.push({ text: `+${prs.length - MAX_PR_LINES} more PRs — /aidlc-board`, tone: "subtle" });
  needsYou += prs.length;
  if (!lines.length) return null;
  // One label for the band; the sprint header carries its own, sprint detail lines keep their indent.
  return {
    lines: lines.map((l, i) => (i === 0 ? (l.text.startsWith("AIDLC") ? l : { ...l, text: `AIDLC  ${l.text}` }) : l.text.startsWith("  ") ? l : { ...l, text: `       ${l.text}` })),
    needsYou,
  };
}

// The board as plain text: the /aidlc-board reply, for surfaces that draw no pane.
export function boardText(snapshot) {
  if (!snapshot) return "Not an AIDLC workspace (no .claude/aidlc.config.json here).";
  if (snapshot.problem) return `AIDLC cockpit: ${snapshot.problem}`;
  const out = [];
  const runs = snapshot.runs ?? [];
  out.push(runs.length ? `Runs (${runs.length}):` : "No AIDLC runs in flight.");
  for (const r of runs) out.push(`  ${runLine(r, snapshot.costs?.[r.item]).text}`);
  const rows = snapshot.sprint?.rows ?? [];
  if (rows.length) {
    out.push("", `Sprint (${rows.length}):`);
    for (const r of rows) out.push(`  ${r.item} · ${r.phase ?? "—"} · ${r.waitingFor ? `${r.status} (${r.waitingFor})` : r.status}${r.needsYou ? ` → ${r.needsYou}` : ""}`);
  }
  const prs = snapshot.prs ?? [];
  if (prs.length) {
    out.push("", `Pull requests (${prs.length}):`);
    for (const p of prs) out.push(`  ${p.item} PR #${p.number}: ${p.error ?? prState(p)}${p.next ? ` → ${p.next.split(" → ").slice(-1)[0]}` : ""}`);
  }
  return out.join("\n");
}

// A PR's state in words: "open · changes requested · 2 unresolved · checks failing".
export function prState(p) {
  const bits = [p.state + (p.draft ? " (draft)" : "")];
  if (p.review && p.review !== "none") bits.push(p.review.replace(/_/g, " "));
  if (p.unresolved) bits.push(`${p.unresolved} unresolved`);
  if (p.checks && p.checks !== "none") bits.push(`checks ${p.checks}`);
  return bits.join(" · ");
}

// A PR newly needing something is worth a notification; one that needed the same thing last time is
// not. The first look of a session notifies nothing.
export function prTransitions(prev, now) {
  if (!prev || !now) return [];
  const before = new Map(prev.map((p) => [p.pr, p.next ?? null]));
  return now.filter((p) => p.next && before.has(p.pr) && before.get(p.pr) !== p.next).map((p) => ({ item: p.item, kind: "pr", text: prLine(p) }));
}

// Is the core plugin new enough for this cockpit? Compares a.b.c numerically.
export function coreTooOld(version, min) {
  const a = String(version ?? "0").split(".").map(Number);
  const b = String(min).split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) < (b[i] || 0);
  return false;
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

// ---- the cost ledger --------------------------------------------------------------------------
//
// What a work item costs is charged by phase. Claude Code reports the session's running cost
// (`$.session.usage().cost.usd`, what /cost shows, subagents included). The mod notes the figure when
// a run moves to a new phase, and charges the difference to the phase that just ended. The run file is
// how it knows: the pipeline writes `.aidlc/runs/<ID>.md` at every phase change, whichever door the run
// came in by (/aidlc:run, /aidlc:next, /aidlc:do, a sprint). The ledger's format is defined by its
// reader, core's skills/insights/costs.mjs.

// Phases after which nothing more is charged until the run writes its file again (a resume).
const NOT_WORKING = new Set(["done", "abandoned", "blocked", "review-pending"]);

const RUN_FILE = /(?:^|[\\/"'\s=])((?:[^\s"'`<>|;&]*[\\/])?\.aidlc[\\/]runs[\\/]([A-Za-z0-9][\w.-]*)\.md)\b/;

// The run file a tool call writes, if any: `{ item, path }`. Edit and Write name it; a shell command
// that writes it (a heredoc, `sed -i`) names it in its text. Archived run files are not live runs.
export function runFileTarget(tool, input) {
  const t = String(tool);
  const text = t === "Bash" || t === "PowerShell" ? String(input?.command ?? "") : ["Edit", "Write", "MultiEdit"].includes(t) ? String(input?.file_path ?? "") : "";
  const m = RUN_FILE.exec(text);
  if (!m || /[\\/]archive[\\/]/.test(m[1])) return null;
  return { item: m[2], path: m[1] };
}

// The `phase:` of a run file's frontmatter, or null.
export function phaseOf(text) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text));
  const m = fm && /^phase:\s*([\w-]+)/m.exec(fm[1]);
  return m ? m[1] : null;
}

// `/aidlc:run PROJ-1 --sprint` → "PROJ-1": a run typed by name is charged from its first turn, before
// its run file exists. Other doors are picked up at the first run-file write.
export function commandItem(command) {
  if (!command || command.name !== "aidlc:run") return null;
  const id = String(command.args ?? "").split(/\s+/).find((a) => /^[A-Za-z][A-Za-z0-9]*-\d+$/.test(a));
  return id ?? null;
}

// One step of the bookkeeping. `ledger` is `{ item, phase, baseline }` (baseline: the session cost when
// the current phase began); `next` is the `{ item, phase }` now in force, or null for "nothing"; `usd`
// is the session cost now. Returns the new ledger and what to charge. Passing the current item and
// phase again charges what has been spent so far and carries on: that is a flush.
export function advance(ledger, next, usd) {
  const charges = [];
  if (ledger.item && ledger.baseline != null && usd > ledger.baseline)
    charges.push({ item: ledger.item, phase: ledger.phase ?? "start", usd: usd - ledger.baseline });
  // A cost that went down (a new ledger behind the session) restarts from here, charging nothing.
  const working = next && next.item && !NOT_WORKING.has(next.phase);
  return { ledger: working ? { item: next.item, phase: next.phase, baseline: usd } : { item: null, phase: null, baseline: usd }, charges };
}

// The ledger file's name for an item and a session. Item ids are already path-safe; anything else is
// replaced so a strange id cannot leave the folder.
export const ledgerName = (item, session) => `${String(item).replace(/[^\w.-]/g, "_")}--${String(session).replace(/[^\w-]/g, "").slice(0, 8)}.json`;

// The ledger file after adding `charges` (all for one item): phases summed, `started` kept.
export function mergeLedger(existing, { item, session, now }, charges) {
  const phases = { ...(existing?.phases ?? {}) };
  for (const c of charges) phases[c.phase] = Math.round(((phases[c.phase] ?? 0) + c.usd) * 1e6) / 1e6;
  return { item, session, started: existing?.started ?? now, updated: now, phases };
}
