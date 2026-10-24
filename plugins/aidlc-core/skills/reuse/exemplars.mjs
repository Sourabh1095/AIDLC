#!/usr/bin/env node
// Golden paths: how THIS project adds an endpoint, a page, a migration, a component, a job, a test.
//
//   node exemplars.mjs build <repoRoot> [--name <repo>] [--out <dir>]
//   node exemplars.mjs show  <repoRoot> <kind> [--name <repo>]
//
// The catalog (catalog.mjs) says WHAT exists — the helpers and components to call. It cannot say HOW
// the project does a kind of change: that a NestJS endpoint here is a controller method + a service
// method + a DTO + a module registration + an e2e test, or that a page is a route folder with its own
// loading and error files. A plan that does not know the house pattern invents one, and the review
// then spends its time on "we don't do it like that".
//
// Git already recorded the answer. For each kind, this finds the project's most recent example (a file
// whose name or content marks it as that kind) and asks git which commit ADDED it and what else that
// commit touched. That set is the recipe — the files a change of this kind adds or edits, in this
// project, as a person actually did it. Deterministic, read-only, dependency-free, any stack it
// recognises; a kind the project does not have is simply absent.
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { execFileSync } from "node:child_process";
import { isMain as isEntry, parseArgs } from "../../hooks/scripts/lib/cli.mjs";

// Each kind: a path pattern, and optionally a content pattern that must also match (checked on
// the candidate only). Ordered most-specific first within a kind.
export const KINDS = {
  endpoint: [
    { path: /\.controller\.[cm]?[jt]s$/ },
    { path: /(^|\/)app\/.*\/route\.[cm]?[jt]sx?$/ },
    { path: /(^|\/)(routes?|routers?|handlers?|endpoints|api)\/[^/]+\.(ts|js|py|go|rb)$/, content: /\b(get|post|put|patch|delete)\s*\(|@(app|router|api_view)\b|HandleFunc|Route\(|@(Get|Post|Put|Patch|Delete)Mapping/i },
    { path: /(^|\/)views\.py$/, content: /def\s+\w+\(\s*request/ },
    { path: /Controller\.(java|kt|cs)$/, content: /@RestController|\[ApiController\]|@Controller/ },
  ],
  page: [
    { path: /(^|\/)app\/(.*\/)?page\.[jt]sx?$/ },
    { path: /(^|\/)pages\/(?!api\/)[^_][^/]*\.[jt]sx?$/ },
    { path: /(^|\/)(screens?|views?|routes)\/[^/]+\.(tsx|jsx|vue|svelte)$/ },
  ],
  migration: [
    { path: /(^|\/)prisma\/migrations\/[^/]+\/migration\.sql$/ },
    { path: /(^|\/)(migrations?|alembic\/versions|db\/migrate)\/[^/]+\.(sql|py|rb|ts|js|go)$/ },
  ],
  component: [{ path: /(^|\/)components\/(?!ui\/).*\.(tsx|jsx|vue|svelte)$/ }, { path: /(^|\/)components\/.*\.(tsx|jsx|vue|svelte)$/ }],
  job: [
    { path: /(^|\/)(jobs?|workers?|queues?|consumers?|tasks)\/[^/]+\.(ts|js|py|go|rb)$/ },
    { path: /\.(processor|consumer|worker|job)\.[cm]?[jt]s$/ },
  ],
  test: [{ path: /\.(test|spec)\.[cm]?[jt]sx?$/ }, { path: /(^|\/)test_[^/]+\.py$/ }, { path: /_test\.go$/ }],
};

const SKIP = /(^|\/)(node_modules|dist|build|\.next|coverage|vendor|target|\.aidlc|\.claude)\//;

function git(root, args) {
  return execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 128 * 1024 * 1024 }).toString();
}

// The commit that added `file` at this path, and every path that commit touched. Deliberately no
// `--follow`: its similarity matching attributes a small file to whatever unrelated file once had the
// same few lines, and hands back a stranger's commit as the recipe. A renamed file starts its history
// at the rename, which is a smaller error and a visible one.
function recipeFor(root, file) {
  try {
    const log = git(root, ["log", "--diff-filter=A", "--format=%H%x09%ad%x09%s", "--date=short", "--", file]).trim().split("\n");
    const [sha, date, subject] = (log[log.length - 1] || "").split("\t");
    if (!sha) return null;
    const files = git(root, ["show", "--name-status", "--format=", sha])
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => {
        const [status, ...p] = l.split("\t");
        return { status: status[0], path: p[p.length - 1] };
      })
      .filter((f) => !SKIP.test(f.path) && !/(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|poetry\.lock|go\.sum|Cargo\.lock)$/.test(f.path));
    return { sha: sha.slice(0, 10), date, subject, files };
  } catch {
    return null;
  }
}

// Tracked files, most recently changed first.
function filesByRecency(root) {
  const out = git(root, ["log", "--name-only", "--format=", "--diff-filter=AM", "-n", "400"]);
  const seen = new Set();
  const ordered = [];
  for (const f of out.split(/\r?\n/)) if (f && !seen.has(f) && !SKIP.test(f)) (seen.add(f), ordered.push(f));
  // Files that exist now (a recently deleted file is no example), then any tracked file not in the window.
  const tracked = new Set(git(root, ["ls-files"]).split(/\r?\n/).filter(Boolean));
  return [...ordered.filter((f) => tracked.has(f)), ...[...tracked].filter((f) => !seen.has(f) && !SKIP.test(f))];
}

