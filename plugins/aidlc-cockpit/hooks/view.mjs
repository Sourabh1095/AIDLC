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

export const money = (usd) => (usd == null || !(usd > 0) ? null : usd >= 10 ? `$${usd.toFixed(0)}` : usd < 0.01 ? "<$0.01" : `$${usd.toFixed(2)}`);

// One run, as one line. `usd` is what it has cost so far, when the ledger measured it. `settled` is what
// /aidlc:status last learned of its PR ("merged" or "closed"), when it has.
export function runLine(run, usd, settled = null) {
  const waiting = WAITING_PHASES.has(run.phase) || !!settled;
  const bits = [run.item, repoLabel(run.repo), run.phase, fixLabel(run.fixCycles), prLabel(run.pr), money(usd)].filter(Boolean);
  const hint =
    settled === "merged"
      ? " → PR merged: /aidlc:status cleans it up"
      : settled === "closed"
        ? " → PR closed: /aidlc:status closes the run"
        : run.phase === "blocked"
          ? ` → /aidlc:run ${run.item}`
          : run.phase === "review-pending"
            ? " → waiting for review"
            : "";
  return { text: bits.join(" · ") + hint, tone: waiting ? "warning" : "subtle" };
}

// What /aidlc:status last learned of a run's PR: "merged", "closed" or null. `settled` is core's
// `.aidlc/logs/pr-state.json`, keyed by PR link.
export const settledOf = (run, settled) => {
  const s = settled?.[run?.pr];
  return s?.state === "merged" || s?.state === "closed" ? s.state : null;
};

// Runs in the order a person acts on them: blocked (only a person can move it), working (the pipeline
// is on it), and parked for review. Parked runs pile up, one per open PR, and many outlive their PR, so
// they are counted rather than listed, and the ones whose PR already merged or closed are named apart.
export function runGroups(runs, settled = {}) {
  const g = { blocked: [], working: [], parked: [], settled: [] };
  for (const r of runs ?? []) {
    if (settledOf(r, settled)) g.settled.push(r);
    else if (r.phase === "blocked") g.blocked.push(r);
    else if (r.phase === "review-pending") g.parked.push(r);
    else g.working.push(r);
  }
  return g;
}

// `32 runs waiting for review · 3 with a merged or closed PR → /aidlc:status cleans them up`, or null.
export function parkedLine(g) {
  if (!g.parked.length && !g.settled.length) return null;
  const bits = [];
  if (g.parked.length) bits.push(`${plural(g.parked.length, "run")} waiting for review`);
  if (g.settled.length) bits.push(`${g.settled.length} with a merged or closed PR → /aidlc:status cleans them up`);
  return { text: bits.join(" · "), tone: g.settled.length ? "warning" : "subtle" };
}

// The item the checked-out branch is for, found in the tree (`feature/13716-booking-approval` → 13716).
export function branchItem(branch, tree) {
  const tail = String(branch ?? "").split("/").pop();
  const id = /^([A-Za-z][A-Za-z0-9]*-\d+|\d+)(?=-|_|$)/.exec(tail)?.[1];
  if (!id || !tree) return null;
  const find = (nodes) => {
    for (const n of nodes ?? []) {
      if (String(n.id).toLowerCase() === id.toLowerCase()) return n;
      const hit = find(n.children);
      if (hit) return hit;
    }
    return null;
  };
  return find([...(tree.roots ?? []), ...(tree.loose ?? [])]);
}

