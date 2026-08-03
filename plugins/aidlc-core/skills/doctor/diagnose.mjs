#!/usr/bin/env node
// Deterministic environment diagnosis for an AIDLC workspace.
//
//   node <plugin>/skills/doctor/diagnose.mjs [workspaceRoot] [--plugin-root <dir>] [--json]
//
// Why a script and not a checklist in the skill: every finding here is a FILE FACT with
// exactly one right answer, and the class of bug it catches is the one that produces no
// error message. Five of the eight most recent 🔴 findings were environment faults that
// a file read would have caught before the run started:
//
//   F42  the aidlc plugin was not enabled for the launch cwd → `Unknown command:
//        /aidlc:run`, at rc=0, so the failure read as success
//   F43  poly runs reach git as `git -C <path> …`, which matched no allow rule → the
//        first git call of every poly item blocked on a permission prompt
//   F45  the rules added for F43 matched nothing, allow and deny alike
//   F49  a `//` comment left settings.json unparseable → every plugin silently
//        disabled while /plugin still listed them as installed
//   F6   the control-plane branch was `master` while every config said `main`
//
// None of those announce themselves. All of them are visible in a file.
//
// This half is deterministic and testable. The LIVE half — tracker reachability, gh/az
// auth, MCP tool names, required-check policy, whether the gate commands actually run —
// needs tools and a session, so it lives in SKILL.md and is reported alongside this
// output. Never throws: a diagnosis that crashes is worse than one that says "unknown".
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, dirname, resolve, relative, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { lintPermissionRules, lintSettingsText } from "./lint-rules.mjs";
import { list, stale } from "../facts/facts.mjs";

// `--plugin-root` and `--home` take a value; everything else is a bare flag. `--home`
// exists so the suite can run against a fixture home instead of the real one — user-scope
// settings genuinely participate in the diagnosis (F42: enablement may live there), so a
// test that could not control them would be reading the developer's own machine.
const VALUE_FLAGS = new Set(["--plugin-root", "--home"]);
const rawArgv = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < rawArgv.length; i++) {
  const a = rawArgv[i];
  if (VALUE_FLAGS.has(a)) flags[a] = rawArgv[++i];
  else if (a.startsWith("--")) flags[a] = true;
  else positional.push(a);
}
const asJson = flags["--json"] === true;
const pluginRoot = flags["--plugin-root"] ?? join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const HOME = flags["--home"] ?? homedir();
const ROOT = resolve(positional[0] || process.cwd());

const checks = [];
/** status: ok | warn | fail | skip */
const add = (status, id, title, detail, remedy) => checks.push({ status, id, title, detail, remedy });
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const tryJson = (p) => {
  try {
    return readJson(p);
  } catch {
    return null;
  }
};

// --- 1. Runtime ------------------------------------------------------------------------
{
  const major = Number(process.versions.node.split(".")[0]);
  if (major >= 18) add("ok", "node", "Node runtime", `v${process.versions.node}`);
  else
    add("fail", "node", "Node runtime", `v${process.versions.node} is below the minimum`, "Install Node 18 or newer — the hooks are ES modules and use modern fs APIs.");
}

// --- 2. Config -------------------------------------------------------------------------
const cfgPath = join(ROOT, ".claude", "aidlc.config.json");
let cfg = null;
if (!existsSync(cfgPath)) {
  add(
    "fail",
    "config",
    "aidlc.config.json",
    `not found at ${cfgPath}`,
    "Run /aidlc:init. On a workspace that already has code, choose \"there's existing code — scan it\" so the stack and gate come from /aidlc:adopt rather than from memory.",
  );
} else {
  const raw = readFileSync(cfgPath, "utf8");
  try {
    cfg = JSON.parse(raw);
    add("ok", "config", "aidlc.config.json", `parses · project ${cfg.project?.key ?? "?"} · ${cfg.repos?.length ? "poly" : "mono"}`);
  } catch (e) {
    add("fail", "config", "aidlc.config.json", `does not parse: ${e.message}`, "Fix the JSON. Every /aidlc:* command reads this first and stops without it.");
  }
}

