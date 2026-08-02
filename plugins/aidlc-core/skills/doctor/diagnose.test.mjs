// Tests for diagnose.mjs. Run: `node diagnose.test.mjs` (sibling script) or
// `node diagnose.test.mjs <path-to-diagnose.mjs>`.
//
// Every case builds a real workspace on disk and asserts the check FIRES. A doctor is
// only worth the failures it detects, and the failure mode of a diagnostic that quietly
// returns "all ok" is indistinguishable from a healthy workspace — which is the same
// silent-pass problem the rest of this repo keeps fixing.
import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = process.argv[2] || join(HERE, "diagnose.mjs");
const PLUGIN_ROOT = join(HERE, "..", "..");

let fails = 0;
let n = 0;
const tmps = [];

/** Build a workspace: {config?, settings?, localSettings?, gitignore?, files?, dirs?} */
function workspace(spec = {}) {
  const root = mkdtempSync(join(tmpdir(), "doctor-"));
  tmps.push(root);
  mkdirSync(join(root, ".claude"), { recursive: true });
  const write = (rel, content) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), typeof content === "string" ? content : JSON.stringify(content, null, 2));
  };
  if (spec.config !== undefined) write(".claude/aidlc.config.json", spec.config);
  if (spec.settings !== undefined) write(".claude/settings.json", spec.settings);
  if (spec.localSettings !== undefined) write(".claude/settings.local.json", spec.localSettings);
  if (spec.gitignore !== undefined) write(".gitignore", spec.gitignore);
  for (const [rel, content] of Object.entries(spec.files ?? {})) write(rel, content);
  for (const d of spec.dirs ?? []) mkdirSync(join(root, d), { recursive: true });
  return root;
}

function diagnose(root) {
  const home = mkdtempSync(join(tmpdir(), "doctor-home-"));
  tmps.push(home);
  const out = execFileSync("node", [SCRIPT, root, "--plugin-root", PLUGIN_ROOT, "--home", home, "--json"], { encoding: "utf8" });
  return JSON.parse(out);
}

/** Assert the check whose id starts with `id` has `status`. */
function check(label, root, id, status) {
  n++;
  let got;
  try {
    const r = diagnose(root);
    const found = r.checks.filter((c) => c.id === id || c.id.startsWith(id + "-"));
    got = found.length ? found.map((c) => c.status) : ["<absent>"];
  } catch (e) {
    got = [`<threw: ${e.message.split("\n")[0]}>`];
  }
  const ok = got.includes(status);
  if (ok) console.log(`ok    ${label}`);
  else {
    fails++;
    console.log(`FAIL  ${label} — expected ${id}=${status}, got ${got.join(",")}`);
  }
}

const BASE_CONFIG = { project: { key: "PROJ", name: "P" }, workItems: { source: "markdown" } };
const GOOD_SETTINGS = { enabledPlugins: { "aidlc@bee-logical": true }, extraKnownMarketplaces: { "bee-logical": {} }, permissions: { allow: [], deny: [], ask: [] } };

// --- Config ---------------------------------------------------------------------------
check("missing config fails", workspace({}), "config", "fail");
check("valid config passes", workspace({ config: BASE_CONFIG }), "config", "ok");
check("malformed config fails", workspace({ config: "{ not json" }), "config", "fail");
check("config missing workItems fails", workspace({ config: { project: { key: "P", name: "P" } } }), "config-workItems", "fail");
check("no aidlcVersion warns", workspace({ config: BASE_CONFIG }), "config-version", "warn");
check(
  "aidlcVersion behind the plugin warns",
  workspace({ config: { ...BASE_CONFIG, aidlcVersion: "0.1.0" } }),
  "config-version",
  "warn",
);
check("no verify gate warns", workspace({ config: BASE_CONFIG }), "gate", "warn");
check(
  "a declared gate passes",
  workspace({ config: { ...BASE_CONFIG, pipeline: { gates: { verify: { steps: [] } } } } }),
  "gate",
  "ok",
);
check(
  "an unrecognised envFileAccess value fails",
  workspace({ config: { ...BASE_CONFIG, pipeline: { envFileAccess: "allow" } } }),
  "env-switch",
  "fail",
);
check(
  "shared mode on the markdown adapter warns",
  workspace({ config: { ...BASE_CONFIG, team: { mode: "shared" } } }),
  "markdown-shared",
  "warn",
);

// --- Settings (F49) --------------------------------------------------------------------
check(
  "a // comment in settings fails",
  workspace({ config: BASE_CONFIG, settings: '{\n  // "a": 1\n  "permissions": {}\n}' }),
  "settings-.claude/settings.json",
  "fail",
);
check(
  "unparseable settings fails",
  workspace({ config: BASE_CONFIG, settings: "{oops}" }),
  "settings-.claude/settings.json",
  "fail",
);
check("valid settings passes", workspace({ config: BASE_CONFIG, settings: GOOD_SETTINGS }), "settings-.claude/settings.json", "ok");

