// Regression tests for resolve-fanout.mjs. Run: `node resolve-fanout.test.mjs`.
//
// Fanning out the implement phase trades a safety property for wall-clock, so every case below is a
// way the trade could go wrong silently. The asymmetry that shapes all of it: over-serializing wastes
// time and says so out loud; under-serializing loses code and says nothing. Wherever the resolver
// cannot prove disjointness, the expected answer is SERIAL.
import {
  resolveFanout, pathsOverlap, globToRegExp, sharedHit, fanoutSettings, scheduleSummary,
  DEFAULT_SHARED_PATTERNS,
} from "./resolve-fanout.mjs";

let n = 0, fails = 0;
function check(label, actual, expected) {
  n++;
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`ok    ${label}`); return; }
  fails++;
  console.log(`FAIL  ${label}\n      expected ${e}\n      actual   ${a}`);
}

const t = (id, paths, extra = {}) => ({ id, title: `task ${id}`, paths, ...extra });
const shape = (r) => r.schedule.map((g) => (g.kind === "parallel" ? g.tasks.map((x) => x.id) : g.tasks[0].id));
const reasonFor = (r, id) => r.serialReasons[id] ?? null;

// ---------------------------------------------------------------- glob matching
check("**/ spans zero directories", globToRegExp("**/package.json").test("package.json"), true);
check("**/ spans many directories", globToRegExp("**/package.json").test("apps/web/package.json"), true);
check("* does not cross a separator", globToRegExp("src/*.ts").test("src/a/b.ts"), false);
check("* matches within a segment", globToRegExp("src/*.ts").test("src/a.ts"), true);
check("brace alternation", globToRegExp("**/index.{ts,tsx}").test("src/ui/index.tsx"), true);
check("brace alternation rejects a non-member", globToRegExp("**/index.{ts,tsx}").test("src/ui/index.css"), false);
check("dots are literal, not wildcards", globToRegExp("a.ts").test("axts"), false);
check("trailing ** matches a subtree", globToRegExp(".aidlc/**").test(".aidlc/runs/PROJ-1.md"), true);
check("windows separators are normalized", globToRegExp("src/**/x.ts").test("src\\a\\x.ts"), true);
check("? matches one non-separator char", globToRegExp("a?.ts").test("ab.ts"), true);

// ---------------------------------------------------------------- overlap detection
check("identical paths overlap", pathsOverlap("src/a.ts", "src/a.ts"), true);
check("case-insensitive (Windows) paths overlap", pathsOverlap("src/A.ts", "src/a.ts"), true);
check("distinct siblings do not overlap", pathsOverlap("src/a.ts", "src/b.ts"), false);
check("a directory contains its file", pathsOverlap("src/screens", "src/screens/users.tsx"), true);
check("containment is symmetric", pathsOverlap("src/screens/users.tsx", "src/screens"), true);
check("a trailing slash does not change containment", pathsOverlap("src/screens/", "src/screens/users.tsx"), true);
check("a prefix that is not a path boundary does not overlap", pathsOverlap("src/screen", "src/screens/users.tsx"), false);
check("a glob overlaps a literal it matches", pathsOverlap("src/**/*.tsx", "src/screens/users.tsx"), true);
check("a glob does not overlap a literal it misses", pathsOverlap("src/**/*.tsx", "src/lib/util.ts"), false);
check("two globs are assumed to overlap (unprovable, so serial)", pathsOverlap("src/a/**", "src/b/**"), true);
check("an empty path proves nothing, so it overlaps", pathsOverlap("", "src/a.ts"), true);

// ---------------------------------------------------------------- the pagination case, end to end
// The scenario the feature was built for: one shared component, then N disjoint screens.
const pagination = [
  t("1", ["src/hooks/usePagination.ts", "src/components/DataTable.tsx"], { foundation: true }),
  t("2", ["src/screens/users.tsx"]),
  t("3", ["src/screens/orders.tsx"]),
  t("4", ["src/screens/invoices.tsx"]),
  t("5", ["src/screens/products.tsx"]),
];
const pag = resolveFanout(pagination, { pipeline: { implementFanout: { maxAgents: 3 } } });
check("foundation runs alone and first", shape(pag)[0], "1");
check("screens fan out, capped at maxAgents", shape(pag), ["1", ["2", "3", "4"], "5"]);
check("a leftover screen below minGroup falls back to serial", reasonFor(pag, "5"), "alone in its window (needs 2+ disjoint neighbours)");
check("foundation's reason is stated", reasonFor(pag, "1"), "foundation — later tasks build on it");
check("summary line records what ran concurrently", scheduleSummary(pag), "1 -> [2|3|4] -> 5");
check("parallelized count is reported", [pag.parallelTasks, pag.windows], [3, 1]);

const pag5 = resolveFanout(pagination, { pipeline: { implementFanout: { maxAgents: 5 } } });
check("a wider cap fans all four screens out at once", shape(pag5), ["1", ["2", "3", "4", "5"]]);

// ---------------------------------------------------------------- the safety rules
check(
  "a task with no declared paths is never parallelized",
  reasonFor(resolveFanout([t("1", []), t("2", []), t("3", [])], {}), "1"),
  "no declared paths — disjointness cannot be proven",
);

const barrel = resolveFanout([t("1", ["src/ui/index.ts"]), t("2", ["src/a.tsx"]), t("3", ["src/b.tsx"])], {});
check("a barrel/aggregator edit is held serial", reasonFor(barrel, "1"), "touches shared path `src/ui/index.ts` (matched `**/index.{ts,tsx,js,jsx,mjs,cjs}`) — one writer at a time");
check("its disjoint neighbours still fan out", shape(barrel), ["1", ["2", "3"]]);