if (cfg) {
  for (const key of ["project", "workItems"]) {
    if (!cfg[key]) add("fail", `config-${key}`, `config.${key}`, "required by the schema but absent", "Re-run /aidlc:init, or add the block by hand.");
  }
  const pluginVersion = tryJson(join(pluginRoot, ".claude-plugin", "plugin.json"))?.version ?? null;
  if (!cfg.aidlcVersion)
    add(
      "warn",
      "config-version",
      "config provenance",
      "no `aidlcVersion` — this config predates version stamping",
      "Cosmetic today, but it is the input to upgrade detection: without it, a reader cannot tell which keys it may trust.",
    );
  else if (pluginVersion && cfg.aidlcVersion !== pluginVersion)
    add(
      "warn",
      "config-version",
      "config provenance",
      `written by aidlc@${cfg.aidlcVersion}; installed plugin is ${pluginVersion}`,
      "Newer plugins read blocks an older config may not have. Re-run /aidlc:adopt-apply to upgrade the shape behind a shown diff.",
    );
  else add("ok", "config-version", "config provenance", `written by aidlc@${cfg.aidlcVersion}`);

  // The gate is what every tier verifies against. Absent, verification silently falls
  // back to guessing at CLAUDE.md — the exact thing /aidlc:adopt exists to prevent.
  if (!cfg.pipeline?.gates?.verify)
    add(
      "warn",
      "gate",
      "verification gate",
      "no `pipeline.gates.verify` — the pipeline will fall back to the CLAUDE.md Commands block",
      "Run /aidlc:adopt then /aidlc:adopt-apply to record the project's real gate commands per repo and package.",
    );
  else add("ok", "gate", "verification gate", "declared in pipeline.gates.verify");

  const access = cfg.pipeline?.envFileAccess;
  if (access !== undefined && access !== "deny" && access !== "ask")
    add(
      "fail",
      "env-switch",
      "env-file access switch",
      `pipeline.envFileAccess is ${JSON.stringify(access)}`,
      'Only "deny" (default) and "ask" are recognised. Anything else fails closed as "deny" — which is safe, but not what the value says.',
    );

  if (cfg.team?.mode === "shared" && cfg.workItems?.source === "markdown")
    add(
      "warn",
      "markdown-shared",
      "tracker vs team mode",
      "`team.mode: shared` with `workItems.source: markdown`",
      "The backlog is then git-tracked files several people groom concurrently, and query() returns whatever branch the caller stands on. Workable for a small co-located team on one branch; Jira or ADO is the real answer.",
    );

  // --- Tracker schema maps (F7/F20 for states, the same class of bug for FIELDS) ----------
  // statusMap/fieldMap are how a probed board schema survives into the next session, which
  // makes a typo'd key silent BY CONSTRUCTION: the adapter looks up `in_progress`, the map
  // says `in-progress`, the lookup misses, the adapter falls back to its own probe — and the
  // override a human deliberately wrote is never applied. Nothing errors and the board still
  // moves, so the config reads as honoured. Same for a display name where a field id belongs:
  // "Story Points" is not a handle either tracker accepts.
  const trackerSource = cfg.workItems?.source;
  if (trackerSource === "jira" || trackerSource === "ado") {
    const CANONICAL_STATUS = ["todo", "in_progress", "in_review", "done", "blocked", "superseded"];
    // The canonical WorkItem keys a map may legitimately name (work-items → schema).
    const CANONICAL_FIELD = [
      "type", "title", "description", "acceptanceCriteria", "status", "priority", "estimate",
      "parent", "repo", "package", "dependsOn", "labels", "assignee",
    ];
    const idWord = trackerSource === "ado" ? "an ADO reference name (`Microsoft.VSTS.*`, `Custom.*`)" : "a Jira field id (`customfield_10101`, `parent`)";

    for (const [key, canonical] of [["statusMap", CANONICAL_STATUS], ["fieldMap", CANONICAL_FIELD]]) {
      const map = cfg.workItems?.[trackerSource]?.[key];
      const id = `tracker-${key === "statusMap" ? "status" : "field"}-map`;
      const title = `tracker ${trackerSource} ${key}`;
      if (map === undefined || map === null) {
        // Absent is not a fault: /aidlc:init leaves it out when the board was unreachable,
        // and the adapter probes on first use. Saying so beats warning about a non-problem.
        add("ok", id, title, "absent — the adapter probes the board and self-heals on first use");
        continue;
      }
      if (typeof map !== "object" || Array.isArray(map)) {
        add("warn", id, title, `is ${Array.isArray(map) ? "an array" : typeof map}, not an object`, `Expected canonical→name pairs, or per-type objects of them. See docs/aidlc.config.schema.json → workItems.${trackerSource}.${key}.`);
        continue;
      }

      const topKeys = Object.keys(map);
      const canonicalTop = topKeys.filter((k) => canonical.includes(k));
      const shape = !topKeys.length ? "empty" : canonicalTop.length === topKeys.length ? "flat" : canonicalTop.length ? "mixed" : "per-type";
      const unknown = [];
      const badValue = [];
      const displayName = [];
      // Leaves to lint: the flat map itself, or each per-type object inside it. A top-level
      // key that is neither canonical nor an object is the case that hides best — a flat map
      // with a misspelled canonical key (`in-progress`) has no canonical keys at all, so it
      // classifies as per-type and would otherwise be walked as if it held type objects.
      const leaves = [];
      if (shape === "per-type")
        for (const [type, v] of Object.entries(map)) {
          if (v && typeof v === "object" && !Array.isArray(v)) leaves.push([type, v]);
          else unknown.push(type);
        }
      else leaves.push(["", map]);
      for (const [type, obj] of leaves) {
        for (const [k, v] of Object.entries(obj)) {
          const where = type ? `${type}.${k}` : k;
          if (!canonical.includes(k)) unknown.push(where);
          else if (v !== null && (typeof v !== "string" || !v.trim())) badValue.push(where);
          else if (key === "fieldMap" && typeof v === "string" && /\s/.test(v)) displayName.push(`${where} = ${JSON.stringify(v)}`);
        }
      }

      const problems = [];
      if (shape === "mixed")
        problems.push(`mixes both shapes — ${canonicalTop.join(", ")} sit beside type names. Pick one: canonical keys at the top level is the flat form, type names is the per-type form`);
      if (unknown.length)
        problems.push(`unrecognized key(s): ${unknown.join(", ")} — legal keys are ${canonical.join(" · ")}`);
      if (badValue.length) problems.push(`value(s) that are neither a string nor null: ${badValue.join(", ")}`);
      if (displayName.length)
        problems.push(`display name(s) where an id belongs: ${displayName.join(", ")}`);

      if (problems.length)
        add(
          "warn",
          id,
          title,
          problems.join("; "),
          `An entry the adapter cannot match is silently ignored — it re-probes and uses the board's own value, so a typo here looks like a config that was honoured. ` +
            (displayName.length ? `Values must be ${idWord}: display names are renameable, localized and non-unique. ` : "") +
            `Fix the keys, or empty the map and let the adapter re-probe.`,
        );
      else if (shape === "empty")
        add("ok", id, title, "empty — the adapter probes the board and self-heals on first use");
      else if (key === "statusMap" && shape === "flat" && trackerSource === "ado") {
        // A flat map is the legacy SHAPE, and on a stock board it is also a CORRECT one:
        // `Active` means Active on every Agile type, so warning about the shape alone
        // fires on every ADO project scaffolded before per-type maps existed — noise that
        // teaches people to ignore this command, against doctor's own signal-to-noise
        // rule. What actually predicts F20 is a CUSTOMIZED process: names invented for
        // one board ("Development in Progress", "Ready for QA") are scoped per
        // work-item-type, so one name per canonical status cannot fit every type. Stock
        // names are the four out-of-box processes' states — Basic, Agile, Scrum, CMMI.
        const STOCK_STATES = new Set([
          "to do", "doing", "done", // Basic
          "new", "active", "resolved", "closed", "removed", // Agile
          "approved", "committed", "in progress", // Scrum
          "proposed", // CMMI
        ]);
        const invented = Object.values(map).filter((v) => typeof v === "string" && !STOCK_STATES.has(v.trim().toLowerCase()));
        if (invented.length)
          add(
            "warn",
            id,
            title,
            `flat (canonical→state), and its states are not from any out-of-box process: ${invented.map((v) => JSON.stringify(v)).join(", ")}`,
            "A customized process names its states per work-item-type, so one name per canonical status cannot fit every type — an Epic's working state commonly differs from a Story's, which is the transition F20 sent to a state the Epic does not have. The adapter treats a flat map as a hint and re-probes per type; a per-type map `{ \"<Type>\": { \"<canonical>\": \"<state>\" } }` is what it will trust. Nothing is broken meanwhile: the probe corrects it on the next run.",
          );
        else add("ok", id, title, `flat · ${Object.keys(map).length} entries · out-of-box state names, which are uniform enough for a flat map`);
      }
      else {
        const entries = leaves.reduce((n, [, o]) => n + Object.keys(o).length, 0);
        add("ok", id, title, `${shape} · ${entries} entr${entries === 1 ? "y" : "ies"}`);
      }
    }
  }
}

