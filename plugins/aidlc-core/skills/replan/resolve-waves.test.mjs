// Regression tests for resolve-waves.mjs. Run: `node resolve-waves.test.mjs`.
//
// A wave schedule is obeyed by `/aidlc:next` and `/aidlc:sprint`, so every case below is a way the
// schedule could be wrong *without anything erroring*: an item launched before its dependency, two
// poly items launched into one working tree, an epic frozen because F19 rolled it to in_progress, a
// stale plan silently followed. Wherever the packing cannot prove a placement is safe, the expected
// answer is HELD.
import {
  resolveWaves, replanSettings, isContainer, rankOf, waveSummary, stageSummary,
  planFingerprint, checkFreshness, fingerprintFields, stageOf, stageLabels, UNSTAGED,
  CONTAINER_TYPES, LEAF_TYPES, REPLAN_DEFAULTS,
} from "./resolve-waves.mjs";

let n = 0, fails = 0;
function check(label, actual, expected) {
  n++;
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`ok    ${label}`); return; }
  fails++;
  console.log(`FAIL  ${label}\n      expected ${e}\n      actual   ${a}`);
}

// An item, with the fields the packer actually reads. Defaults to a ready single-repo story.
const it = (id, extra = {}) => ({ id, type: "story", status: "todo", priority: "P2", repo: "backend", title: `item ${id}`, ...extra });
const POLY = { repos: [{ name: "backend", path: "backend" }, { name: "frontend", path: "frontend" }, { name: "db", path: "db" }] };
const MONO = {};

// Wave shape as ids, frozen wave marked — the thing every assertion below is really about.
const shape = (r) => r.waves.map((w) => (w.frozen ? { frozen: w.items.map((x) => x.id) } : w.items.map((x) => x.id)));
const heldFor = (r, id) => r.held.find((h) => h.id === id)?.reason ?? null;
const isHeld = (r, id) => r.held.some((h) => h.id === id);

// ---------------------------------------------------------------- settings & layout
check("poly is detected from a non-empty repos[]", replanSettings(POLY).layout, "poly");
check("mono is detected from an absent repos[]", replanSettings(MONO).layout, "mono");
check("one-item-per-repo binds in poly", replanSettings(POLY).onePerRepo, true);
check("one-item-per-repo does NOT bind in mono (worktrees isolate)", replanSettings(MONO).onePerRepo, false);
check("maxWave defaults to 3", replanSettings(POLY).maxWave, REPLAN_DEFAULTS.maxWave);
check("maxWave is clamped to the cap", replanSettings({ ...POLY, pipeline: { replan: { maxWave: 99 } } }).maxWave, REPLAN_DEFAULTS.maxWaveCap);
check("maxWave cannot go below 1", replanSettings({ ...POLY, pipeline: { replan: { maxWave: 0 } } }).maxWave, 1);

// ---------------------------------------------------------------- containers
const kidsOf = (items) => {
  const m = new Map();
  for (const x of items) { if (!x.parent) continue; if (!m.has(x.parent)) m.set(x.parent, []); m.get(x.parent).push(x); }
  return m;
};
check("epic is a container by type", isContainer(it("E1", { type: "epic" }), new Map()), true);
check("feature is a container by type (ADO tier, absent from the canonical enum)", isContainer(it("F1", { type: "feature" }), new Map()), true);
check("a plain story is not a container", isContainer(it("S1"), new Map()), false);
{
  // crossRepoSplit: task — a Story whose child Tasks are the real leaves is an umbrella, not work.
  const items = [it("S1"), it("T1", { type: "task", parent: "S1" })];
  check("a story with open children is a container (task-mode umbrella)", isContainer(items[0], kidsOf(items)), true);
}
{
  const items = [it("S1"), it("T1", { type: "task", parent: "S1", status: "done" })];
  check("a story whose children are all done is a runnable leaf again", isContainer(items[0], kidsOf(items)), false);
}