const lock = resolveFanout([t("1", ["src/a.tsx", "package.json"]), t("2", ["src/b.tsx"]), t("3", ["src/c.tsx"])], {});
check("one shared path anywhere in a task holds the whole task serial", shape(lock), ["1", ["2", "3"]]);

// A named API contract is shared by definition — same artifact §7 trigger 2 gates on. Uses a contract
// path the DEFAULT patterns do not already catch, so this proves the apiContracts wiring itself rather
// than re-testing `**/openapi.{json,yaml,yml}`.
const contractCfg = { saas: { apiContracts: [{ path: "api/contracts/orders.v1.json", public: true }] } };
check(
  "a declared apiContracts path counts as shared",
  sharedHit(t("x", ["api/contracts/orders.v1.json"]), fanoutSettings(contractCfg).sharedPatterns)?.pattern,
  "api/contracts/orders.v1.json",
);
check(
  "apiContracts accepts a bare string as well as {path}",
  sharedHit(t("x", ["proto/orders.proto"]), fanoutSettings({ saas: { apiContracts: ["proto/orders.proto"] } }).sharedPatterns)?.pattern,
  "proto/orders.proto",
);
check("a project's own sharedPaths are honored", sharedHit(t("x", ["src/theme.ts"]), fanoutSettings({ pipeline: { implementFanout: { sharedPaths: ["**/theme.ts"] } } }).sharedPatterns)?.pattern, "**/theme.ts");

// ---------------------------------------------------------------- dependsOn: disjoint != independent
// The trap that makes path analysis alone unsafe. Both tasks touch different files and task 3 still
// cannot run beside task 2, because it imports what task 2 creates.
const dep = resolveFanout([t("1", ["a.tsx"]), t("2", ["lib/fmt.ts"]), t("3", ["b.tsx"], { dependsOn: ["2"] })], {});
check("a dependent task never shares a window with its dependency", shape(dep), [["1", "2"], "3"]);
check("...and is not blamed for it", reasonFor(dep, "3"), "alone in its window (needs 2+ disjoint neighbours)");

const chain = resolveFanout([t("1", ["a.ts"]), t("2", ["b.ts"], { dependsOn: ["1"] }), t("3", ["c.ts"], { dependsOn: ["2"] })], {});
check("a transitive chain is fully serialized", shape(chain), ["1", "2", "3"]);

const byIndex = resolveFanout([t("1", ["a.ts"]), t("2", ["b.ts"]), t("3", ["c.ts"], { dependsOn: [1] })], {});
check("dependsOn accepts a 1-based index as well as an id", shape(byIndex), [["1", "2"], "3"]);

const fwd = resolveFanout([t("1", ["a.ts"], { dependsOn: ["2"] }), t("2", ["b.ts"]), t("3", ["c.ts"])], {});
check("a forward dependsOn is reported, not scheduled around", fwd.warnings.length > 0, true);
check("...and both ends are held serial", shape(fwd), ["1", "2", "3"]);

// ---------------------------------------------------------------- ordering is never rearranged
const interleaved = resolveFanout(
  [t("1", ["a.tsx"]), t("2", ["shared/index.ts"]), t("3", ["b.tsx"]), t("4", ["c.tsx"])],
  {},
);
check("a serial task splits its neighbours into separate windows", shape(interleaved), ["1", "2", ["3", "4"]]);
check("plan order survives windowing", scheduleSummary(interleaved), "1 -> 2 -> [3|4]");

const collide = resolveFanout([t("1", ["src/a.tsx"]), t("2", ["src/a.tsx"]), t("3", ["src/b.tsx"])], {});
check("two tasks on the same file are never in one window", shape(collide), ["1", ["2", "3"]]);

// ---------------------------------------------------------------- settings
check("fan-out can be switched off entirely", shape(resolveFanout([t("1", ["a.ts"]), t("2", ["b.ts"])], { pipeline: { implementFanout: { enabled: false } } })), ["1", "2"]);
check("disabling states why", reasonFor(resolveFanout([t("1", ["a.ts"])], { pipeline: { implementFanout: { enabled: false } } }), "1"), "fan-out disabled (pipeline.implementFanout.enabled: false)");
check("maxAgents is capped so one item cannot spawn a fleet", fanoutSettings({ pipeline: { implementFanout: { maxAgents: 99 } } }).maxAgents, 5);
check("maxAgents cannot drop below 1", fanoutSettings({ pipeline: { implementFanout: { maxAgents: 0 } } }).maxAgents, 1);
check("minGroup cannot drop below 2 (a 'parallel' batch of one is serial)", fanoutSettings({ pipeline: { implementFanout: { minGroup: 1 } } }).minGroup, 2);
check("defaults apply with no config at all", [fanoutSettings({}).enabled, fanoutSettings({}).maxAgents], [true, 3]);
check("the default shared list is non-trivial", DEFAULT_SHARED_PATTERNS.length > 20, true);

// ---------------------------------------------------------------- degenerate input
check("an empty plan yields an empty schedule", resolveFanout([], {}).schedule.length, 0);
check("a single task is serial (nothing to pair with)", shape(resolveFanout([t("1", ["a.ts"])], {})), ["1"]);
check("a plan object with a tasks[] array is accepted", shape(resolveFanout({ tasks: [t("1", ["a.ts"]), t("2", ["b.ts"])] }, {})), [["1", "2"]]);
check("missing ids fall back to 1-based position", resolveFanout([{ paths: ["a.ts"] }, { paths: ["b.ts"] }], {}).tasks.map((x) => x.id), ["1", "2"]);

console.log(`\n${n - fails}/${n} passed, ${fails} failed`);
if (fails) process.exit(1);