// --- 3. Settings files (F49) --------------------------------------------------------------
const USER_SETTINGS = resolve(HOME, ".claude", "settings.json");
// Compared by RESOLVED PATH, not by prefix. A `startsWith(homedir())` test labels every
// project living under the user's home directory — `~/dev/thing`, which is most of them
// — as the user-scope file, so a project-scope problem gets reported against
// `~/.claude/settings.json` and the remediation points at the wrong file entirely.
const settingsFiles = [
  ...new Set(
    [join(ROOT, ".claude", "settings.json"), join(ROOT, ".claude", "settings.local.json"), USER_SETTINGS]
      .map((p) => resolve(p))
      .filter(existsSync),
  ),
];

if (!settingsFiles.length)
  add("warn", "settings", "settings.json", "no settings file found at project or user scope", "Run /aidlc:init to scaffold the permission posture.");

const allSettings = [];
for (const f of settingsFiles) {
  const label = f === USER_SETTINGS ? "~/.claude/settings.json" : relative(ROOT, f).replace(/\\/g, "/");
  const raw = readFileSync(f, "utf8");
  const textFindings = lintSettingsText(raw);
  if (textFindings.length) {
    for (const t of textFindings)
      add("fail", `settings-${label}`, `settings: ${label}`, t.message, "Delete the offending line outright. After ANY settings edit, re-read the file and JSON.parse it to prove it still parses.");
    continue;
  }
  const parsed = JSON.parse(raw);
  allSettings.push({ label, parsed });
  add("ok", `settings-${label}`, `settings: ${label}`, "parses as strict JSON");
}