// --- Plugin enablement (F42) --------------------------------------------------------------
check(
  "no aidlc in enabledPlugins fails",
  workspace({ config: BASE_CONFIG, settings: { permissions: {} } }),
  "plugin-enabled",
  "fail",
);
check("aidlc enabled with a known marketplace passes", workspace({ config: BASE_CONFIG, settings: GOOD_SETTINGS }), "plugin-enabled", "ok");
check(
  "enabled but unknown marketplace warns",
  workspace({ config: BASE_CONFIG, settings: { enabledPlugins: { "aidlc@bee-logical": true } } }),
  "plugin-enabled",
  "warn",
);
check(
  "an explicitly disabled plugin does not count as enabled",
  workspace({ config: BASE_CONFIG, settings: { enabledPlugins: { "aidlc@bee-logical": false } } }),
  "plugin-enabled",
  "fail",
);

// --- Tracker MCP plugin (0.49 split) ------------------------------------------------------------
// Asymmetric on purpose: Jira has no CLI fallback, ADO does.
const withPlugins = (...names) => ({
  enabledPlugins: Object.fromEntries(names.map((n) => [`${n}@bee-logical`, true])),
  extraKnownMarketplaces: { "bee-logical": {} },
  permissions: { allow: [], deny: [], ask: [] },
});
const src = (s) => ({ ...BASE_CONFIG, workItems: { source: s } });
check(
  "jira without its plugin FAILS — the adapter has no fallback",
  workspace({ config: src("jira"), settings: withPlugins("aidlc") }),
  "tracker-plugin",
  "fail",
);
check(
  "jira with its plugin passes",
  workspace({ config: src("jira"), settings: withPlugins("aidlc", "aidlc-tracker-jira") }),
  "tracker-plugin",
  "ok",
);
check(
  "ado without its plugin only WARNS — the az tier covers it",
  workspace({ config: src("ado"), settings: withPlugins("aidlc") }),
  "tracker-plugin",
  "warn",
);
check(
  "ado with its plugin passes",
  workspace({ config: src("ado"), settings: withPlugins("aidlc", "aidlc-tracker-ado") }),
  "tracker-plugin",
  "ok",
);
check(
  "markdown needs no tracker plugin at all",
  workspace({ config: src("markdown"), settings: withPlugins("aidlc") }),
  "tracker-plugin",
  "<absent>",
);
check(
  "the wrong tracker plugin does not satisfy the check",
  workspace({ config: src("jira"), settings: withPlugins("aidlc", "aidlc-tracker-ado") }),
  "tracker-plugin",
  "fail",
);
check(
  "an explicitly disabled tracker plugin does not count",
  workspace({
    config: src("jira"),
    settings: { ...withPlugins("aidlc"), enabledPlugins: { "aidlc@bee-logical": true, "aidlc-tracker-jira@bee-logical": false } },
  }),
  "tracker-plugin",
  "fail",
);

// --- Permission rules (F44/F45/F48) ---------------------------------------------------------
check(
  "a Write(path) rule fails",
  workspace({ config: BASE_CONFIG, settings: { ...GOOD_SETTINGS, permissions: { deny: ["Write(.claude/settings.json)"] } } }),
  "rules-.claude/settings.json",
  "fail",
);
check(
  "a `:*`-after-glob rule fails",
  workspace({ config: BASE_CONFIG, settings: { ...GOOD_SETTINGS, permissions: { allow: ["Bash(git -C * add:*)"] } } }),
  "rules-.claude/settings.json",
  "fail",
);
check("clean rules pass", workspace({ config: BASE_CONFIG, settings: GOOD_SETTINGS }), "rules-.claude/settings.json", "ok");

// --- Poly: git -C coverage (F43) ---------------------------------------------------------
const polyCfg = (extra = {}) => ({
  ...BASE_CONFIG,
  workspace: { layout: "poly", root: "." },
  repos: [{ name: "api", path: "api" }],
  ...extra,
});
check(
  "poly with no `git -C` allow rule fails",
  workspace({ config: polyCfg(), settings: GOOD_SETTINGS, gitignore: "api\n", dirs: ["api/.git"] }),
  "poly-git-c",
  "fail",
);
check(
  "poly with `git -C` rules passes",
  workspace({
    config: polyCfg(),
    settings: { ...GOOD_SETTINGS, permissions: { allow: ["Bash(git -C * status*)"] } },
    gitignore: "api\n",
    dirs: ["api/.git"],
  }),
  "poly-git-c",
  "ok",
);
check("mono does not run the poly check", workspace({ config: BASE_CONFIG, settings: GOOD_SETTINGS }), "poly-git-c", "<absent>");

// --- Repos resolve --------------------------------------------------------------------------
check(
  "a declared repo that does not exist fails",
  workspace({ config: polyCfg(), settings: GOOD_SETTINGS, gitignore: "api\n" }),
  "repo-api",
  "fail",
);
check(
  "a declared path that is not a git repo warns",
  workspace({ config: polyCfg(), settings: GOOD_SETTINGS, gitignore: "api\n", dirs: ["api"] }),
  "repo-api",
  "warn",
);
check(
  "a real repo passes",
  workspace({ config: polyCfg(), settings: GOOD_SETTINGS, gitignore: "api\n", dirs: ["api/.git"] }),
  "repo-api",
  "ok",
);

