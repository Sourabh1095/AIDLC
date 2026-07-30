#!/usr/bin/env node
// Resolve a backlog into an ordered set of execution WAVES — the sets of items that may run at the
// same time, and the order those sets must run in.
//
//   node resolve-waves.mjs <items.json> [aidlc.config.json]
//   node resolve-waves.mjs --freshness <plan-snapshot.json> <items-now.json>
//
// The first form prints the wave schedule with a reason for every item held out of it. The second is
// what `/aidlc:next`, `/aidlc:sprint` and `/aidlc:status` run before obeying a persisted plan: it diffs
// the item fields the plan was cut from against the board as it is now, and prints the drift class.
// Exits 0 always (resolution is not a verdict); exits 2 on bad input.
//
// WHY THIS IS CODE. A re-prioritization is a judgment call — which is why the *order* comes from a
// human and an analyst reading the client's changed intent. The **packing** is not a judgment call:
// given that order, which items may share a wave is decided by three hard constraints, and every one
// of them fails SILENTLY when got wrong.
//
//   1. A `dependsOn` edge violated by the packing does not error. The dependent item runs against a
//      contract/migration/shared package that is not there yet, and what you get is a plausible red
//      build a long way from its cause.
//   2. Two poly items in the SAME repo in one wave do not error. `/aidlc:sprint` launches both against
//      one checkout, and they interleave branches and commits in a single working tree (sprint §1.3).
//      In mono this constraint does not exist at all — each item gets its own git worktree — so the
//      rule is layout-dependent, which is exactly the kind of thing prose gets wrong.
//   3. An in-flight item that gets "re-planned" does not error either. It keeps running, against an
//      order nobody holds any more.
//
// So the packing is computed, and the computation is tested. This is D7 ("parallelize independent work;
// serialize anything that mutates a shared tree") applied one level coarser than `resolve-fanout.mjs`
// applies it: that one packs the tasks of ONE item into windows, this one packs ITEMS into waves.
//
// FOUR THINGS THIS REFUSES TO GUESS:
//
//   1. **In-flight work is not re-planned.** A leaf already running is pinned to wave 0 exactly as it
//      is. It is never moved, re-ordered, paused or dropped — a half-applied change across many files
//      and (in poly) many repos is the expensive thing to unwind, and no new priority is worth it.
//   2. **A container is never frozen, and never scheduled.** `/aidlc:run` §3a rolls a parent to
//      in_progress the moment its FIRST child starts (F19), so "freeze everything in_progress" would
//      freeze whole epics and re-planning would become impossible the moment any child moved. Only
//      LEAVES freeze. Containers are not runnable units at all — their children are.
//   3. **An unrouted item is held, not guessed into a wave.** With no `repo` there is no way to prove
//      two items do not share a working tree (poly), so it waits for routing. Unprovable is not safe.
//   4. **A cycle is reported, never broken.** Guessing which edge to drop produces a schedule that runs
//      something before the thing it needs, which is failure mode 1 with extra confidence.
//
// The asymmetry driving all four is the one `resolve-fanout.mjs` states: over-serializing costs
// wall-clock and says so out loud; under-serializing corrupts work and says nothing.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Types that are coordination units, not runnable leaves. Note `feature`: it is absent from the
// canonical WorkItem enum but real on an ADO board (Epic→Feature→Story→Task), and an adapter that
// surfaces one must not have it scheduled as though it were work.
export const CONTAINER_TYPES = ["epic", "feature"];
export const LEAF_TYPES = ["story", "task", "bug", "spike"];

// The only status that satisfies a dependency. Everything else is either still to come (todo),
// still moving (in_progress/in_review), or stuck (blocked) — none of which a dependent may start on.
export const TERMINAL_STATUSES = ["done"];
// Statuses that mean "this leaf is already running" — the wave-0 freeze set.
export const IN_FLIGHT_STATUSES = ["in_progress", "in_review"];

export const REPLAN_DEFAULTS = { maxWave: 3, maxWaveCap: 5 };

const PRIORITY_RANK = { P1: 1, P2: 2, P3: 3, P4: 4 };

const norm = (s) => (s == null ? null : String(s).trim());
const lower = (s) => (s == null ? null : String(s).trim().toLowerCase());
const isTerminal = (it) => TERMINAL_STATUSES.includes(lower(it.status));

