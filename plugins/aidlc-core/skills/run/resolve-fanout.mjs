#!/usr/bin/env node
// Resolve the IMPLEMENT phase into a schedule: serial steps and parallel windows.
//
//   node resolve-fanout.mjs <plan.json> [aidlc.config.json]
//
// Prints the ordered schedule with a reason for every task held serial. Exits 0 always
// (resolution is not a verdict); exits 2 on bad input.
//
// WHY THIS IS CODE. Architecture D7 serializes "anything that mutates a shared tree", and for one
// item that has always meant a single implementer. The rule is right; the reading was too broad.
// Six screens getting the same pagination treatment touch six DISJOINT files — the collision is not
// the files, it is git (two agents racing the index and HEAD in one checkout). Remove the racing
// committer and the file-level work is genuinely parallel.
//
// That makes disjointness the safety property the whole fan-out rests on, and it is exactly the kind
// of property prose gets wrong in a way that FAILS SILENTLY: two agents handed overlapping paths do
// not error, they interleave edits and the loser's work vanishes mid-file. Nothing in the gate
// catches it — the tests pass against whatever survived. So it is computed, and the computation is
// tested.
//
// THREE THINGS THIS REFUSES TO GUESS, each of which cost real work to learn the hard way:
//
//   1. Disjoint paths do NOT imply independence. A task that creates `hooks/usePagination.ts` and a
//      task that edits `screens/users.tsx` to import it are disjoint on paths and strictly ordered in
//      reality. Path analysis cannot see that, so the PLAN declares it: `dependsOn` (or `foundation`,
//      sugar for "everything after me depends on me"). A task with dependencies never shares a window
//      with them.
//   2. A task with no declared `paths` is never parallelized. Unprovable is not the same as safe.
//   3. Two globs that cannot be compared cheaply are treated as overlapping. Over-serializing costs
//      wall-clock; under-serializing costs correctness, and only one of those is recoverable.
//
// ORDER IS PRESERVED ABSOLUTELY. The schedule only ever collapses a *contiguous* run of plan tasks
// into one window — it never reorders and never hoists. So the plan's order remains the contract
// (same property `resolve-gate.mjs` protects for gate steps), and a plan read top-to-bottom still
// describes what happens. A window is simply "these adjacent tasks happen at once".

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Paths where "one writer at a time" is the whole point. These are the aggregators: every screen
// registers in the same barrel, every feature appends to the same route table, every dependency lands
// in the same manifest. Six agents editing six screens is safe; six agents appending to one
// `index.ts` is a lost-update race with no error message.
export const DEFAULT_SHARED_PATTERNS = [
  // dependency manifests + lockfiles — a regenerated lockfile is one writer, always
  "**/package.json", "**/package-lock.json", "**/pnpm-lock.yaml", "**/yarn.lock",
  "**/requirements*.txt", "**/pyproject.toml", "**/poetry.lock", "**/Pipfile*",
  "**/go.mod", "**/go.sum", "**/Cargo.toml", "**/Cargo.lock", "**/pom.xml", "**/build.gradle*",
  // barrel / aggregator modules — the classic append race
  "**/index.{ts,tsx,js,jsx,mjs,cjs}", "**/mod.rs", "**/__init__.py",
  // routing tables
  "**/{routes,router,routing}.*", "**/routes/**", "**/app-routing.*",
  // i18n catalogs
  "**/locales/**", "**/i18n/**", "**/messages/**",
  // global style + tool config
  "**/globals.css", "**/global.css", "**/tailwind.config.*", "**/*.config.{ts,js,mjs,cjs,json}",
  // test snapshots — one runner rewrite races another
  "**/__snapshots__/**", "**/*.snap",
  // schema, contracts, migrations
  "**/migrations/**", "**/schema.prisma", "**/schema.graphql", "**/openapi.{json,yaml,yml}",
  // pipeline + framework state (guard-blocked anyway; listed so the reason reads honestly)
  ".aidlc/**", ".claude/**", ".github/**", "**/azure-pipelines.yml",
];

export const FANOUT_DEFAULTS = { enabled: true, maxAgents: 3, minGroup: 2, maxAgentsCap: 5 };