// The item as one line: `#13716 story · Booking approval · in progress · 2/5 done · 1 open bug`.
export function itemLine(n) {
  const c = n.counts ?? { total: 0, done: 0, openBugs: 0 };
  return [
    `${idLabel(n.id)} ${n.type} · ${n.title}`,
    STATUS_WORDS[n.status] ?? n.status,
    c.total ? `${c.done}/${c.total} done` : null,
    c.openBugs ? plural(c.openBugs, "open bug") : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

// The line above the prompt, or null when there is nothing worth the room. What this session is changing
// comes first: the module, how much is not committed, what leans on it, whether the checks ran since.
// A sprint, when one is running, follows: it is the one place several runs can each be waiting on the
// person. Otherwise the runs in flight.
export function bandModel(snapshot, work = null) {
  if (!snapshot) return null;
  if (snapshot.problem) return { lines: [{ text: `AIDLC cockpit: ${snapshot.problem}`, tone: "subtle" }], needsYou: 0 };
  const lines = [];
  let needsYou = 0;
  const now = workLine(sessionModel(work, snapshot.git, snapshot.context), snapshot.context);
  if (now) lines.push(now);
  else {
    // Nothing changed yet: the item this branch is for, when the board knows it.
    const root = (snapshot.git ?? []).find((g) => g.repo === ".");
    const item = branchItem(root?.branch, snapshot.tree);
    if (item) lines.push({ text: `on ${itemLine(item)}`, tone: "subtle" });
  }
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
    // Blocked runs first (only a person can move them), then the ones the pipeline is working. Runs
    // parked for review are one line: thirty of them listed would bury everything else.
    const g = runGroups(snapshot.runs, snapshot.settled);
    const listed = [...g.blocked, ...g.working];
    for (const r of listed.slice(0, MAX_RUN_LINES)) lines.push(runLine(r, snapshot.costs?.[r.item]));
    if (listed.length > MAX_RUN_LINES) lines.push({ text: `+${listed.length - MAX_RUN_LINES} more — /aidlc-board`, tone: "subtle" });
    const parked = parkedLine(g);
    if (parked) lines.push(parked);
    needsYou += g.blocked.length + g.settled.length;
  }
  if (!lines.length) return null;
  // One label for the band; the sprint header carries its own, sprint detail lines keep their indent.
  return {
    lines: lines.map((l, i) => {
      if (i === 0) return l.text.startsWith("AIDLC") ? l : { ...l, text: `AIDLC  ${l.text}` };
      const text = l.text.replace(/^AIDLC /, "");
      return text.startsWith("  ") ? { ...l, text } : { ...l, text: `       ${text}` };
    }),
    needsYou,
  };
}

// The board as plain text: the /aidlc-board reply, for surfaces that draw no pane.
export function boardText(snapshot, work = null, toggled = {}) {
  if (!snapshot) return "Not an AIDLC workspace (no .claude/aidlc.config.json here).";
  if (snapshot.problem) return `AIDLC cockpit: ${snapshot.problem}`;
  const out = [];
  for (const block of contextModel(snapshot.context)) {
    out.push(block.title);
    for (const l of block.lines) out.push(`  ${l.text}`);
    out.push("");
  }
  const s = sessionModel(work, snapshot.git, snapshot.context, snapshot.tree);
  out.push(s.title);
  for (const l of s.lines) out.push(`  ${l.text}`);
  const t = treeModel(snapshot.tree, toggled);
  if (t) {
    out.push("", t.title);
    for (const r of t.rows) out.push(`  ${r.text}`);
    if (t.loose.length) out.push("  Not under an epic:", ...t.loose.map((r) => `    ${r.text}`));
    if (t.note) out.push(`  ${t.note}`);
  }
  const r = runsModel(snapshot, toggled);
  if (r) {
    out.push("", r.title);
    for (const l of r.lines) out.push(`  ${l.text}`);
    if (r.parked) out.push(`  ${r.parked.text}`, ...r.parkedLines.map((l) => `    ${l.text}`));
  }
  const rows = snapshot.sprint?.rows ?? [];
  if (rows.length) {
    out.push("", `Sprint (${rows.length}):`);
    for (const r of rows) out.push(`  ${r.item} · ${r.phase ?? "—"} · ${r.waitingFor ? `${r.status} (${r.waitingFor})` : r.status}${r.needsYou ? ` → ${r.needsYou}` : ""}`);
  }
  return out.join("\n");
}

// The runs as the board shows them: blocked and working ones listed, the parked ones under one line that
// opens (toggle key `runs:parked`; the text reply lists them all).
export const PARKED_KEY = "runs:parked";
export function runsModel(snapshot, toggled = {}) {
  const runs = snapshot?.runs ?? [];
  if (!runs.length) return null;
  const g = runGroups(runs, snapshot.settled);
  const line = (r) => runLine(r, snapshot.costs?.[r.item], settledOf(r, snapshot.settled));
  const counts = [
    g.blocked.length && `${g.blocked.length} blocked`,
    g.working.length && `${g.working.length} working`,
    g.parked.length && `${g.parked.length} waiting for review`,
    g.settled.length && `${g.settled.length} to clean up`,
  ].filter(Boolean);
  const open = toggled[PARKED_KEY] ?? false;
  return {
    title: `Runs · ${counts.join(" · ")}`,
    lines: [...g.blocked, ...g.working].map(line),
    parked: parkedLine(g),
    open,
    // Merged or closed first: those are the ones with something to do.
    parkedLines: [...g.settled, ...g.parked].map(line),
  };
}

// ---- this session's work ------------------------------------------------------------------------
//
// What the session changed, kept by the mod as the tools run (register.tsx → tool.call): each file an
// edit touched and when, each check that ran (tests, typecheck, lint, build) and whether it passed, and
// the commits made. Git says which of the files are still uncommitted.

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

// The file an editing tool call writes, as the call names it, or null.
export function editedPath(tool, input) {
  if (!EDIT_TOOLS.has(String(tool))) return null;
  const p = input?.file_path ?? input?.notebook_path;
  return typeof p === "string" && p ? p : null;
}

// A path as the workspace names it (`core-api/src/x.ts`), or null for one outside the workspace or in
// AIDLC's, Claude Code's or git's own folders: bookkeeping is not work.
export function workspacePath(cwd, path) {
  const c = toSlash(cwd);
  let p = toSlash(path);
  if (/^([A-Za-z]:)?\//.test(p)) {
    const inside = /^[A-Za-z]:/.test(c) ? p.toLowerCase().startsWith(`${c.toLowerCase()}/`) : p.startsWith(`${c}/`);
    if (!inside) return null;
    p = p.slice(c.length + 1);
  }
  p = p.replace(/^(\.\/)+/, "");
  if (!p || p.startsWith("../") || /(^|\/)(\.aidlc|\.claude|\.git)(\/|$)/.test(p)) return null;
  return p;
}

// The commands of a shell line, one per `&&`, `||`, `;` or `|` (quotes are not looked into: a check's
// name inside a commit message sits in a `git` segment, which is never a check).
const segments = (command) => String(command ?? "").split(/&&|\|\||[;|\n]/).map((s) => s.trim()).filter(Boolean);
const RUNNERS = /^(npx|pnpm|yarn|bun|npm|node|deno|go|cargo|dotnet|mvn|\.\/mvnw|gradle|\.\/gradlew|python3?|py|pytest|uv|poetry|make|vitest|jest|eslint|tsc|ruff|mypy|pyright|biome|phpunit|rspec|bundle)\b/;
const CHECKS = [
  ["tests", /\b(test|tests|test:[\w:-]+|vitest|jest|pytest|mocha|playwright|phpunit|rspec)\b/],
  ["typecheck", /\b(typecheck|type-check|tsc|vue-tsc|mypy|pyright)\b/],
  ["lint", /\b(lint|lint:[\w:-]+|eslint|ruff|flake8|pylint|golangci-lint|biome|stylelint|format:check|prettier\s+--check)\b/],
  ["build", /\b(build|build:[\w:-]+)\b/],
];

// Which checks a shell command runs: `npm run lint && npm test` → ["lint", "tests"].
export function checksIn(command) {
  const found = [];
  for (const seg of segments(command)) {
    if (!RUNNERS.test(seg)) continue;
    for (const [kind, re] of CHECKS) if (re.test(seg) && !found.includes(kind)) found.push(kind);
  }
  return found;
}

// Does a shell command make a commit? `git commit …` or `git -C <dir> commit …`, not a dry run.
export const makesCommit = (command) => segments(command).some((s) => /^git(\s+-C\s+("[^"]*"|\S+))?\s+commit\b/.test(s) && !/--dry-run/.test(s));

const emptyWork = () => ({ files: {}, checks: {}, commits: 0 });
export const noteEdit = (work, path, at) => ({ ...(work ?? emptyWork()), files: { ...(work?.files ?? {}), [path]: at } });
export function noteChecks(work, kinds, ok, at) {
  const checks = { ...(work?.checks ?? {}) };
  for (const k of kinds) checks[k] = { at, ok };
  return { ...(work ?? emptyWork()), checks };
}
export const noteCommit = (work) => ({ ...(work ?? emptyWork()), commits: (work?.commits ?? 0) + 1 });

// `git status --porcelain=v1 --branch -z` → branch, ahead/behind and the changed paths, each prefixed
// with the repo's folder in the workspace (poly) so they compare with the session's own paths.
export function parseGitStatus(out, prefix = ".") {
  const parts = String(out ?? "").split("\0");
  let branch = null;
  let ahead = 0;
  let behind = 0;
  const dirty = [];
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (!e) continue;
    if (e.startsWith("## ")) {
      const h = e.slice(3);
      branch = /^HEAD \(no branch\)/.test(h) ? "detached" : h.replace(/^No commits yet on /, "").split("...")[0].split(" ")[0];
      ahead = Number(/ahead (\d+)/.exec(h)?.[1] ?? 0);
      behind = Number(/behind (\d+)/.exec(h)?.[1] ?? 0);
      continue;
    }
    const path = e.slice(3);
    dirty.push(prefix && prefix !== "." ? `${prefix}/${path}` : path);
    if (e[0] === "R" || e[0] === "C") i++; // a rename's source path comes next
  }
  return { repo: prefix || ".", branch, ahead, behind, dirty };
}

// The git repos of a workspace: each declared repo inside it (poly), then the workspace itself.
export function repoRoots(cfg, cwd) {
  const base = toSlash(cfg?.workspace?.root || ".").replace(/^\.\/?/, "");
  const out = [];
  for (const r of cfg?.repos ?? []) {
    if (!r || typeof r.path !== "string" || !r.path || /^([A-Za-z]:)?[\\/]/.test(r.path)) continue;
    const key = toSlash([base, r.path].filter(Boolean).join("/")).replace(/^\.\//, "").replace(/\/\.$/, "");
    if (key && key !== "." && !key.startsWith("..")) out.push({ key, dir: `${toSlash(cwd)}/${key}` });
  }
  out.push({ key: ".", dir: toSlash(cwd) });
  return out;
}
export const repoOf = (roots, path) => roots.find((r) => r.key === "." || path === r.key || path.startsWith(`${r.key}/`)) ?? null;

const clock = (ms) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const CHECK_ORDER = ["tests", "typecheck", "lint", "build"];
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const moduleName = (m) => (m.page ? m.page.split("/").pop() : m.name);

// The session's work as the board draws it: files grouped by module, which are uncommitted, the
// branch, and each check — passed, failed, or not run since the last edit.
export function sessionModel(work, git, context, tree = null) {
  const files = Object.entries(work?.files ?? {}).sort((a, b) => b[1] - a[1]);
  const dirty = new Set((git ?? []).flatMap((g) => g.dirty));
  const lastEdit = files[0]?.[1] ?? 0;
  const owner = new Map();
  for (const m of context?.modules ?? []) for (const f of m.files) owner.set(f, moduleName(m));
  const groups = new Map();
  for (const [p] of files) {
    const name = owner.get(p) ?? "other files";
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push({ path: p, uncommitted: dirty.has(p) });
  }
  const checks = CHECK_ORDER.filter((k) => work?.checks?.[k]).map((k) => {
    const c = work.checks[k];
    if (c.at < lastEdit) return { kind: k, state: "stale", text: `${k} not run since the last edit`, tone: "warning" };
    return { kind: k, state: c.ok ? "passed" : "failed", text: `${k} ${c.ok ? "passed" : "failed"} at ${clock(c.at)}`, tone: c.ok ? "success" : "error" };
  });
  const uncommitted = files.filter(([p]) => dirty.has(p)).length;
  const root = (git ?? []).find((g) => g.repo === ".") ?? (git ?? [])[0] ?? null;
  const lines = [];
  for (const g of git ?? []) {
    if (!g.branch) continue;
    const mine = files.filter(([p]) => g.repo === "." || p.startsWith(`${g.repo}/`)).length;
    if (g.repo !== "." && !mine) continue;
    lines.push({ text: `${g.repo === "." ? "" : `${g.repo}: `}on ${g.branch}${g.ahead ? ` · ${g.ahead} commit(s) not pushed` : ""}${g.behind ? ` · ${g.behind} behind` : ""}`, tone: "subtle" });
    const item = branchItem(g.branch, tree);
    if (item) lines.push({ text: `  for ${itemLine(item)}`, tone: STATUS_TONE[item.status] ?? "text" });
  }
  if (!files.length) lines.push({ text: "Nothing changed in this session yet.", tone: "subtle" });
  for (const [name, list] of groups) {
    const open = list.filter((f) => f.uncommitted).length;
    lines.push({
      text: `${name}: ${list.map((f) => f.path.split("/").pop()).slice(0, 4).join(", ")}${list.length > 4 ? ` +${list.length - 4}` : ""}${open ? ` · ${open} uncommitted` : " · committed"}`,
      tone: open ? "text" : "success",
    });
  }
  if (files.length) {
    if (!checks.length) lines.push({ text: "No tests, typecheck or lint run yet in this session.", tone: "warning" });
    for (const c of checks) lines.push({ text: c.text, tone: c.tone });
  }
  if (work?.commits) lines.push({ text: `${plural(work.commits, "commit")} made in this session`, tone: "subtle" });
  return {
    title: files.length ? `This session · ${plural(files.length, "file")} changed${uncommitted ? `, ${uncommitted} uncommitted` : ""}` : "This session",
    lines,
    files: files.length,
    uncommitted,
    checks,
    branch: root?.branch ?? null,
  };
}

// The band's first line while the session is changing things:
// `AIDLC  bookings · 4 files (3 uncommitted) · used by 2 · tests failed`.
export function workLine(session, context) {
  if (!session?.files) return null;
  const m = context?.modules?.[0];
  const failed = session.checks.find((c) => c.state === "failed");
  const stale = session.checks.find((c) => c.state === "stale");
  const check = failed ? `${failed.kind} failed` : stale ? `${stale.kind} not run since edit` : session.checks.length ? "checks passed" : "not checked yet";
  const bits = [
    m ? moduleName(m) : null,
    `${plural(session.files, "file")}${session.uncommitted ? ` (${session.uncommitted} uncommitted)` : ""}`,
    m?.usedBy?.length ? `used by ${m.usedBy.length}` : null,
    check,
  ].filter(Boolean);
  return { text: bits.join(" · "), tone: failed || (m?.usedBy?.length && session.uncommitted) ? "warning" : "subtle" };
}

// ---- "You're in": the module being changed --------------------------------------------------------
//
// From core's `brain.mjs context`: for the newest files first, each module's purpose and rules (from its
// brain page) and what uses it (the page's list joined with the imports found in the code now).

const MAX_CONTEXT_MODULES = 2;

export function contextModel(context) {
  return (context?.modules ?? []).slice(0, MAX_CONTEXT_MODULES).map((m) => {
    const name = moduleName(m);
    const behind = ["behind", "off-branch", "unknown-commit"].includes(m.state);
    const lines = [];
    if (m.purpose) lines.push({ text: m.purpose, tone: "text" });
    for (const r of m.rules) lines.push({ text: `Rule: ${r}`, tone: "subtle" });
    if (m.usedBy.length) {
      const unlisted = m.page ? m.usedBy.filter((u) => !u.recorded).length : 0;
      lines.push({
        text: `Used by: ${m.usedBy.map((u) => u.name).join(", ")}${unlisted ? ` (${unlisted} not on its page yet)` : ""}`,
        tone: "warning",
      });
    } else lines.push({ text: "Nothing else in the code uses it.", tone: "subtle" });
    if (m.connectsTo.length) lines.push({ text: `Connects to: ${m.connectsTo.join(", ")}`, tone: "subtle" });
    const ask = [m.assumed && plural(m.assumed, "assumption"), m.gaps && plural(m.gaps, "open question")].filter(Boolean);
    if (!m.page) lines.push({ text: `No brain page yet — /aidlc:learn ${name} writes one.`, tone: "subtle" });
    else if (ask.length) lines.push({ text: `${ask.join(" · ")} waiting on a person`, tone: "warning" });
    if (behind) lines.push({ text: `Its page is behind the code (${plural(m.behindFiles, "file")} moved since it was checked).`, tone: "warning" });
    return {
      title: `You're in: ${m.title ?? name}${m.area ? ` (${m.area})` : ""}`,
      name,
      learn: !m.page || behind || ask.length ? `/aidlc:learn ${name}` : null,
      lines,
    };
  });
}

// ---- the board as a tree ----------------------------------------------------------------------------
//
// From core's `work-items/tree.mjs`: each open epic with its children, any depth, bugs included. A node is
// open when the person opened it, and otherwise when it is an epic already under way.

const STATUS_WORDS = { todo: "to do", in_progress: "in progress", in_review: "in review", done: "done", blocked: "blocked" };
const STATUS_TONE = { done: "success", blocked: "error", in_review: "warning", in_progress: "text", todo: "subtle" };
const idLabel = (id) => (/^\d+$/.test(String(id)) ? `#${id}` : String(id));

export function treeRows(nodes, toggled = {}) {
  const rows = [];
  const walk = (n, depth, lead, last) => {
    const kids = n.children ?? [];
    const open = kids.length > 0 && (toggled[n.id] ?? (depth === 0 && ["in_progress", "in_review", "blocked"].includes(n.status)));
    const branch = depth === 0 ? "" : `${lead}${last ? "└─ " : "├─ "}`;
    const marker = kids.length ? (open ? "▾ " : "▸ ") : "";
    const c = n.counts ?? { total: 0, done: 0, openBugs: 0 };
    const tail = [
      STATUS_WORDS[n.status] ?? n.status,
      n.run ? `run: ${n.run}` : null,
      c.total ? `${c.done}/${c.total} done` : null,
      c.openBugs ? plural(c.openBugs, "open bug") : null,
    ].filter(Boolean);
    rows.push({
      id: String(n.id),
      depth,
      text: `${branch}${marker}${idLabel(n.id)} ${n.type} · ${n.title} · ${tail.join(" · ")}`,
      tone: n.type === "bug" && n.status !== "done" ? (n.status === "blocked" ? "error" : "warning") : (STATUS_TONE[n.status] ?? "text"),
      expandable: kids.length > 0,
      open,
    });
    if (open) kids.forEach((k, i) => walk(k, depth + 1, depth === 0 ? "" : `${lead}${last ? "   " : "│  "}`, i === kids.length - 1));
  };
  for (const n of nodes ?? []) walk(n, 0, "", true);
  return rows;
}

export function treeModel(tree, toggled = {}) {
  if (!tree) return null;
  if (tree.error) return { title: "Epics", rows: [], loose: [], note: tree.error };
  const where =
    tree.source === "snapshot"
      ? `from the snapshot of ${tree.at ? tree.at.slice(0, 16).replace("T", " ") : "an unknown time"}${tree.note ? ` (${tree.note})` : ""} — /aidlc:status refreshes it`
      : null;
  return {
    title: `Epics · ${plural(tree.roots.length, "open")}${tree.hiddenDone ? ` · ${tree.hiddenDone} finished not shown` : ""}`,
    rows: treeRows(tree.roots, toggled),
    loose: treeRows(tree.loose, toggled),
    note: [where, tree.truncated ? "only the 3,000 most recently changed items were read" : null].filter(Boolean).join(" · ") || null,
  };
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