// --- 4. Plugin enablement (F42) ------------------------------------------------------------
{
  const enabled = allSettings.flatMap((s) => Object.entries(s.parsed.enabledPlugins ?? {}).filter(([, v]) => v !== false).map(([k]) => k));
  const marketplaces = allSettings.flatMap((s) => Object.keys(s.parsed.extraKnownMarketplaces ?? {}));
  const aidlc = enabled.filter((e) => /^aidlc(-[a-z-]+)?@/.test(e));
  if (!allSettings.length) {
    add("skip", "plugin-enabled", "plugin enablement", "no readable settings file to check");
  } else if (!aidlc.length) {
    add(
      "fail",
      "plugin-enabled",
      "plugin enablement",
      "no `aidlc@<marketplace>` entry in enabledPlugins at project or user scope",
      "This is F42: a session here has no /aidlc:* commands, and a headless run exits rc=0 with `Unknown command: /aidlc:run` — which reads as success to anything checking exit codes. Run /plugin install aidlc@<marketplace>.",
    );
  } else {
    const mk = aidlc[0].split("@")[1];
    const known = marketplaces.includes(mk);
    add(
      known ? "ok" : "warn",
      "plugin-enabled",
      "plugin enablement",
      `${aidlc.join(", ")}${known ? "" : ` — but marketplace '${mk}' is not in extraKnownMarketplaces`}`,
      known ? undefined : "Enablement without a known marketplace resolves only if the plugin is installed locally. Run /plugin marketplace add <source>.",
    );
  }
}