const norm = (p) => String(p).replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
const isGlob = (p) => /[*?{]/.test(p);

// Minimal glob matcher — no dependency, because this file must run from a plugin dir with no
// node_modules. Supports **, *, ?, {a,b}. Scanned character by character rather than by sequential
// String.replace, because replacing `*` after `**` is how a matcher starts matching the wrong thing.
//
// Every separator compiles to `[\\/]` and every wildcard excludes both, so the returned regex matches
// a Windows path as readily as a POSIX one. The alternative — normalizing only the glob — produces a
// regex that quietly fails on `src\a\x.ts`, which on this platform is the common input.
export function globToRegExp(glob) {
  const g = norm(glob);
  let re = "";
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === "/") re += "[\\\\/]";
    else if (c === "*") {
      if (g[i + 1] === "*") {
        if (g[i + 2] === "/") { re += "(?:[^\\\\/]+[\\\\/])*"; i += 2; } // **/ spans zero or more dirs
        else { re += ".*"; i += 1; }
      } else re += "[^\\\\/]*";
    } else if (c === "?") re += "[^\\\\/]";
    else if (c === "{") {
      const close = g.indexOf("}", i);
      if (close === -1) { re += "\\{"; continue; }
      const alts = g.slice(i + 1, close).split(",").map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      re += `(?:${alts.join("|")})`;
      i = close;
    } else if (".+^$()|[]\\".includes(c)) re += "\\" + c;
    else re += c;
  }
  return new RegExp(`^${re}$`, "i");
}

const isUnder = (child, parent) => child.toLowerCase().startsWith((parent + "/").toLowerCase());

// Do two declared paths touch the same file? Directory containment counts, and a glob counts against
// any literal it matches. Two globs are assumed to overlap: comparing glob languages properly is a
// research problem, and guessing "disjoint" here is the one wrong answer that loses code.
export function pathsOverlap(a, b) {
  const A = norm(a), B = norm(b);
  if (!A || !B) return true;                                   // an empty declaration proves nothing
  if (A.toLowerCase() === B.toLowerCase()) return true;
  if (isUnder(A, B) || isUnder(B, A)) return true;
  if (isGlob(A) && isGlob(B)) return true;
  if (isGlob(A) && globToRegExp(A).test(B)) return true;
  if (isGlob(B) && globToRegExp(B).test(A)) return true;
  return false;
}

export const tasksOverlap = (t1, t2) =>
  (t1.paths ?? []).some((p) => (t2.paths ?? []).some((q) => pathsOverlap(p, q)));

// Which declared path made this task a shared-tree writer, and which pattern caught it.
export function sharedHit(task, patterns) {
  for (const p of task.paths ?? [])
    for (const pat of patterns)
      if (globToRegExp(pat).test(norm(p))) return { path: norm(p), pattern: pat };
  return null;
}

export function fanoutSettings(config) {
  const c = config?.pipeline?.implementFanout ?? {};
  const cap = FANOUT_DEFAULTS.maxAgentsCap;
  const shared = [
    ...DEFAULT_SHARED_PATTERNS,
    ...(c.sharedPaths ?? []),
    // A named API contract is a shared artifact by definition — the whole point of §7 trigger 2.
    ...(config?.saas?.apiContracts ?? []).map((x) => (typeof x === "string" ? x : x?.path)).filter(Boolean),
  ];
  return {
    enabled: c.enabled ?? FANOUT_DEFAULTS.enabled,
    maxAgents: Math.max(1, Math.min(cap, c.maxAgents ?? FANOUT_DEFAULTS.maxAgents)),
    minGroup: Math.max(2, c.minGroup ?? FANOUT_DEFAULTS.minGroup),
    sharedPatterns: shared,
  };
}

// Transitive dependency closure over plan tasks, by id or 1-based index.
function depClosure(tasks) {
  const byId = new Map();
  tasks.forEach((t, i) => { byId.set(String(t.id ?? i + 1), i); byId.set(String(i + 1), i); });
  const direct = tasks.map((t) => (t.dependsOn ?? []).map((d) => byId.get(String(d))).filter((i) => i !== undefined));
  const closure = tasks.map(() => new Set());
  const walk = (i, into, seen = new Set()) => {
    for (const d of direct[i]) {
      if (seen.has(d)) continue;
      seen.add(d); into.add(d); walk(d, into, seen);
    }
  };
  tasks.forEach((_, i) => walk(i, closure[i]));
  // A foundation task is sugar for "every later task depends on me".
  tasks.forEach((t, i) => { if (t.foundation) for (let j = i + 1; j < tasks.length; j++) closure[j].add(i); });
  return { closure, direct };
}

