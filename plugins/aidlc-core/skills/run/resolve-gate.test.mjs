// Regression tests for resolve-gate.mjs. Run: `node resolve-gate.test.mjs`.
//
// The layering rule exists because a live adoption run proved the obvious reading wrong: taking
// only the narrowest step list made a Python package inside a TypeScript monorepo lose the
// repo-wide lint gate, silently. Every case below is a way that can happen again.
import { resolveGate, coverageHoles, environmentDependent } from "./resolve-gate.mjs";

let n = 0, fails = 0;
function check(label, actual, expected) {
  n++;
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`ok    ${label}`); return; }
  fails++;
  console.log(`FAIL  ${label}\n      expected ${e}\n      actual   ${a}`);
}
const names = (r) => r.steps.map((s) => s.name);
const cmds = (r) => r.steps.map((s) => s.cmd ?? null);

const step = (name, cmd, extra = {}) => ({ name, status: "present", cmd, required: true, scope: "repo", ...extra });
const absentStep = (name) => ({ name, status: "absent", required: false, scope: "repo" });

const cfg = {
  pipeline: {
    gates: {
      ambiguousRequirements: "ask-human",
      verify: {
        maxItemMinutes: 10,
        steps: [step("lint", "ws lint"), step("test", "ws test")],
        repos: {
          api: { steps: [step("lint", "ruff check ."), step("test", "pytest", { environmentDependent: true, services: ["postgres"] }), absentStep("typecheck")] },
          platform: {
            steps: [step("test", "turbo run test", { scope: "affected" }), step("lint", "turbo run lint", { scope: "affected" })],
            packages: {
              worker: { steps: [step("test", "pytest", { cwd: "packages/worker", scope: "package" })] },
              ui: { steps: [absentStep("lint"), step("e2e", "playwright test")] },
            },
          },
          bare: {},
        },
      },
    },
  },
};

// ---- layering ----
check("workspace-only repo falls back to verify.steps", names(resolveGate(cfg, "unknown")), ["lint", "test"]);
check("repo steps replace same-named workspace steps in place", cmds(resolveGate(cfg, "api")), ["ruff check .", "pytest", null]);
check("repo layer keeps workspace ORDER when replacing", names(resolveGate(cfg, "api")), ["lint", "test", "typecheck"]);
check("a repo with no steps key still gets the workspace gate", names(resolveGate(cfg, "bare")), ["lint", "test"]);

// THE regression: a package must not lose the repo's other gates
check("package test replaces repo test but repo lint SURVIVES",
  names(resolveGate(cfg, "platform", "worker")), ["test", "lint"]);
check("package test replaces the repo command, not just the name",
  cmds(resolveGate(cfg, "platform", "worker")), ["pytest", "turbo run lint"]);
check("the surviving repo step keeps its own scope",
  resolveGate(cfg, "platform", "worker").steps.find((s) => s.name === "lint").scope, "affected");
check("the package step keeps its cwd",
  resolveGate(cfg, "platform", "worker").steps.find((s) => s.name === "test").cwd, "packages/worker");
// compared key-by-key: `from` is an object, so a whole-object stringify would assert key ORDER too
const provenance = resolveGate(cfg, "platform", "worker").from;
check("provenance: the package owns its own test step", provenance.test, "verify.repos.platform.packages.worker.steps");
check("provenance: the inherited lint step is attributed to the repo", provenance.lint, "verify.repos.platform.steps");

// ---- the explicit opt-out ----
// The package claims lint (absent) and e2e, in that order; the repo's unclaimed `test` tops up
// after them. Narrowest-declared order wins, and nothing is lost.
check("a package opts out of a repo gate by declaring it absent, not by omission",
  resolveGate(cfg, "platform", "ui").steps.map((s) => `${s.name}:${s.status}`),
  ["lint:absent", "e2e:present", "test:present"]);
check("opting out does not drop the repo's other gates",
  resolveGate(cfg, "platform", "ui").steps.some((s) => s.name === "test" && s.status === "present"), true);
check("a package-only step is appended", names(resolveGate(cfg, "platform", "ui")).includes("e2e"), true);

// ---- unknown package falls back to the repo ----
check("unknown package name falls back to the repo's steps",
  names(resolveGate(cfg, "platform", "nope")), ["test", "lint"]);

// ---- fallback when the block is absent entirely ----
const noGates = { pipeline: { gates: { ambiguousRequirements: "assume-and-log" } } };
check("no verify block -> fallback flagged", resolveGate(noGates, "api").fallback, true);
check("no verify block -> no steps invented", resolveGate(noGates, "api").steps, []);
check("empty config -> fallback flagged", resolveGate({}, "api").fallback, true);
check("the ambiguousRequirements sibling is never mistaken for a step list",
  resolveGate(noGates, "api").steps.length, 0);

// ---- coverage holes + environment dependence ----
check("absent steps become Findings lines",
  coverageHoles(resolveGate(cfg, "api").steps, "api").length, 1);
check("the Findings line names the gate and says it is not counted green",
  /no `typecheck` gate in `api`.*not counted green/.test(coverageHoles(resolveGate(cfg, "api").steps, "api")[0]), true);
check("a package's absent gate is reported against the package path",
  /`platform\/ui`/.test(coverageHoles(resolveGate(cfg, "platform", "ui").steps, "platform", "ui")[0]), true);
check("present steps never produce a coverage hole",
  coverageHoles(resolveGate(cfg, "platform", "worker").steps, "platform", "worker"), []);
check("environment-dependent steps are identifiable for failure diagnosis",
  environmentDependent(resolveGate(cfg, "api").steps).map((s) => s.name), ["test"]);
check("a replaced step drops the broader step's environment dependence",
  environmentDependent(resolveGate(cfg, "platform", "worker").steps), []);

console.log(`\n${n - fails}/${n} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