export function replanSettings(config) {
  const c = config?.pipeline?.replan ?? {};
  const cap = REPLAN_DEFAULTS.maxWaveCap;
  const poly = Array.isArray(config?.repos) && config.repos.length > 0;
  return {
    maxWave: Math.max(1, Math.min(cap, c.maxWave ?? REPLAN_DEFAULTS.maxWave)),
    // In poly, two items in one repo share one checkout — one per repo per wave (sprint §1.3).
    // In mono, `/aidlc:sprint` gives every item its own git worktree, so the constraint does not bind
    // and applying it anyway would serialize a whole backlog that is genuinely parallel.
    onePerRepo: poly,
    poly,
    layout: poly ? "poly" : "mono",
  };
}

// Is this item a coordination unit rather than a runnable leaf? Two ways to qualify, and the second
// is the one that catches the `crossRepoSplit: task` umbrella: a Story whose child Tasks are the real
// leaves is not itself runnable, whatever its type says. `/aidlc:next` applies the same rule when it
// skips an epic with open children.
export function isContainer(item, childrenByParent) {
  if (CONTAINER_TYPES.includes(lower(item.type))) return true;
  const kids = childrenByParent.get(norm(item.id)) ?? [];
  return kids.some((k) => !isTerminal(k));
}

// Rank for ordering within and across waves. An explicit `order` (the analyst's re-prioritized rank,
// which is what a replan actually produces) wins; otherwise P1..P4; ties break on id so the same input
// always yields the same schedule.
export function rankOf(item) {
  const explicit = Number.isFinite(item.order) ? Number(item.order) : null;
  return {
    order: explicit ?? Number.POSITIVE_INFINITY,
    priority: PRIORITY_RANK[String(item.priority ?? "").toUpperCase()] ?? 5,
    id: String(item.id ?? ""),
  };
}

const byRank = (a, b) => {
  const ra = rankOf(a), rb = rankOf(b);
  if (ra.order !== rb.order) return ra.order - rb.order;
  if (ra.priority !== rb.priority) return ra.priority - rb.priority;
  return ra.id.localeCompare(rb.id, "en");
};

// Expand a dependency onto the set of LEAVES that must actually precede the dependent. A dep on a
// container means "after everything under it", so it resolves to that container's non-terminal
// descendants. Guarded against a malformed parent cycle, which would otherwise recurse forever.
function expandDep(depId, index, childrenByParent, seen = new Set()) {
  const id = norm(depId);
  if (!id || seen.has(id)) return { targets: [], unknown: [], cyclicParent: seen.has(id) };
  seen.add(id);
  const it = index.get(id);
  if (!it) return { targets: [], unknown: [id], cyclicParent: false };
  if (isTerminal(it)) return { targets: [], unknown: [], cyclicParent: false };
  if (!isContainer(it, childrenByParent)) return { targets: [id], unknown: [], cyclicParent: false };

  const out = { targets: [], unknown: [], cyclicParent: false };
  for (const kid of childrenByParent.get(id) ?? []) {
    if (isTerminal(kid)) continue;
    const r = expandDep(kid.id, index, childrenByParent, seen);
    out.targets.push(...r.targets);
    out.unknown.push(...r.unknown);
    out.cyclicParent ||= r.cyclicParent;
  }
  return out;
}

/**
 * Pack items into ordered waves.
 *
 * @param items  normalized WorkItems, plus two optional planning fields the caller supplies:
 *               `frozen: true`  — this LEAF has a non-terminal run file (it is running right now)
 *               `order: <int>`  — the re-prioritized rank this replan is applying
 * @param config `.claude/aidlc.config.json` (only `repos[]` and `pipeline.replan` are read)
 */