// ---------------------------------------------------------------- the F19 trap
{
  // /aidlc:run §3a rolls the parent to in_progress when the FIRST child starts. If that froze the
  // epic, every one of its remaining children would become unplannable — which is precisely the bug
  // the user called out. The epic is a container; only the running LEAF freezes.
  const r = resolveWaves([
    it("E1", { type: "epic", status: "in_progress", repo: null }),
    it("S1", { parent: "E1", status: "in_progress", repo: "backend" }),
    it("S2", { parent: "E1", repo: "frontend" }),
    it("S3", { parent: "E1", repo: "db" }),
  ], POLY);
  check("an in_progress EPIC is never frozen — its open children stay plannable", shape(r), [{ frozen: ["S1"] }, ["S2", "S3"]]);
  check("the epic is reported as a container, not as work", r.containers.map((c) => c.id), ["E1"]);
  check("the epic never appears in a wave", r.waves.flatMap((w) => w.items.map((x) => x.id)).includes("E1"), false);
}
{
  const r = resolveWaves([it("E1", { type: "epic", repo: null })], POLY);
  check("an epic with no open children is a finding, not silence", r.warnings.length, 1);
}

// ---------------------------------------------------------------- freezing in-flight leaves
{
  const r = resolveWaves([it("S1", { status: "in_progress" }), it("S2", { repo: "frontend" })], POLY);
  check("an in_progress leaf is wave 0, untouched", shape(r), [{ frozen: ["S1"] }, ["S2"]]);
}
check("in_review counts as in flight too",
  shape(resolveWaves([it("S1", { status: "in_review" })], POLY)), [{ frozen: ["S1"] }]);
check("the caller's `frozen` flag (a non-terminal run file) freezes a todo item",
  shape(resolveWaves([it("S1", { status: "todo", frozen: true })], POLY)), [{ frozen: ["S1"] }]);
{
  // Reality wins: a frozen item is never re-planned. But a head start on an unlanded dependency is
  // usually how a mystery red build began, so it is said out loud.
  const r = resolveWaves([it("S1", { status: "in_progress", dependsOn: ["S2"] }), it("S2", { repo: "frontend" })], POLY);
  check("a frozen item is not held for an unlanded dependency", shape(r)[0], { frozen: ["S1"] });
  check("...but it warns that it started ahead of it", r.warnings.some((w) => w.includes("ahead of its dependency")), true);
}
{
  const r = resolveWaves([it("S1", { status: "in_progress" }), it("S2", { status: "in_progress" })], POLY);
  check("two in-flight items in one poly repo warn (already racing a working tree)",
    r.warnings.some((w) => w.includes("racing one working tree")), true);
}

// ---------------------------------------------------------------- one item per working tree
{
  const r = resolveWaves([it("S1"), it("S2"), it("S3")], POLY);
  check("poly: three items in ONE repo land in three waves", shape(r), [["S1"], ["S2"], ["S3"]]);
}
{
  const r = resolveWaves([it("S1"), it("S2"), it("S3")], MONO);
  check("mono: three items share a wave — each sprint item gets its own worktree", shape(r), [["S1", "S2", "S3"]]);
}
{
  const r = resolveWaves([it("S1", { repo: "backend" }), it("S2", { repo: "frontend" }), it("S3", { repo: "db" })], POLY);
  check("poly: three items in three repos share one wave", shape(r), [["S1", "S2", "S3"]]);
}
{
  const r = resolveWaves([
    it("S1", { repo: "backend" }), it("S2", { repo: "frontend" }),
    it("S3", { repo: "db" }), it("S4", { repo: "backend" }),
  ], POLY);
  check("the wave width cap holds and the overflow rolls forward", shape(r), [["S1", "S2", "S3"], ["S4"]]);
}
check("control-plane counts as a repo for tree isolation",
  shape(resolveWaves([it("S1", { repo: "control-plane" }), it("S2", { repo: "control-plane" })], POLY)), [["S1"], ["S2"]]);