// --- 4b. The tracker's MCP plugin ------------------------------------------------------------
// Core stopped shipping the Jira and ADO servers in 0.49: every workspace was starting three MCP
// servers, two of them useless for any given project, and the ADO one spawned
// `npx @azure-devops/mcp ""` for everyone who had never set ADO_MCP_ORG. The two adapters are NOT
// symmetric about this, and reporting them the same way would be wrong in one direction or the other:
//   jira — the Atlassian MCP is the ONLY path (wi-jira: "do not fall back to guessing"), so a
//          missing plugin is a hard FAIL and the tracker will not work at all.
//   ado  — tier 2 (`az boards`/`az rest`) covers every operation and is already what headless runs
//          use, so a missing plugin is a WARN: the project works, on a tier it was using anyway.
{
  const source = cfg?.workItems?.source;
  const need = source === "jira" ? "aidlc-tracker-jira" : source === "ado" ? "aidlc-tracker-ado" : null;
  if (need && allSettings.length) {
    const entries = allSettings.flatMap((s) => Object.entries(s.parsed.enabledPlugins ?? {}));
    const enabled = entries.filter(([, v]) => v !== false).map(([k]) => k.split("@")[0]);
    // INSTALLED-BUT-DISABLED is its own state and needs its own remedy. The tracker
    // plugins ship `defaultEnabled: false` so that merely adding the marketplace does not
    // start an MCP server nobody asked for — but that value also seeds the state on an
    // EXPLICIT `/plugin install`, so the plugin lands registered and switched off. Telling
    // someone to install a plugin they just installed is the least useful thing this
    // command could say.
    const installedOff = entries.some(([k, v]) => k.split("@")[0] === need && v === false);
    const have = enabled.includes(need);
    if (installedOff)
      add(
        source === "jira" ? "fail" : "warn",
        "tracker-plugin",
        `tracker plugin (${source})`,
        `${need} is INSTALLED but disabled (\`"${need}@…": false\` in enabledPlugins)`,
        "Installing it was not enough: these plugins ship defaultEnabled:false so adding the marketplace " +
          "does not start an MCP server for projects that cannot use it, and that also applies to an explicit " +
          "install. Toggle it on in /plugin, or set that value to true.",
      );
    else if (have) add("ok", "tracker-plugin", `tracker plugin (${source})`, `${need} is enabled`);
    else if (source === "jira")
      add(
        "fail",
        "tracker-plugin",
        "tracker plugin (jira)",
        "`workItems.source: \"jira\"` but `aidlc-tracker-jira` is not enabled",
        "The Jira adapter has no CLI fallback — the Atlassian MCP is the only path, so every tracker " +
          "operation will fail. Run /plugin install aidlc-tracker-jira@<marketplace>, then authenticate at /mcp.",
      );
    else
      add(
        "warn",
        "tracker-plugin",
        "tracker plugin (ado)",
        "`aidlc-tracker-ado` is not enabled — the adapter will use its `az boards`/`az rest` tier",
        "That tier covers every operation and is what headless runs use anyway, so this is not broken. " +
          "Install aidlc-tracker-ado@<marketplace> for the richer interactive tier (needs ADO_MCP_ORG set " +
          "in the shell that launches Claude Code).",
      );
  }
}

// --- 5. Permission rules (F44/F45/F48) ------------------------------------------------------
for (const { label, parsed } of allSettings) {
  const findings = lintPermissionRules(parsed.permissions ?? {});
  const errors = findings.filter((f) => f.severity === "error");
  const warns = findings.filter((f) => f.severity === "warning");
  if (!findings.length) {
    add("ok", `rules-${label}`, `permission rules: ${label}`, "no known-broken rule shapes");
    continue;
  }
  for (const f of errors)
    add("fail", `rules-${label}-${f.code}`, `permission rules: ${label}`, `[${f.list}] ${f.message}`, "This rule enforces nothing. On a deny list that means a protection you believe you have is absent.");
  for (const f of warns) add("warn", `rules-${label}-${f.code}`, `permission rules: ${label}`, `[${f.list}] ${f.message}`);
}