// A recipe is only useful while it is one change: past this many files it is a bulk import or a
// sweeping refactor, which says nothing about how a single endpoint or page is added.
const FOCUSED = 25;
const CANDIDATES = 15;

export function findExemplars(root, { kinds = Object.keys(KINDS), maxPerKind = 1 } = {}) {
  const files = filesByRecency(root);
  const result = {};
  for (const kind of kinds) {
    // Walk the most recent candidates and keep the first whose recipe is focused; fall back to the
    // most recent one when none is (a young repo committed in bulk still gets an example to read).
    const candidates = [];
    for (const rule of KINDS[kind]) {
      for (const f of files) {
        if (candidates.length >= CANDIDATES) break;
        if (!rule.path.test(f) || candidates.some((c) => c.file === f)) continue;
        if (rule.content) {
          let text = "";
          try {
            if (statSync(join(root, f)).size > 300_000) continue;
            text = readFileSync(join(root, f), "utf8");
          } catch {
            continue;
          }
          if (!rule.content.test(text)) continue;
        }
        candidates.push({ file: f });
      }
      if (candidates.length) break; // the most specific rule that matched anything decides the kind
    }
    const picks = [];
    for (const c of candidates) {
      const recipe = recipeFor(root, c.file);
      if (recipe && recipe.files.length <= FOCUSED) picks.push({ file: c.file, recipe });
      if (picks.length >= maxPerKind) break;
    }
    if (!picks.length && candidates.length) {
      const recipe = recipeFor(root, candidates[0].file);
      if (recipe && recipe.files.length > FOCUSED) recipe.tooBroad = true;
      picks.push({ file: candidates[0].file, recipe });
    }
    if (picks.length) result[kind] = picks;
  }
  return result;
}

export function renderExemplars(repo, ex) {
  const lines = [
    `# Golden paths — ${repo}`,
    "",
    "> How this project does each kind of change, taken from git: the most recent example of the kind, and",
    "> the files the commit that added it touched. A plan for a new change of the same kind mirrors this",
    "> file set and its structure — read the example before designing one. Generated by `aidlc:reuse` →",
    "> exemplars.mjs; never edit by hand.",
    "",
  ];
  for (const [kind, picks] of Object.entries(ex)) {
    for (const p of picks) {
      lines.push(`## ${kind} — e.g. \`${p.file}\``, "");
      if (!p.recipe) lines.push("(no commit history for it — read the file itself)", "");
      else if (p.recipe.tooBroad) lines.push(`(added in a ${p.recipe.files.length}-file bulk commit ${p.recipe.sha} — read the example and its neighbours rather than the commit)`, "");
      else {
        lines.push(`added in ${p.recipe.sha} (${p.recipe.date}) — ${p.recipe.subject}`, "");
        for (const f of p.recipe.files) lines.push(`- ${f.status === "A" ? "added " : "edited"} \`${f.path}\``);
        lines.push("");
      }
    }
  }
  if (!Object.keys(ex).length) lines.push("No recognisable kinds yet — a new project establishes its golden paths with its first changes.");
  return lines.join("\n") + "\n";
}

if (isEntry(import.meta.url)) {
  const { flags, positional } = parseArgs(process.argv.slice(2), ["--name", "--out"]);
  const [cmd, rootArg, kindArg] = positional;
  const flag = (n) => flags[`--${n}`];
  const root = rootArg ? resolve(rootArg) : null;
  if (!cmd || !root) {
    console.error("usage: node exemplars.mjs build <repoRoot> [--name <repo>] [--out <dir>]\n       node exemplars.mjs show <repoRoot> <" + Object.keys(KINDS).join("|") + ">");
    process.exit(2);
  }
  const name = flag("name") || basename(root);
  if (cmd === "build") {
    const ex = findExemplars(root);
    const out = resolve(flag("out") || join(root, ".aidlc", "catalog"));
    mkdirSync(out, { recursive: true });
    const base = join(out, `${name.replace(/[^\w.-]+/g, "_")}.exemplars`);
    writeFileSync(base + ".json", JSON.stringify(ex, null, 2) + "\n");
    writeFileSync(base + ".md", renderExemplars(name, ex));
    console.log(`golden paths: ${Object.keys(ex).join(", ") || "none"} → ${base}.md`);
  } else if (cmd === "show") {
    if (!KINDS[kindArg]) {
      console.error(`kind must be one of: ${Object.keys(KINDS).join(", ")}`);
      process.exit(2);
    }
    const ex = findExemplars(root, { kinds: [kindArg] });
    process.stdout.write(ex[kindArg] ? renderExemplars(name, ex).split("\n").slice(7).join("\n") : `no ${kindArg} in this project yet — establish the pattern and say so in the plan\n`);
  } else {
    console.error(`unknown command: ${cmd}`);
    process.exit(2);
  }
}