// ---------------------------------------------------------------- dependencies
{
  const r = resolveWaves([it("S2", { repo: "frontend", dependsOn: ["S1"] }), it("S1")], POLY);
  check("a dependent never shares its dependency's wave", shape(r), [["S1"], ["S2"]]);
}
{
  // D9, the whole point: contract lands, then both sides run at once. No frontend-behind-backend edge.
  const r = resolveWaves([
    it("C1", { repo: "backend", title: "OpenAPI path", priority: "P1" }),
    it("BE", { repo: "backend", dependsOn: ["C1"] }),
    it("FE", { repo: "frontend", dependsOn: ["C1"] }),
  ], POLY);
  check("contract-first: contract alone, then backend ‖ frontend", shape(r), [["C1"], ["BE", "FE"]]);
}
{
  // Same triple, but both implementations land in one repo: the contract makes them independent, the
  // working tree does not. Correctness of the packing beats the width.
  const r = resolveWaves([
    it("C1", { repo: "backend", priority: "P1" }),
    it("BE", { repo: "backend", dependsOn: ["C1"] }),
    it("FE", { repo: "backend", dependsOn: ["C1"] }),
  ], POLY);
  check("contract-first siblings in ONE repo still serialize on the tree", shape(r), [["C1"], ["BE"], ["FE"]]);
}
{
  // A dep on a container means "after everything under it".
  const r = resolveWaves([
    it("E1", { type: "epic", repo: null }),
    it("A1", { parent: "E1", repo: "backend" }),
    it("A2", { parent: "E1", repo: "frontend" }),
    it("Z", { repo: "db", dependsOn: ["E1"] }),
  ], POLY);
  check("a dependency on an epic expands to all its open children", shape(r), [["A1", "A2"], ["Z"]]);
}
check("a dependency already done is satisfied, not waited on",
  shape(resolveWaves([it("S1", { dependsOn: ["S0"] }), it("S0", { status: "done" })], POLY)), [["S1"]]);
check("a done item is never scheduled",
  resolveWaves([it("S0", { status: "done" })], POLY).stats.scheduled, 0);
{
  const r = resolveWaves([it("S2", { repo: "frontend", dependsOn: ["S1"] }), it("S1", { status: "in_progress" })], POLY);
  check("a dependent of an in-flight item waits for wave 0 to drain", shape(r), [{ frozen: ["S1"] }, ["S2"]]);
}

// ---------------------------------------------------------------- refusals
check("an unknown dependency is held, not ignored",
  heldFor(resolveWaves([it("S1", { dependsOn: ["NOPE-9"] })], POLY), "S1"), "dependsOn `NOPE-9` — no such item in the backlog");
check("a self-dependency is held",
  heldFor(resolveWaves([it("S1", { dependsOn: ["S1"] })], POLY), "S1"), "dependsOn itself");
check("a blocked item is held",
  heldFor(resolveWaves([it("S1", { status: "blocked" })], POLY), "S1"), "status is `blocked` — unblock it before it can be scheduled");
{
  const r = resolveWaves([it("S1", { repo: null })], POLY);
  check("poly: an unrouted item is held — tree isolation is unprovable", isHeld(r, "S1"), true);
}
check("mono: an unrouted item schedules fine (there is only one tree)",
  shape(resolveWaves([it("S1", { repo: null })], MONO)), [["S1"]]);
check("an unrecognized status is held rather than assumed ready",
  isHeld(resolveWaves([it("S1", { status: "wibble" })], POLY), "S1"), true);
{
  const r = resolveWaves([
    it("S1", { repo: "backend", dependsOn: ["S2"] }),
    it("S2", { repo: "frontend", dependsOn: ["S1"] }),
  ], POLY);
  check("a cycle is held, never broken by guessing", r.held.map((h) => h.id).sort(), ["S1", "S2"]);
  check("...and says it is a cycle", heldFor(r, "S1").includes("dependency cycle"), true);
}
{
  const r = resolveWaves([
    it("B", { status: "blocked", repo: "backend" }),
    it("C", { repo: "frontend", dependsOn: ["B"] }),
    it("D", { repo: "db", dependsOn: ["C"] }),
  ], POLY);
  check("holding is transitive — a chain behind a blocked item is held, not silently cycled",
    r.held.map((h) => h.id).sort(), ["B", "C", "D"]);
  check("...and each names its actual blocker", heldFor(r, "C"), "dependsOn `B`, which is itself held");
}
{
  const r = resolveWaves([it("S1", { parent: "S1" })], POLY);
  check("a circular parent chain does not hang the resolver", r.stats.total, 1);
}