// --- 6. Poly: git -C coverage (F43) ------------------------------------------------------
if (cfg?.repos?.length) {
  const allow = allSettings.flatMap((s) => s.parsed.permissions?.allow ?? []);
  const hasDashC = allow.some((r) => /^Bash\(git -C /.test(r));
  if (!hasDashC)
    add(
      "fail",
      "poly-git-c",
      "poly git permissions",
      "`repos[]` is declared but no `Bash(git -C …)` allow rule exists",
      "This is F43. In poly the session cwd stays at the control plane and every git call is `git -C <repo> …`, which bare-verb rules do not match — so the first git call of every item blocks on a permission prompt. Re-run /aidlc:init to stage the current template's rules.",
    );
  else add("ok", "poly-git-c", "poly git permissions", "`git -C` allow rules present");
}

// --- 7. Repos resolve --------------------------------------------------------------------
if (cfg?.repos?.length) {
  const base = cfg.workspace?.root ?? ".";
  for (const repo of cfg.repos) {
    if (!repo?.path) {
      add("fail", `repo-${repo?.name ?? "?"}`, `repo: ${repo?.name ?? "?"}`, "entry has no `path`");
      continue;
    }
    const abs = isAbsolute(repo.path) ? repo.path : resolve(ROOT, base, repo.path);
    if (!existsSync(abs))
      add("fail", `repo-${repo.name}`, `repo: ${repo.name}`, `declared path does not exist: ${abs}`, `Clone it, correct the path, or if it lives outside this workspace run /add-dir "${abs}" so the session can reach it.`);
    else if (!existsSync(join(abs, ".git")))
      add("warn", `repo-${repo.name}`, `repo: ${repo.name}`, `${abs} exists but is not a git repo`, "Branching, committing and PR creation all target this path. Run `git init` there or correct the entry.");
    else add("ok", `repo-${repo.name}`, `repo: ${repo.name}`, abs);
  }

  // The control plane must ignore every product repo BY PATH. An unignored nested repo
  // is staged by `git add -A` as a mode-160000 gitlink with no .gitmodules entry: it
  // clones as an empty directory and git reports no error. The guard hook blocks the
  // commit as a backstop, but the fix belongs here.
  const giPath = join(ROOT, ".gitignore");
  const gi = existsSync(giPath) ? readFileSync(giPath, "utf8") : "";
  const missing = cfg.repos
    .filter((r) => r?.path && !isAbsolute(r.path))
    .map((r) => r.path.replace(/\\/g, "/").replace(/\/+$/, ""))
    .filter((p) => !new RegExp(`^/?${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/?\\s*$`, "m").test(gi));
  if (missing.length)
    add(
      "fail",
      "gitignore-repos",
      "control-plane .gitignore",
      `product repo(s) not ignored: ${missing.join(", ")}`,
      "Add each to the `# AIDLC:REPOS` block. Unignored, `git add -A` stages them as gitlinks that clone as empty directories with no error.",
    );
  else add("ok", "gitignore-repos", "control-plane .gitignore", "every declared repo is ignored by path");
}

// --- 8. Hook scripts exist ----------------------------------------------------------------
{
  const hooksPath = join(pluginRoot, "hooks", "hooks.json");
  const hooks = tryJson(hooksPath);
  if (!hooks) add("skip", "hooks", "hook scripts", `could not read ${hooksPath}`);
  else {
    const missing = [];
    let count = 0;
    for (const matchers of Object.values(hooks.hooks ?? {}))
      for (const m of matchers ?? [])
        for (const h of m.hooks ?? [])
          for (const ref of String(h.command ?? "").matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^"'\s]+)/g)) {
            count++;
            if (!existsSync(join(pluginRoot, ref[1]))) missing.push(ref[1]);
          }
    if (missing.length)
      add("fail", "hooks", "hook scripts", `missing: ${missing.join(", ")}`, "The hook is registered but inert — it enforces nothing and reports nothing. Reinstall the plugin.");
    else add("ok", "hooks", "hook scripts", `all ${count} present`);
  }
}

// --- 9. Run files -------------------------------------------------------------------------
{
  const PHASES = new Set(["start", "requirements", "design", "implement", "verify", "pr", "docs", "done", "blocked", "review-pending"]);
  const dirs = [join(ROOT, ".aidlc", "runs")];
  for (const r of cfg?.repos ?? []) if (r?.path) dirs.push(resolve(ROOT, cfg.workspace?.root ?? ".", r.path, ".aidlc", "runs"));
  let total = 0;
  const bad = [];
  const blocked = [];
  for (const d of dirs.filter((x) => existsSync(x) && statSync(x).isDirectory())) {
    for (const f of readdirSync(d).filter((x) => x.endsWith(".md"))) {
      total++;
      const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(join(d, f), "utf8"));
      if (!m) {
        bad.push(`${f} (no frontmatter)`);
        continue;
      }
      const phase = /^phase:\s*(\S+)/m.exec(m[1])?.[1];
      if (!phase || !PHASES.has(phase)) bad.push(`${f} (phase: ${phase ?? "absent"})`);
      else if (phase === "blocked") blocked.push(f.replace(/\.md$/, ""));
    }
  }
  if (bad.length)
    add("fail", "run-files", "run files", `unreadable or invalid: ${bad.join(", ")}`, "Run state is the pipeline's single source of truth; a run file it cannot parse is a run it cannot resume.");
  else if (blocked.length) add("warn", "run-files", "run files", `${total} found · blocked: ${blocked.join(", ")}`, "A blocked run is waiting on a human. Read its `## Findings`, then /aidlc:run <ID>.");
  else add("ok", "run-files", "run files", `${total} found, all parse`);
}