export function resolveWaves(items, config = {}) {
  const s = replanSettings(config);
  const all = (Array.isArray(items) ? items : (items?.items ?? [])).map((it) => ({
    ...it,
    id: norm(it.id),
    repo: norm(it.repo),
    parent: norm(it.parent),
    dependsOn: (it.dependsOn ?? []).map(norm).filter(Boolean),
  }));

  const index = new Map(all.map((it) => [it.id, it]));
  const childrenByParent = new Map();
  for (const it of all) {
    if (!it.parent) continue;
    if (!childrenByParent.has(it.parent)) childrenByParent.set(it.parent, []);
    childrenByParent.get(it.parent).push(it);
  }

  const warnings = [];
  const held = [];
  const containers = [];
  const hold = (item, reason) => held.push({ id: item.id, repo: item.repo, title: item.title ?? null, reason });

  // ---- classify -------------------------------------------------------------------------------
  const done = [], frozen = [], schedulable = [];
  for (const it of all) {
    if (isTerminal(it)) { done.push(it); continue; }

    if (isContainer(it, childrenByParent)) {
      const kids = (childrenByParent.get(it.id) ?? []).filter((k) => !isTerminal(k));
      containers.push({ id: it.id, type: lower(it.type), title: it.title ?? null, children: kids.map((k) => k.id) });
      // A container that is in_progress is the F19 rollup doing its job, NOT a reason to freeze it.
      // Its children are what run; it is scheduled by proxy through them.
      if (!kids.length) {
        warnings.push(`${it.id} (${lower(it.type)}) has no open children — nothing to schedule under it; decompose it or close it`);
      }
      continue;
    }

    // A leaf the caller marked frozen, or that the board already shows moving, is wave 0 as-is.
    if (it.frozen === true || IN_FLIGHT_STATUSES.includes(lower(it.status))) { frozen.push(it); continue; }

    if (lower(it.status) === "blocked") { hold(it, "status is `blocked` — unblock it before it can be scheduled"); continue; }
    if (lower(it.status) !== "todo") { hold(it, `unrecognized status \`${it.status ?? "null"}\` — cannot tell whether it is ready`); continue; }
    if (s.onePerRepo && !it.repo) {
      hold(it, "no `repo` — in poly, tree isolation cannot be proven for an unrouted item (route it first)");
      continue;
    }
    schedulable.push(it);
  }

  // ---- wave 0: in-flight leaves, exactly as they are ------------------------------------------
  frozen.sort(byRank);
  const wave0Repos = new Map();
  for (const it of frozen) {
    if (!it.repo) continue;
    wave0Repos.set(it.repo, (wave0Repos.get(it.repo) ?? 0) + 1);
  }
  if (s.onePerRepo) {
    for (const [repo, n] of wave0Repos) {
      if (n > 1) warnings.push(`${n} in-flight items share repo \`${repo}\` — they are already racing one working tree (sprint §1.3); not re-planned, but worth a look`);
    }
  }

  // ---- resolve every schedulable item's real predecessors -------------------------------------
  const predecessors = new Map();   // id -> Set(ids that must be in an EARLIER wave)
  for (const it of schedulable) {
    const preds = new Set();
    let bad = null;
    for (const dep of it.dependsOn) {
      if (dep === it.id) { bad = "dependsOn itself"; break; }
      const { targets, unknown, cyclicParent } = expandDep(dep, index, childrenByParent);
      if (unknown.length) { bad = `dependsOn \`${unknown[0]}\` — no such item in the backlog`; break; }
      if (cyclicParent) { bad = `dependsOn \`${dep}\`, whose parent chain is circular`; break; }
      for (const t of targets) preds.add(t);
    }
    if (bad) { hold(it, bad); predecessors.set(it.id, null); continue; }
    predecessors.set(it.id, preds);
  }

  // A frozen leaf whose dependency has not landed started early. Reality wins — it is not re-planned —
  // but it is worth saying out loud, because it is usually how a broken build got its head start.
  for (const it of frozen) {
    for (const dep of it.dependsOn) {
      const d = index.get(dep);
      if (d && !isTerminal(d)) warnings.push(`${it.id} is in flight but dependsOn \`${dep}\`, which is not landed (${d.status}) — it started ahead of its dependency`);
    }
  }

  const heldIds = new Set(held.map((h) => h.id));
  let queue = schedulable.filter((it) => !heldIds.has(it.id));

  // Holding is transitive: an item waiting on a held item can never become ready, so say that once
  // rather than letting it fall out of the loop later as an unexplained "cycle".
  for (let changed = true; changed;) {
    changed = false;
    for (const it of [...queue]) {
      const preds = predecessors.get(it.id) ?? new Set();
      const blocker = [...preds].find((p) => heldIds.has(p));
      if (!blocker) continue;
      hold(it, `dependsOn \`${blocker}\`, which is itself held`);
      heldIds.add(it.id);
      queue = queue.filter((q) => q.id !== it.id);
      changed = true;
    }
  }

  // ---- pack ------------------------------------------------------------------------------------
  const waves = [];
  if (frozen.length) waves.push({ n: 0, frozen: true, items: frozen });

  const placed = new Set(frozen.map((it) => it.id));
  // Scheduled waves always start at 1. Wave 0 *means* "already in flight" and keeps that meaning
  // whether or not anything happens to be running — a wave number that shifts meaning with the state
  // of the board is a number nobody can quote back at you.
  let waveNo = 1;

  while (queue.length) {
    const ready = queue.filter((it) => [...(predecessors.get(it.id) ?? new Set())].every((p) => placed.has(p) || !index.has(p)));
    if (!ready.length) {
      // No progress with items still queued: every remaining item sits on a cycle, or downstream of
      // one. Refuse to pick an edge to break.
      for (const it of queue) hold(it, "dependency cycle — this item and its dependencies wait on each other; break the cycle by hand");
      break;
    }

    ready.sort(byRank);
    const wave = [];
    const reposUsed = new Set();
    for (const it of ready) {
      if (wave.length >= s.maxWave) break;
      if (s.onePerRepo && reposUsed.has(it.repo)) continue;   // next wave — one item per working tree
      wave.push(it);
      if (it.repo) reposUsed.add(it.repo);
    }

    waves.push({ n: waveNo, frozen: false, items: wave });
    for (const it of wave) placed.add(it.id);
    queue = queue.filter((it) => !placed.has(it.id));
    waveNo++;
  }

  const scheduled = waves.filter((w) => !w.frozen).reduce((n, w) => n + w.items.length, 0);
  return {
    waves, held, containers, warnings, settings: s,
    stats: {
      total: all.length,
      done: done.length,
      frozen: frozen.length,
      scheduled,
      held: held.length,
      waves: waves.filter((w) => !w.frozen).length,
      widest: waves.reduce((m, w) => Math.max(m, w.items.length), 0),
    },
  };
}