// ---------------------------------------------------------------- ordering
check("explicit order beats priority (that IS the re-prioritization)",
  shape(resolveWaves([it("S1", { priority: "P1", order: 2 }), it("S2", { priority: "P4", order: 1, repo: "frontend" })], POLY)),
  [["S2", "S1"]]);
check("without an explicit order, priority decides",
  shape(resolveWaves([it("S1", { priority: "P3" }), it("S2", { priority: "P1", repo: "frontend" })], POLY)), [["S2", "S1"]]);
check("ties break on id, so the same board always yields the same schedule",
  shape(resolveWaves([it("PROJ-9", { repo: "frontend" }), it("PROJ-2")], POLY)), [["PROJ-2", "PROJ-9"]]);
check("a missing priority sorts last, never first",
  shape(resolveWaves([it("S1", { priority: null }), it("S2", { priority: "P4", repo: "frontend" })], POLY)), [["S2", "S1"]]);
check("rankOf reads P-levels", [rankOf(it("a", { priority: "P1" })).priority, rankOf(it("b", { priority: "p3" })).priority], [1, 3]);
{
  // Repo pressure decides *which wave*, priority decides *the order within it* — a P1 stuck behind a
  // same-repo P1 must not silently outrank a P2 that can actually run now.
  const r = resolveWaves([
    it("A", { priority: "P1", repo: "backend" }),
    it("B", { priority: "P1", repo: "backend" }),
    it("C", { priority: "P2", repo: "frontend" }),
  ], POLY);
  check("a same-repo P1 rolls forward; the runnable P2 joins wave 1", shape(r), [["A", "C"], ["B"]]);
}

// ---------------------------------------------------------------- stages (grouping directives)
// The bug these pin: `order` alone cannot express "ALL of these before ANY of those". Ranking the
// backend 1..3 and the UI 4..5 and hoping is exactly what silently fails, and it fails WORST in poly,
// where the free frontend slot pulls a UI item into wave 1 however low it ranks.
const be = (id, extra = {}) => it(id, { repo: "backend", stage: 1, stageLabel: "backend", ...extra });
const ui = (id, extra = {}) => it(id, { repo: "frontend", stage: 2, stageLabel: "ui", ...extra });