// --- 10. Stale project facts ------------------------------------------------------------------
// A fact that has gone unverified for a quarter is not neutral: the pipeline reads these to decide
// whether a red gate is a regression or a missing container, so a wrong one sends a fix cycle
// chasing a database that moved months ago. Reported, never auto-deleted — only a human knows
// whether it stopped being true or just stopped being checked.
{
  const facts = list(ROOT);
  if (facts.length) {
    const old = stale(ROOT);
    if (old.length)
      add(
        "warn",
        "facts-stale",
        "project facts",
        `${facts.length} recorded · ${old.length} unverified for 90+ days (oldest: "${old[0].text}", ${old[0].ageDays}d)`,
        "Re-add a fact that is still true (that refreshes its date) or delete it. A stale fact is worse than a missing one — the pipeline acts on it.",
      );
    else add("ok", "facts-stale", "project facts", `${facts.length} recorded, all verified within 90 days`);
  }
}

// --- 11. Control-plane state that is not committed -----------------------------------------
// Found by dogfooding a real workspace: a 34-wave `.aidlc/plan.md` — hours of judgment about
// delivery order — had never been committed. Not ignored; simply never added, because
// `replan` §6 commits the plan only in SHARED mode, and in solo NOTHING commits control-plane
// state. Run files ride into their feature branch, so they are safe; the control plane's own
// files have no committer. Losing the machine loses the plan, the journal and the facts.
// Read-only here — this reports, it does not commit, because what belongs in a commit is the
// user's call.
{
  const tracked = ["plan.md", "journal.md", "facts.md", "extensions.json"]
    .map((f) => join(ROOT, ".aidlc", f))
    .filter(existsSync);
  if (tracked.length) {
    let dirty = null;
    let note = "could not read git status here";
    const git = (cmd) =>
      execSync(cmd, { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"], timeout: 5000, encoding: "utf8" });
    try {
      // The control plane must BE the repo, not merely sit inside one. Found the hard way:
      // this developer's entire home directory is a git repo, so `git status` succeeds in any
      // temp dir under it and would report the HOME repo's state as the workspace's. A
      // project nested in an unrelated parent repo is the same shape and far from rare.
      const top = resolve(git("git rev-parse --show-toplevel").trim());
      if (top !== ROOT) {
        note = `${ROOT} is not a git repo of its own (the enclosing repo is ${top})`;
      } else {
        const rel = tracked.map((f) => `"${relative(ROOT, f).replace(/\\/g, "/")}"`).join(" ");
        dirty = git(`git status --porcelain -- ${rel}`)
          .split("\n")
          .filter((l) => l.trim());
      }
    } catch {
      dirty = null; // git unavailable, or not a repo at all — say nothing rather than guess
    }
    if (dirty === null) add("skip", "cp-committed", "control-plane state", note);
    else if (!dirty.length) add("ok", "cp-committed", "control-plane state", `${tracked.length} file(s), all committed`);
    else
      add(
        "warn",
        "cp-committed",
        "control-plane state",
        `uncommitted: ${dirty.map((l) => l.slice(3)).join(", ")}`,
        "These are the workspace's durable memory — the wave plan, the journal, the facts, the extension registry. " +
          "Run files ride into their feature branch; these have no committer in solo mode, so an uncommitted plan lives on one machine only.",
      );
  }
}

// --- Output --------------------------------------------------------------------------------
const counts = checks.reduce((a, c) => ((a[c.status] = (a[c.status] ?? 0) + 1), a), {});
if (asJson) {
  process.stdout.write(JSON.stringify({ root: ROOT, pluginRoot, counts, checks }, null, 2));
} else {
  const icon = { ok: "  ok  ", fail: " FAIL ", warn: " warn ", skip: " skip " };
  for (const c of checks) {
    process.stdout.write(`[${icon[c.status]}] ${c.title} — ${c.detail}\n`);
    if (c.remedy && c.status !== "ok") process.stdout.write(`             → ${c.remedy}\n`);
  }
  process.stdout.write(
    `\n${counts.ok ?? 0} ok · ${counts.warn ?? 0} warning · ${counts.fail ?? 0} failing · ${counts.skip ?? 0} skipped\n`,
  );
}
// Exit code reports the diagnosis, it does not fail the command: doctor is a report.
process.exit(0);