export function resolveFanout(plan, config) {
  const tasks = (Array.isArray(plan) ? plan : plan?.tasks ?? []).map((t, i) => ({
    ...t, _i: i, id: t.id ?? String(i + 1), paths: (t.paths ?? []).map(norm).filter(Boolean),
  }));
  const s = fanoutSettings(config);
  const schedule = [], serialReasons = {}, warnings = [];

  const serial = (t, reason) => { serialReasons[t.id] = reason; schedule.push({ kind: "serial", tasks: [t], reason }); };

  if (!s.enabled) {
    for (const t of tasks) serial(t, "fan-out disabled (pipeline.implementFanout.enabled: false)");
    return { schedule, serialReasons, warnings, settings: s, tasks, parallelTasks: 0, windows: 0 };
  }

  const { closure, direct } = depClosure(tasks);
  // A dependency pointing forward is a malformed plan, not a scheduling puzzle: refuse to fan out
  // rather than silently run a task before the thing it needs.
  tasks.forEach((t, i) => {
    for (const d of direct[i]) if (d > i) warnings.push(`task ${t.id} dependsOn a LATER task (${tasks[d].id}) — plan order is wrong; holding it serial`);
  });
  const badOrder = new Set();
  tasks.forEach((t, i) => { for (const d of direct[i]) if (d > i) { badOrder.add(i); badOrder.add(d); } });

  const eligible = tasks.map((t, i) => {
    if (badOrder.has(i)) return { ok: false, reason: "plan order is wrong (dependsOn points forward)" };
    if (t.foundation) return { ok: false, reason: "foundation — later tasks build on it" };
    if (!t.paths.length) return { ok: false, reason: "no declared paths — disjointness cannot be proven" };
    const hit = sharedHit(t, s.sharedPatterns);
    if (hit) return { ok: false, reason: `touches shared path \`${hit.path}\` (matched \`${hit.pattern}\`) — one writer at a time` };
    return { ok: true };
  });

  // Greedy contiguous windows. Never reorders: a task that cannot join the open window closes it.
  let win = [];
  const flush = () => {
    if (!win.length) return;
    if (win.length < s.minGroup) for (const t of win) serial(t, `alone in its window (needs ${s.minGroup}+ disjoint neighbours)`);
    else schedule.push({ kind: "parallel", tasks: [...win] });
    win = [];
  };

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i], e = eligible[i];
    if (!e.ok) { flush(); serial(t, e.reason); continue; }
    const blocked = win.some((w) => closure[i].has(w._i) || closure[w._i].has(i));
    const collides = win.some((w) => tasksOverlap(t, w));
    if (blocked || collides || win.length >= s.maxAgents) {
      if (collides && !blocked) serialReasons[`${t.id}~note`] = "overlapped an earlier window member — started a new window";
      flush();
    }
    win.push(t);
  }
  flush();

  const parallelTasks = schedule.filter((g) => g.kind === "parallel").reduce((n, g) => n + g.tasks.length, 0);
  return {
    schedule, serialReasons, warnings, settings: s, tasks,
    parallelTasks, windows: schedule.filter((g) => g.kind === "parallel").length,
  };
}

// The one line the run file records, so the audit trail states what ran concurrently and what did not.
export const scheduleSummary = (r) =>
  r.schedule
    .map((g) => (g.kind === "parallel" ? `[${g.tasks.map((t) => t.id).join("|")}]` : g.tasks[0].id))
    .join(" -> ");

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const [planPath, cfgPath] = process.argv.slice(2);
  if (!planPath) {
    console.error("usage: node resolve-fanout.mjs <plan.json> [aidlc.config.json]");
    process.exit(2);
  }
  let plan, config = {};
  try { plan = JSON.parse(readFileSync(planPath, "utf8")); }
  catch (e) { console.error(`cannot read ${planPath}: ${e.message}`); process.exit(2); }
  if (cfgPath) { try { config = JSON.parse(readFileSync(cfgPath, "utf8")); } catch (e) { console.error(`cannot read ${cfgPath}: ${e.message}`); process.exit(2); } }

  const r = resolveFanout(plan, config);
  console.log(`fan-out: ${r.settings.enabled ? "enabled" : "disabled"}  maxAgents=${r.settings.maxAgents}  minGroup=${r.settings.minGroup}`);
  console.log(`schedule: ${scheduleSummary(r)}`);
  console.log(`${r.parallelTasks} of ${r.tasks.length} task(s) parallelized across ${r.windows} window(s)\n`);
  for (const g of r.schedule) {
    if (g.kind === "parallel") {
      console.log(`  PARALLEL (${g.tasks.length} implementers, disjoint paths, none commits):`);
      for (const t of g.tasks) console.log(`    ${String(t.id).padEnd(4)} ${t.title ?? ""}   owns: ${t.paths.join(", ")}`);
    } else {
      const t = g.tasks[0];
      console.log(`  SERIAL   ${String(t.id).padEnd(4)} ${t.title ?? ""}   — ${g.reason}`);
    }
  }
  if (r.warnings.length) { console.log("\nwarnings:"); for (const w of r.warnings) console.log(`  - ${w}`); }
}