check("stageOf takes integers only — a bare label carries no order", [stageOf({ stage: 2 }), stageOf({ stage: "UI" }), stageOf({})], [2, null, null]);
check("stageLabels maps the number a human cannot read to the word they typed",
  [...stageLabels([it("A", { stage: 1, stageLabel: "backend" }), it("B", { stage: 2, stageLabel: "ui" })])], [[1, "backend"], [2, "ui"]]);
{
  // The exact reproduction: without stages this packs w1[BE-1|UI-1] -> w2[BE-2|UI-2] -> w3[BE-3].
  const items = [be("BE-1", { order: 1 }), be("BE-2", { order: 2 }), be("BE-3", { order: 3 }), ui("UI-1", { order: 4 }), ui("UI-2", { order: 5 })];
  const r = resolveWaves(items, POLY);
  check("poly: a stage barrier keeps every UI item out until the backend has drained",
    shape(r), [["BE-1"], ["BE-2"], ["BE-3"], ["UI-1"], ["UI-2"]]);
  check("...and the one-per-repo rule still binds INSIDE a stage (one checkout, sprint §1.3)",
    r.waves.every((w) => w.items.length === 1), true);
  check("...each wave carries the stage it belongs to", r.waves.map((w) => w.stageLabel), ["backend", "backend", "backend", "ui", "ui"]);
  check("...and the barrier is legible in one line", stageSummary(r), "backend: w1[BE-1] -> w2[BE-2] -> w3[BE-3]  ||  ui: w4[UI-1] -> w5[UI-2]");
}
{
  const r = resolveWaves([be("BE-1"), be("BE-2"), be("BE-3"), ui("UI-1"), ui("UI-2")], MONO);
  check("mono: the barrier holds too — width comes from worktrees, order comes from the stage",
    shape(r), [["BE-1", "BE-2", "BE-3"], ["UI-1", "UI-2"]]);
}
{
  // Gate on PLACEABLE work: a blocked ticket must not freeze the whole UI half of the board.
  const r = resolveWaves([be("BE-1"), be("BE-2", { status: "blocked" }), ui("UI-1")], POLY);
  check("a held item in an earlier stage does not stall the later stage", shape(r), [["BE-1"], ["UI-1"]]);
  check("...but the unsatisfied directive is said out loud, not discovered later",
    r.warnings.some((w) => w.includes("BE-2") && w.includes("not fully satisfied")), true);
}
{
  // A stage is a preference; a dependency is correctness. When they disagree, correctness wins.
  const r = resolveWaves([be("BE-1", { dependsOn: ["UI-1"] }), ui("UI-1")], POLY);
  check("a stage that contradicts dependsOn is relaxed, not obeyed into a broken build", shape(r), [["UI-1"], ["BE-1"]]);
  check("...and the contradiction is reported", r.warnings.some((w) => w.includes("contradicts the dependency graph")), true);
  check("...only once, however many waves it takes to drain",
    r.warnings.filter((w) => w.includes("contradicts the dependency graph")).length, 1);
}
{
  const r = resolveWaves([be("BE-1"), ui("UI-1"), it("X", { repo: "db" })], POLY);
  check("an unstaged item runs LAST — too early silently breaks the directive, too late merely costs time",
    shape(r), [["BE-1"], ["UI-1"], ["X"]]);
  check("...and is named, because an unclassified item is a question for the analyst",
    r.warnings.some((w) => w.includes("X") && w.includes("not assigned one")), true);
}
check("a non-numeric stage is dropped LOUDLY — a silent drop looks like a directive that was honoured",
  resolveWaves([it("S1", { stage: "UI" })], POLY).warnings.some((w) => w.includes("non-numeric")), true);
{
  // The whole feature is opt-in: no stage anywhere and the packing is what it always was.
  const plain = [it("S1", { repo: "backend" }), it("S2", { repo: "frontend" }), it("S3", { repo: "db" })];
  const r = resolveWaves(plain, POLY);
  check("no stage declared ⇒ no barrier, and the old packing is untouched", shape(r), [["S1", "S2", "S3"]]);
  check("...no stage vocabulary leaks into the result", [r.stages, stageSummary(r), r.stats.staged], [[], null, false]);
  check("...and UNSTAGED cancels out of the rank rather than reordering anything",
    rankOf(it("S1")).stage, UNSTAGED);
}
{
  // In-flight work outranks every directive: wave 0 is a read, whatever stage the item is in.
  const r = resolveWaves([ui("UI-1", { status: "in_progress" }), be("BE-1")], POLY);
  check("a frozen item is not pulled back by a barrier it violates", shape(r), [{ frozen: ["UI-1"] }, ["BE-1"]]);
  check("...and wave 0 claims no stage", r.waves[0].stage, null);
}
{
  // The result is serialized straight into .aidlc/plan.md. Infinity would become `null` there without
  // anything saying so, and a stage number that silently became null is a barrier nobody can audit.
  const r = resolveWaves([be("BE-1"), it("X", { repo: "db" })], POLY);
  check("the unstaged bucket serializes as a deliberate null, not an Infinity artifact",
    JSON.parse(JSON.stringify(r.stages)), [{ stage: 1, label: "backend" }, { stage: null, label: "unstaged" }]);
  check("...and the trailing wave is labelled `unstaged`, distinguishing it from a relaxed barrier",
    r.waves.map((w) => [w.stage, w.stageLabel]), [[1, "backend"], [null, "unstaged"]]);
}
check("stages are reported in order, with their labels, for the plan file",
  resolveWaves([be("BE-1"), ui("UI-1")], POLY).stages, [{ stage: 1, label: "backend" }, { stage: 2, label: "ui" }]);
check("stage beats order — that is the entire point of having both",
  shape(resolveWaves([it("A", { stage: 2, order: 1, repo: "backend" }), it("B", { stage: 1, order: 99, repo: "frontend" })], POLY)),
  [["B"], ["A"]]);

