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
import { join, dirname, resolve, relative, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { lintPermissionRules, lintSettingsText } from "./lint-rules.mjs";

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