// The one line the plan file records, so the schedule is readable without parsing the tables.
export const waveSummary = (r) =>
  r.waves.map((w) => `w${w.n}[${w.items.map((it) => it.id).join("|")}]${w.frozen ? "*" : ""}`).join(" -> ");

// ---- staleness ---------------------------------------------------------------------------------
// A persisted plan is obeyed by `/aidlc:next` and `/aidlc:sprint`, which makes "is it still true?" a
// correctness question rather than a nicety. The fingerprint covers exactly the fields the packing
// depends on — change any of them and the wave boundaries may be wrong.

export const fingerprintFields = (it) => [
  norm(it.id), lower(it.type), lower(it.status), String(it.priority ?? ""),
  norm(it.repo) ?? "", norm(it.parent) ?? "",
  (it.dependsOn ?? []).map(norm).filter(Boolean).sort().join(","),
].join("|");

export function planFingerprint(items) {
  const rows = (Array.isArray(items) ? items : (items?.items ?? []))
    .map(fingerprintFields).sort();
  return createHash("sha256").update(rows.join("\n")).digest("hex").slice(0, 12);
}

/**
 * Compare the item snapshots a plan was cut from against the board as it is now.
 *
 * Three classes, because they want three different behaviours downstream:
 *   `none`     — nothing that affects the packing moved (items merely progressing is the plan working).
 *   `additive` — new work appeared, or a board priority changed. The waves are still valid; they are
 *                just no longer complete. Warn, keep going, suggest a replan.
 *   `breaking` — a planned item vanished, was re-typed, re-routed or re-wired. The packing may now be
 *                wrong, and a wrong packing is the silent failure this whole module exists to prevent.
 */
export function checkFreshness(planItems, currentItems) {
  const before = new Map((planItems ?? []).map((it) => [norm(it.id), it]));
  const after = new Map((currentItems ?? []).map((it) => [norm(it.id), it]));
  const drift = [];

  for (const [id, was] of before) {
    const now = after.get(id);
    if (!now) { drift.push({ id, kind: "vanished", class: "breaking", detail: "no longer on the board (deleted, superseded or re-decomposed)" }); continue; }
    if (lower(was.type) !== lower(now.type)) drift.push({ id, kind: "retyped", class: "breaking", detail: `type ${lower(was.type)} → ${lower(now.type)}` });
    if ((norm(was.repo) ?? "") !== (norm(now.repo) ?? "")) drift.push({ id, kind: "rerouted", class: "breaking", detail: `repo ${was.repo ?? "null"} → ${now.repo ?? "null"}` });
    const dw = (was.dependsOn ?? []).map(norm).filter(Boolean).sort().join(",");
    const dn = (now.dependsOn ?? []).map(norm).filter(Boolean).sort().join(",");
    if (dw !== dn) drift.push({ id, kind: "rewired", class: "breaking", detail: `dependsOn [${dw}] → [${dn}]` });
    if (String(was.priority ?? "") !== String(now.priority ?? "")) drift.push({ id, kind: "reprioritized", class: "additive", detail: `priority ${was.priority ?? "none"} → ${now.priority ?? "none"} on the board` });
    if (lower(was.status) !== lower(now.status)) drift.push({ id, kind: "progressed", class: "none", detail: `status ${was.status} → ${now.status}` });
  }

  for (const [id, now] of after) {
    if (before.has(id)) continue;
    if (isTerminal(now)) continue;                                   // arrived already finished — irrelevant
    if (CONTAINER_TYPES.includes(lower(now.type))) continue;         // containers are never scheduled
    drift.push({ id, kind: "new", class: "additive", detail: `${lower(now.type) ?? "item"} added since the plan — unscheduled` });
  }

  const cls = drift.some((d) => d.class === "breaking") ? "breaking"
    : drift.some((d) => d.class === "additive") ? "additive"
      : "none";
  return { class: cls, drift, fresh: cls !== "breaking" };
}