// ---------------------------------------------------------------- summary + stats
{
  const r = resolveWaves([it("S1", { status: "in_progress" }), it("S2", { repo: "frontend" }), it("S3", { repo: "db" })], POLY);
  check("waveSummary reads as the schedule it is", waveSummary(r), "w0[S1]* -> w1[S2|S3]");
  check("stats count each class once", [r.stats.frozen, r.stats.scheduled, r.stats.waves, r.stats.held], [1, 2, 1, 0]);
}
check("scheduled waves start at 1 even when nothing is in flight",
  resolveWaves([it("S1")], POLY).waves[0].n, 1);
check("an empty backlog resolves to an empty schedule, not an error",
  [waveSummary(resolveWaves([], POLY)), resolveWaves([], POLY).stats.scheduled], ["", 0]);

// ---------------------------------------------------------------- fingerprint
{
  const a = [it("S1"), it("S2", { repo: "frontend" })];
  const b = [it("S2", { repo: "frontend" }), it("S1")];
  check("fingerprint ignores input order", planFingerprint(a), planFingerprint(b));
  check("fingerprint moves when a dependency is rewired",
    planFingerprint(a) === planFingerprint([it("S1", { dependsOn: ["S2"] }), it("S2", { repo: "frontend" })]), false);
  check("fingerprint moves when an item is re-routed",
    planFingerprint(a) === planFingerprint([it("S1", { repo: "db" }), it("S2", { repo: "frontend" })]), false);
  check("fingerprint covers exactly the fields the packing reads",
    fingerprintFields(it("S1", { dependsOn: ["B", "A"], parent: "E1" })), "S1|story|todo|P2|backend|E1|A,B");
  check("dependsOn order does not change the fingerprint",
    fingerprintFields(it("S1", { dependsOn: ["A", "B"] })), fingerprintFields(it("S1", { dependsOn: ["B", "A"] })));
}

// ---------------------------------------------------------------- freshness
{
  const planned = [it("S1"), it("S2", { repo: "frontend" })];
  check("an unchanged board is fresh", checkFreshness(planned, planned).class, "none");
  check("items merely progressing is the plan WORKING, not drift",
    checkFreshness(planned, [it("S1", { status: "done" }), it("S2", { repo: "frontend", status: "in_progress" })]).class, "none");

  const added = checkFreshness(planned, [...planned, it("S3", { repo: "db" })]);
  check("new work is additive — the waves are still valid, just incomplete", added.class, "additive");
  check("...and names what is unscheduled", added.drift.find((d) => d.kind === "new").id, "S3");

  check("a new epic is not drift — containers are never scheduled",
    checkFreshness(planned, [...planned, it("E9", { type: "epic", repo: null })]).class, "none");
  check("a new item that arrived already done is not drift",
    checkFreshness(planned, [...planned, it("S9", { status: "done", repo: "db" })]).class, "none");

  check("a board priority change is additive — and the signal to replan",
    checkFreshness(planned, [it("S1", { priority: "P1" }), it("S2", { repo: "frontend" })]).class, "additive");

  check("a vanished item is breaking (superseded / re-decomposed)",
    checkFreshness(planned, [it("S1")]).class, "breaking");
  check("a rewired dependency is breaking",
    checkFreshness(planned, [it("S1", { dependsOn: ["S2"] }), it("S2", { repo: "frontend" })]).class, "breaking");
  check("a re-routed item is breaking",
    checkFreshness(planned, [it("S1", { repo: "db" }), it("S2", { repo: "frontend" })]).class, "breaking");
  check("a leaf that became a container is breaking (it got decomposed)",
    checkFreshness(planned, [it("S1", { type: "epic" }), it("S2", { repo: "frontend" })]).class, "breaking");
  check("breaking wins over additive when both are present",
    checkFreshness(planned, [it("S1", { repo: "db" }), it("S2", { repo: "frontend" }), it("S3", { repo: "db" })]).class, "breaking");
  check("`fresh` is false only for breaking drift",
    [checkFreshness(planned, planned).fresh, checkFreshness(planned, [...planned, it("S3", { repo: "db" })]).fresh, checkFreshness(planned, [it("S1")]).fresh],
    [true, true, false]);
}

// ---------------------------------------------------------------- exported vocabulary
check("container and leaf types do not overlap", CONTAINER_TYPES.some((t) => LEAF_TYPES.includes(t)), false);

console.log(`\n${n - fails}/${n} passed`);
process.exit(fails ? 1 : 0);
