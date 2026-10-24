#!/usr/bin/env node
// The skeleton of a PR's "How to review this" section: the diff's files in the order a person should
// read them, with the risky ones called out.
//
//   node pr-guide.mjs <repoRoot> [--base <ref>] [--config <aidlc.config.json>] [--repo <name>] [--json]
//
// Human review is the one gate AIDLC never removes (architecture D6), and it is the slowest step in
// the whole pipeline: a reviewer opening a 30-file PR sees it alphabetically, starts on a lockfile, and
// spends the first ten minutes finding where the change actually is. The pipeline already knows —
// it planned the change. So the PR says where to start.
//
// This script does the deterministic half: group the changed files (logic, tests, migrations,
// contracts, config, docs, bookkeeping), order logic by size, and flag what touches a path the config
// marks as risky. The orchestrator adds the judgement half — one line on WHY each start-here file
// matters, and "try it" steps from the acceptance criteria.
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isMain as isEntry } from "../../hooks/scripts/lib/cli.mjs";

const GROUPS = [
  ["bookkeeping", /(^|\/)\.aidlc\//],
  ["lockfile", /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|poetry\.lock|Pipfile\.lock|Cargo\.lock|go\.sum|composer\.lock|Gemfile\.lock)$/i],
  ["migration", /(^|\/)(migrations?|alembic|db\/migrate)\/|\.sql$/i],
  ["test", /\.(test|spec)\.[a-z]+$|(^|\/)(tests?|__tests__|spec|e2e)\/|(^|\/)test_[^/]*\.py$|_test\.(go|py)$/i],
  ["docs", /\.(md|mdx|rst|adoc|txt)$|(^|\/)docs?\//i],
  ["config", /(^|\/)(\.github|\.azuredevops|\.husky)\/|(^|\/)(package\.json|pyproject\.toml|go\.mod|Cargo\.toml|pom\.xml|build\.gradle[^/]*|Dockerfile[^/]*|docker-compose[^/]*|tsconfig[^/]*\.json|\.[\w-]*rc(\.\w+)?|[\w.-]*\.config\.[a-z]+)$|\.(ya?ml|toml|ini)$/i],
];
const groupOf = (f) => (GROUPS.find(([, re]) => re.test(f)) || ["logic"])[0];

// The config's risky paths, as [{ label, re }].
function riskMatchers(config, repoName) {
  const repo = (config?.repos ?? []).find((r) => r?.name === repoName);
  const saas = { ...(config?.saas ?? {}), ...(repo?.saas ?? {}) };
  const globRe = (g) =>
    new RegExp(
      "^" +
        String(g)
          .replace(/\\/g, "/")
          .replace(/[.+^${}()|[\]]/g, "\\$&")
          .replace(/\*\*\/?/g, "\u0000")
          .replace(/\*/g, "[^/]*")
          .replace(/\?/g, "[^/]")
          .replace(/\u0000/g, ".*") +
        "$",
      "i",
    );
  const out = [];
  const add = (label, list) => {
    for (const g of list ?? []) {
      const p = typeof g === "string" ? g : g?.path;
      if (p) out.push({ label, re: globRe(p.endsWith("/") ? p + "**" : p) });
    }
  };
  add("auth", saas.authPaths);
  add("tenant isolation", saas.tenantIsolationPaths);
  add("API contract", saas.apiContracts);
  add("security-review path", config?.pipeline?.securityReviewPaths);
  return out;
}

export function guide(files, { config, repoName } = {}) {
  const risks = riskMatchers(config, repoName);
  const rows = files.map((f) => {
    const flags = risks.filter((r) => r.re.test(f.path)).map((r) => r.label);
    const group = groupOf(f.path);
    if (group === "migration") flags.push("migration");
    if (group === "lockfile") flags.push("dependency change");
    return { ...f, group, flags: [...new Set(flags)], churn: (f.added || 0) + (f.deleted || 0) };
  });
  const logic = rows.filter((r) => r.group === "logic").sort((a, b) => b.churn - a.churn || a.path.localeCompare(b.path));
  return {
    start: logic.slice(0, 3),
    rest: logic.slice(3),
    tests: rows.filter((r) => r.group === "test"),
    migrations: rows.filter((r) => r.group === "migration"),
    config: rows.filter((r) => r.group === "config" || r.group === "lockfile"),
    docs: rows.filter((r) => r.group === "docs"),
    bookkeeping: rows.filter((r) => r.group === "bookkeeping"),
    risky: rows.filter((r) => r.flags.length),
  };
}

const line = (r) => `- \`${r.path}\` (+${r.added ?? "?"}/−${r.deleted ?? "?"})${r.flags.length ? ` ⚠ ${r.flags.join(", ")}` : ""}`;

export function renderGuide(g) {
  const out = ["## How to review this PR", ""];
  if (g.start.length) {
    out.push("**Start here** — where the change lives:");
    for (const r of g.start) out.push(`${line(r)} — {{WHY}}`);
    out.push("");
  }
  if (g.risky.length) {
    out.push("**Look closely** — paths this project marks as risky:");
    for (const r of g.risky) out.push(line(r));
    out.push("");
  }
  const section = (title, rows) => {
    if (!rows.length) return;
    out.push(`**${title}:**`);
    for (const r of rows) out.push(line(r));
    out.push("");
  };
  section("Then", g.rest);
  section("Tests", g.tests);
  section("Migrations", g.migrations);
  section("Config and dependencies", g.config);
  section("Docs", g.docs);
  if (g.bookkeeping.length) out.push(`*Skip:* ${g.bookkeeping.length} AIDLC run-state file(s) under \`.aidlc/\`.`, "");
  out.push("**Try it:** {{STEPS — from the acceptance criteria: what to run or open, what to do, what you should see}}");
  return out.join("\n") + "\n";
}

function changedFiles(root, base) {
  const out = execFileSync("git", ["diff", "--numstat", "--no-renames", `${base}...HEAD`], { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString();
  return out
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => {
      const [a, d, ...p] = l.split("\t");
      return { path: p.join("\t").replace(/\\/g, "/"), added: a === "-" ? null : Number(a), deleted: d === "-" ? null : Number(d) };
    });
}

if (isEntry(import.meta.url)) {
  const argv = process.argv.slice(2);
  const flag = (n) => {
    const i = argv.indexOf(`--${n}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const root = argv[0] && !argv[0].startsWith("--") ? resolve(argv[0]) : null;
  if (!root || !existsSync(root)) {
    console.error("usage: node pr-guide.mjs <repoRoot> [--base <ref>] [--config <aidlc.config.json>] [--repo <name>] [--json]");
    process.exit(2);
  }
  let config = {};
  if (flag("config")) {
    try {
      config = JSON.parse(readFileSync(flag("config"), "utf8"));
    } catch {
      /* no config → no risk paths, still a useful ordering */
    }
  }
  let files;
  try {
    files = changedFiles(root, flag("base") || "origin/HEAD");
  } catch {
    console.error("pr-guide: cannot diff against the base — pass --base <ref>");
    process.exit(2);
  }
  const g = guide(files, { config, repoName: flag("repo") });
  if (argv.includes("--json")) console.log(JSON.stringify(g, null, 2));
  else process.stdout.write(renderGuide(g));
}