// --- Control-plane .gitignore (the gitlink trap) ----------------------------------------------
check(
  "an unignored product repo fails",
  workspace({ config: polyCfg(), settings: GOOD_SETTINGS, gitignore: "node_modules\n", dirs: ["api/.git"] }),
  "gitignore-repos",
  "fail",
);
check(
  "an ignored product repo passes",
  workspace({ config: polyCfg(), settings: GOOD_SETTINGS, gitignore: "node_modules\napi/\n", dirs: ["api/.git"] }),
  "gitignore-repos",
  "ok",
);
check(
  "no .gitignore at all is caught",
  workspace({ config: polyCfg(), settings: GOOD_SETTINGS, dirs: ["api/.git"] }),
  "gitignore-repos",
  "fail",
);

// --- Run files -------------------------------------------------------------------------------
const RUN = (phase) => `---\nitem: PROJ-1\nphase: ${phase}\nbranch: feature/PROJ-1-x\n---\n## Log\n`;
check(
  "a valid run file passes",
  workspace({ config: BASE_CONFIG, settings: GOOD_SETTINGS, files: { ".aidlc/runs/PROJ-1.md": RUN("implement") } }),
  "run-files",
  "ok",
);
check(
  "a blocked run warns",
  workspace({ config: BASE_CONFIG, settings: GOOD_SETTINGS, files: { ".aidlc/runs/PROJ-1.md": RUN("blocked") } }),
  "run-files",
  "warn",
);
check(
  "an invalid phase fails",
  workspace({ config: BASE_CONFIG, settings: GOOD_SETTINGS, files: { ".aidlc/runs/PROJ-1.md": RUN("wat") } }),
  "run-files",
  "fail",
);
check(
  "a run file with no frontmatter fails",
  workspace({ config: BASE_CONFIG, settings: GOOD_SETTINGS, files: { ".aidlc/runs/PROJ-1.md": "no frontmatter here" } }),
  "run-files",
  "fail",
);
check(
  "a poly per-repo run file is found",
  workspace({
    config: polyCfg(),
    settings: GOOD_SETTINGS,
    gitignore: "api/\n",
    dirs: ["api/.git"],
    files: { "api/.aidlc/runs/PROJ-2.md": RUN("blocked") },
  }),
  "run-files",
  "warn",
);

// --- Control-plane state committed (found by dogfooding a live workspace) -----------------
// A real 34-wave `.aidlc/plan.md` had never been committed: not ignored, simply never added,
// because `replan` §6 commits it only in SHARED mode and nothing commits control-plane state
// in solo. Run files ride into their feature branch; these files have no committer.
const PLAN_MD = "---\nwaves: 3\n---\n";
{
  // Not a repo of its OWN → skip, never a false warning. (This developer's home directory is
  // itself a git repo, so "no repo anywhere" is not even reachable here — and a project nested
  // in an unrelated parent repo is the common shape this guards.)
  const w = workspace({ config: BASE_CONFIG, settings: GOOD_SETTINGS, files: { ".aidlc/plan.md": PLAN_MD } });
  check("a workspace that is not its own git repo skips", w, "cp-committed", "skip");
}
{
  // A real repo with an uncommitted plan → warn.
  const w = workspace({ config: BASE_CONFIG, settings: GOOD_SETTINGS, files: { ".aidlc/plan.md": PLAN_MD } });
  try {
    execSync("git init -q && git config user.email t@t.co && git config user.name t && git add .claude && git commit -qm init", { cwd: w, stdio: "ignore" });
    check("an uncommitted plan.md warns", w, "cp-committed", "warn");
    execSync("git add -A && git commit -qm plan", { cwd: w, stdio: "ignore" });
    check("once committed it passes", w, "cp-committed", "ok");
  } catch {
    console.log("skip  git fixture unavailable");
  }
}
{
  const w = workspace({ config: BASE_CONFIG, settings: GOOD_SETTINGS });
  check("no control-plane state files → check is absent", w, "cp-committed", "<absent>");
}

// --- Hooks + runtime --------------------------------------------------------------------------
check("hook scripts resolve against the real plugin", workspace({ config: BASE_CONFIG }), "hooks", "ok");
check("node version reported", workspace({}), "node", "ok");

// --- Robustness: never throw -------------------------------------------------------------------
n++;
try {
  const r = diagnose(workspace({ config: BASE_CONFIG, settings: { permissions: { allow: "not-an-array" } } }));
  console.log(r.checks.length > 0 ? "ok    a malformed permissions shape degrades instead of throwing" : "FAIL  no checks returned");
  if (!r.checks.length) fails++;
} catch (e) {
  fails++;
  console.log(`FAIL  threw on a malformed permissions shape: ${e.message.split("\n")[0]}`);
}

for (const t of tmps) rmSync(t, { recursive: true, force: true });
console.log(`\n${n - fails}/${n} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