// ---- cli ---------------------------------------------------------------------------------------
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
const USAGE = "usage: node resolve-waves.mjs <items.json> [aidlc.config.json]\n" +
              "       node resolve-waves.mjs --freshness <plan-snapshot.json> <items-now.json>";

const readJson = (p) => {
  try { return JSON.parse(readFileSync(p, "utf8")); }
  catch (e) { console.error(`cannot read ${p}: ${e.message}`); process.exit(2); }
};

if (isMain && process.argv[2] === "--freshness") {
  const [snapPath, nowPath] = process.argv.slice(3);
  if (!snapPath || !nowPath) { console.error(USAGE); process.exit(2); }
  const planned = readJson(snapPath), now = readJson(nowPath);
  const f = checkFreshness(Array.isArray(planned) ? planned : (planned?.items ?? []),
    Array.isArray(now) ? now : (now?.items ?? []));

  // The class is the whole verdict: `none` follow silently, `additive` follow and say what is missing,
  // `breaking` do NOT follow — announce it and fall back to priority order.
  console.log(`class: ${f.class}   follow-the-plan: ${f.fresh ? "yes" : "NO — fall back to priority order"}`);
  console.log(`planned fingerprint: ${planFingerprint(planned)}   now: ${planFingerprint(now)}`);
  if (!f.drift.length) console.log("\nno drift");
  for (const cls of ["breaking", "additive", "none"]) {
    const rows = f.drift.filter((d) => d.class === cls);
    if (!rows.length) continue;
    console.log(`\n${cls}:`);
    for (const d of rows) console.log(`  ${String(d.id).padEnd(12)} ${d.kind.padEnd(14)} ${d.detail}`);
  }
  process.exit(0);
}

if (isMain) {
  const [itemsPath, cfgPath] = process.argv.slice(2);
  if (!itemsPath) { console.error(USAGE); process.exit(2); }
  const items = readJson(itemsPath);
  const config = cfgPath ? readJson(cfgPath) : {};

  const r = resolveWaves(items, config);
  console.log(`layout: ${r.settings.layout}  maxWave=${r.settings.maxWave}  onePerRepo=${r.settings.onePerRepo}`);
  console.log(`schedule: ${waveSummary(r) || "(nothing to schedule)"}`);
  console.log(`fingerprint: ${planFingerprint(items)}`);
  console.log(`${r.stats.scheduled} item(s) across ${r.stats.waves} wave(s) · ${r.stats.frozen} frozen · ${r.stats.held} held · ${r.stats.done} done\n`);

  for (const w of r.waves) {
    console.log(w.frozen
      ? `  WAVE ${w.n} — IN FLIGHT (frozen, not re-planned):`
      : `  WAVE ${w.n} (${w.items.length} concurrent):`);
    for (const it of w.items) console.log(`    ${String(it.id).padEnd(12)} ${(it.repo ?? "-").padEnd(14)} ${it.title ?? ""}`);
  }
  if (r.containers.length) {
    console.log("\ncontainers (scheduled through their children, never as work):");
    for (const c of r.containers) console.log(`  ${String(c.id).padEnd(12)} ${c.type} → ${c.children.join(", ") || "(no open children)"}`);
  }
  if (r.held.length) {
    console.log("\nheld:");
    for (const h of r.held) console.log(`  ${String(h.id).padEnd(12)} — ${h.reason}`);
  }
  if (r.warnings.length) {
    console.log("\nwarnings:");
    for (const w of r.warnings) console.log(`  - ${w}`);
  }
}
