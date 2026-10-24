#!/usr/bin/env node
// The project brain — one person's growing understanding of the product, kept in the workspace.
//
//   node brain.mjs init    <workspace>            create .aidlc/brain/ (kept out of git); print its path
//   node brain.mjs modules <workspace> [--json]   candidate modules, from the code's own layout
//   node brain.mjs status  <workspace> [--json]   every page, and how far its code has moved since it was checked
//   node brain.mjs changes <workspace> <page>     files under a page's paths changed since it was checked
//   node brain.mjs stamp   <workspace> <page>     mark a page checked against HEAD, after refreshing it
//   node brain.mjs index   <workspace>            regenerate index.md from the pages
//
// WHAT IT IS FOR. The other memories hold events (the journal), decisions (ADRs), operational truths
// (facts) and one work item at a time (run files). None of them answers "what does the payments
// module do, who uses it, and how does an order get from cart to invoice?" — what a person taking
// over a module asks, and what a business study at the end of a project is made of. The brain holds
// that: a page per module, the product's user types and flows, its vocabulary.
//
// WHY PER PERSON, AND WHY THE GIT CHECKS. It is one person's, kept out of git, because on many teams
// one person uses AIDLC and everyone else changes the code some other way. Most change then never
// passes through the tool, and a page is only as good as its freshness. Every page records the commit
// it was last checked against; `status` maps what changed since onto pages, so a module a teammate
// rewrote reads as behind before anyone trusts it. A page checked on a branch that is no longer in
// HEAD's history (switched away, abandoned, squash-merged) counts as behind too: the brain is not
// committed, so it does not change when the branch does.
//
// The model writes the pages; this script does what a model does badly — enumerate, diff, stamp.
// Never throws on a bad page: one unreadable file must not hide the others.
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, relative, resolve, basename } from "node:path";
import { execFileSync } from "node:child_process";
import { isMain as isEntry, parseArgs, tryJson } from "../../hooks/scripts/lib/cli.mjs";
import { frontmatter } from "../../hooks/scripts/lib/run-files.mjs";
import { memoryRoot, keepOutOfGit } from "../../hooks/scripts/lib/memory-home.mjs";
import { isWithin } from "../../hooks/scripts/lib/paths.mjs";
import { walk, isTestFile, IGNORED_DIRS } from "../reuse/catalog.mjs";

export const brainDir = (ws) => join(memoryRoot(resolve(ws)), ".aidlc", "brain");
const PAGE_DIRS = ["modules", "flows"];
const toPosix = (p) => p.replace(/\\/g, "/");
const today = (now = new Date()) => now.toISOString().slice(0, 10);

const git = (cwd, args) =>
  execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "ignore"], timeout: 10000 }).toString().trim();
const tryGit = (cwd, args) => {
  try {
    return git(cwd, args);
  } catch {
    return null;
  }
};

// The git repos a page's paths can live in: each declared repo in poly, and the workspace itself —
// last, as the owner of anything no declared repo contains.
function repoDirs(root) {
  const cfg = tryJson(join(root, ".claude", "aidlc.config.json")) ?? {};
  const base = resolve(root, cfg.workspace?.root || ".");
  const repos = (cfg.repos ?? []).filter((r) => r && typeof r.path === "string" && r.path);
  return [...repos.map((r) => resolve(base, r.path)), root];
}
const repoKey = (root, dir) => toPosix(relative(root, dir)) || ".";

export function init(ws) {
  const dir = brainDir(ws);
  for (const d of PAGE_DIRS) mkdirSync(join(dir, d), { recursive: true });
  keepOutOfGit(dir, "The project brain: one person's understanding of the product, kept out of git.");
  return dir;
}

// --- Pages -----------------------------------------------------------------------------------------

function summary(file) {
  try {
    const text = readFileSync(file, "utf8").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
    const title = /^#\s+(.+)$/m.exec(text)?.[1].trim() ?? null;
    const purpose = /^##\s+Purpose\s*\r?\n+([^\r\n#][^\r\n]*)/m.exec(text)?.[1].trim() ?? null;
    return { title, purpose };
  } catch {
    return { title: null, purpose: null };
  }
}

// Every page: modules/*.md, flows/*.md and the top-level ones (overview, actors, glossary…).
export function pages(ws) {
  const dir = brainDir(ws);
  const out = [];
  for (const sub of ["", ...PAGE_DIRS]) {
    let names;
    try {
      names = readdirSync(join(dir, sub)).filter((f) => f.endsWith(".md") && !(sub === "" && f === "index.md"));
    } catch {
      continue;
    }
    for (const f of names.sort()) {
      const file = join(dir, sub, f);
      const fm = frontmatter(file) ?? {};
      out.push({
        id: sub ? `${sub}/${f.slice(0, -3)}` : f.slice(0, -3),
        kind: sub ? sub.slice(0, -1) : "page",
        file,
        repo: fm.repo || ".",
        paths: (fm.paths || "")
          .split(",")
          .map((p) => toPosix(p.trim()).replace(/^\.\//, "").replace(/\/+$/, ""))
          .filter(Boolean),
        checked: fm.checked || null,
        updated: fm.updated || null,
        ...summary(file),
      });
    }
  }
  return out;
}

// A page by "payments", "modules/payments" or "modules/payments.md".
export function findPage(ws, name) {
  const want = toPosix(String(name)).replace(/\.md$/, "").toLowerCase();
  const all = pages(ws);
  return all.find((p) => p.id.toLowerCase() === want) ?? all.find((p) => p.id.split("/").pop().toLowerCase() === want) ?? null;
}

// --- Freshness ---------------------------------------------------------------------------------------

const underAny = (file, paths) => paths.some((q) => file === q || file.startsWith(q + "/"));

// What changed in a repo between a page's `checked` commit and HEAD. Off-branch pages are compared
// from the merge-base, so what the refresh reads is what this branch has that the page never saw.
function changedSince(repoDir, checked, head) {
  const sha = tryGit(repoDir, ["rev-parse", "--verify", "--quiet", `${checked}^{commit}`]);
  if (!sha) return null;
  let onBranch = true;
  try {
    git(repoDir, ["merge-base", "--is-ancestor", sha, head]);
  } catch {
    onBranch = false;
  }
  const base = onBranch ? sha : tryGit(repoDir, ["merge-base", sha, head]);
  if (!base) return null;
  const out = tryGit(repoDir, ["diff", "--name-only", base, head]);
  return { base, onBranch, files: out ? out.split(/\r?\n/).filter(Boolean).map(toPosix) : [] };
}

// A page's paths, grouped by the repo that holds each: [{ dir, key, rel: [repo-relative paths] }].
// Paths are relative to the workspace (a poly page names `core-api/src/modules/auth`), or to the
// page's `repo` when it sets one. A module that spans a backend and a frontend repo is one page.
function pathGroups(root, p, dirs) {
  const groups = new Map();
  for (const q of p.paths) {
    const abs = resolve(root, p.repo, q);
    const dir = dirs.filter((d) => isWithin(abs, d)).sort((a, b) => b.length - a.length)[0] ?? root;
    const g = groups.get(dir) ?? { dir, key: repoKey(root, dir), rel: [] };
    g.rel.push(toPosix(relative(dir, abs)) || ".");
    groups.set(dir, g);
  }
  return [...groups.values()];
}

// `checked: 3f2a9c1` for a page in one repo; `checked: core-api@3f2a9c1, web@9e8d7c6` across repos.
function parseChecked(s) {
  if (!s) return {};
  if (!s.includes("@")) return { "*": s.trim() };
  const out = {};
  for (const part of s.split(",")) {
    const at = part.lastIndexOf("@");
    if (at > 0) out[part.slice(0, at).trim()] = part.slice(at + 1).trim();
  }
  return out;
}

// Worst first: a page spanning repos takes the most urgent state of any of them.
const SEVERITY = ["unknown-commit", "off-branch", "behind", "never-checked", "current", "no-git"];

// Every page with a `state`:
//   current        — nothing under its paths changed since it was checked
//   behind         — files under its paths changed (`changed` lists them, workspace-relative)
//   off-branch     — checked on a commit HEAD's history does not contain
//   unknown-commit — its `checked` commit is not in that repo (history rewritten, or a typo)
//   never-checked  — written but never stamped
//   no-paths       — overview, actors, glossary: not tied to code
//   no-git         — none of its paths is in a git repo
// One `git diff` per distinct (repo, checked) pair, not per page: this runs at session start.
export function status(ws) {
  const root = memoryRoot(resolve(ws));
  const dirs = repoDirs(root);
  const heads = new Map();
  const diffs = new Map();
  return pages(ws).map((p) => {
    if (!p.paths.length) return { ...p, state: "no-paths" };
    const checked = parseChecked(p.checked);
    const repos = pathGroups(root, p, dirs).map((g) => {
      if (!heads.has(g.dir)) heads.set(g.dir, tryGit(g.dir, ["rev-parse", "HEAD"]));
      const head = heads.get(g.dir);
      if (!head) return { ...g, state: "no-git", changed: [] };
      const sha = checked[g.key] ?? checked["*"];
      if (!sha) return { ...g, state: "never-checked", changed: [] };
      const cacheKey = `${g.dir}@${sha}`;
      if (!diffs.has(cacheKey)) diffs.set(cacheKey, changedSince(g.dir, sha, head));
      const d = diffs.get(cacheKey);
      if (!d) return { ...g, state: "unknown-commit", changed: [] };
      const changed = d.files.filter((f) => underAny(f, g.rel)).map((f) => (g.key === "." ? f : `${g.key}/${f}`));
      return { ...g, base: d.base, changed, state: !d.onBranch ? "off-branch" : changed.length ? "behind" : "current" };
    });
    const state = SEVERITY.find((s) => repos.some((r) => r.state === s));
    return { ...p, state, changed: repos.flatMap((r) => r.changed), repos };
  });
}

export const NEEDS_REFRESH = new Set(["behind", "off-branch", "unknown-commit"]);

// The commands that show what a page has not seen yet, one per repo it spans.
export function diffCommands(p) {
  return (p.repos ?? []).filter((r) => r.base).map((r) => `git -C "${r.dir}" diff ${r.base.slice(0, 12)} HEAD -- ${r.rel.join(" ")}`);
}

// --- Stamping ------------------------------------------------------------------------------------------

// Set frontmatter keys in place, adding the block or a key when missing. Other lines are untouched.
function setFrontmatter(text, values) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  if (!m) return `---${eol}${Object.entries(values).map(([k, v]) => `${k}: ${v}`).join(eol)}${eol}---${eol}${text}`;
  let body = m[1];
  for (const [k, v] of Object.entries(values)) {
    const re = new RegExp(`^${k}:.*$`, "m");
    body = re.test(body) ? body.replace(re, `${k}: ${v}`) : `${body}${eol}${k}: ${v}`;
  }
  return `---${eol}${body}${eol}---${text.slice(m[0].length)}`;
}

// Mark a page checked against its repo's HEAD — only after a refresh that read everything `changes`
// listed. Stamping after a partial edit would hide the rest of what moved.
export function stamp(ws, name, { now = new Date() } = {}) {
  const p = findPage(ws, name);
  if (!p) throw new Error(`no page named ${name}`);
  if (!p.paths.length) throw new Error(`${p.id} has no paths — it is dated by \`updated\`, not checked against code`);
  const root = memoryRoot(resolve(ws));
  const heads = pathGroups(root, p, repoDirs(root)).map((g) => ({ key: g.key, head: tryGit(g.dir, ["rev-parse", "--short", "HEAD"]) }));
  const missing = heads.filter((h) => !h.head).map((h) => h.key);
  if (missing.length) throw new Error(`not a git repo: ${missing.join(", ")} — nothing to stamp against`);
  const checked = heads.length === 1 ? heads[0].head : heads.map((h) => `${h.key}@${h.head}`).join(", ");
  writeFileSync(p.file, setFrontmatter(readFileSync(p.file, "utf8"), { checked, updated: today(now) }));
  return { page: p.id, checked };
}

// --- Index ---------------------------------------------------------------------------------------------

const STATE_LABEL = {
  current: "current",
  behind: "behind",
  "off-branch": "behind (other branch)",
  "unknown-commit": "behind (unknown commit)",
  "never-checked": "never checked",
  "no-git": "not in git",
};

export function renderIndex(ws) {
  const all = status(ws);
  const mods = all.filter((p) => p.kind === "module");
  const flows = all.filter((p) => p.kind === "flow");
  const top = all.filter((p) => p.kind === "page");
  const behind = mods.filter((p) => NEEDS_REFRESH.has(p.state)).length;
  const cell = (s) => String(s ?? "").replace(/\|/g, "\\|");
  const lines = [
    `# Project brain — ${basename(memoryRoot(resolve(ws)))}`,
    "",
    "<!-- Generated by brain.mjs index. Edit the pages, not this file. -->",
    "",
    `${mods.length} module page(s) · ${behind} behind the code · ${flows.length} flow(s)`,
    "",
    "## Modules",
    "",
  ];
  if (mods.length) {
    lines.push("| Module | What it does | Code | State |", "|---|---|---|---|");
    for (const p of mods) {
      const name = p.id.split("/").pop();
      const code = p.paths.map((q) => (p.repo === "." ? q : `${p.repo}/${q}`)).join(", ");
      const state = `${STATE_LABEL[p.state] ?? p.state}${p.changed?.length ? ` — ${p.changed.length} file(s)` : ""}${p.checked ? ` @${p.checked}` : ""}`;
      lines.push(`| [${cell(p.title ?? name)}](${p.id}.md) | ${cell(p.purpose ?? "")} | ${cell(code)} | ${state} |`);
    }
  } else lines.push("_None yet — `/aidlc:learn` maps them._");
  if (flows.length) {
    lines.push("", "## Flows", "");
    for (const p of flows) lines.push(`- [${p.title ?? p.id.split("/").pop()}](${p.id}.md)${p.purpose ? ` — ${p.purpose}` : ""}`);
  }
  if (top.length) {
    lines.push("", "## The product", "");
    for (const p of top) lines.push(`- [${p.title ?? p.id}](${p.id}.md)`);
  }
  return lines.join("\n") + "\n";
}

export function writeIndex(ws) {
  const file = join(init(ws), "index.md");
  writeFileSync(file, renderIndex(ws));
  return file;
}

// --- Module discovery ------------------------------------------------------------------------------------

// Folders whose children are features. Their child folders become candidate modules; a Next.js route
// group `(shop)` is see-through, and `app/api` is itself a container — so `app/orders`,
// `app/api/orders` and `src/modules/orders` meet as one candidate with three paths: one module,
// three layers.
const CONTAINERS = new Set(["modules", "features", "domains", "apps", "packages", "services", "routes", "pages", "app", "api", "screens", "views"]);
// Monorepo units are coarse: `apps/web` holds its own features, so it is searched further and gives way
// to what it holds. A feature folder is a leaf — its inner `pages/` or `api/` is part of it, not a split.
const UNITS = new Set(["apps", "packages", "services"]);
const LIMIT = 60;

const sourceFiles = (dir) => {
  let n = 0;
  for (const f of walk(dir)) if (!isTestFile(toPosix(f))) n++;
  return n;
};

const subdirs = (dir) => {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !IGNORED_DIRS.has(e.name) && !e.name.startsWith(".") && !e.name.startsWith("_"))
      .map((e) => e.name);
  } catch {
    return [];
  }
};

export function candidateModules(repoRoot, { repo = ".", maxDepth = 5 } = {}) {
  const byName = new Map();
  const add = (name, abs) => {
    const key = name.toLowerCase().replace(/^\[+|\]+$/g, "");
    const files = sourceFiles(abs);
    if (!files || !key) return;
    const c = byName.get(key) ?? { name: key, repo, paths: [], files: 0 };
    c.paths.push(toPosix(relative(repoRoot, abs)));
    c.files += files;
    byName.set(key, c);
  };
  const container = (abs, depth, kind) => {
    for (const name of subdirs(abs)) {
      const child = join(abs, name);
      if (/^[[@]/.test(name)) continue; // dynamic segments and parallel-route slots are not features
      if (/^\(.*\)$/.test(name)) container(child, depth + 1, kind);
      // `apps/api` is an app called api, not an `api/` folder of routes.
      else if (!UNITS.has(kind) && CONTAINERS.has(name.toLowerCase())) container(child, depth + 1, name.toLowerCase());
      else {
        add(name, child);
        if (UNITS.has(kind)) visit(child, depth + 1);
      }
    }
  };
  const visit = (abs, depth) => {
    if (depth > maxDepth) return;
    for (const name of subdirs(abs)) {
      const child = join(abs, name);
      if (CONTAINERS.has(name.toLowerCase())) container(child, depth + 1, name.toLowerCase());
      else visit(child, depth + 1);
    }
  };
  visit(repoRoot, 0);
  let out = [...byName.values()];
  // Prefer the finer grain: drop a candidate whose every path holds another candidate's path.
  out = out.filter((c) => !c.paths.every((p) => out.some((o) => o !== c && o.paths.some((q) => q.startsWith(p + "/")))));
  if (!out.length) {
    // No feature containers at all: the top-level source folders are the best guess.
    const base = subdirs(repoRoot).includes("src") ? join(repoRoot, "src") : repoRoot;
    for (const name of subdirs(base)) add(name, join(base, name));
    out = [...byName.values()];
  }
  return out.sort((a, b) => b.files - a.files).slice(0, LIMIT).sort((a, b) => a.name.localeCompare(b.name));
}

// Candidates across the workspace, with paths relative to it — ready for a page's `paths`. In poly,
// a name found in several repos is one candidate: `auth` in the API and `auth` in the web app are
// usually the two halves of one module. The user confirms the list, so a merge that is wrong
// (four unrelated `health` endpoints) costs a sentence, while a split that is wrong costs a page.
export function workspaceModules(ws) {
  const root = memoryRoot(resolve(ws));
  const dirs = repoDirs(root);
  if (dirs.length === 1) return candidateModules(root).map((c) => ({ ...c, repos: ["."] }));
  const byName = new Map();
  for (const dir of dirs.slice(0, -1)) {
    const key = repoKey(root, dir);
    for (const c of candidateModules(dir, { repo: key })) {
      const m = byName.get(c.name) ?? { name: c.name, repos: [], paths: [], files: 0 };
      m.repos.push(key);
      m.paths.push(...c.paths.map((q) => (key === "." ? q : `${key}/${q}`)));
      m.files += c.files;
      byName.set(c.name, m);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// --- CLI -------------------------------------------------------------------------------------------------

if (isEntry(import.meta.url)) {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const [cmd, ws = ".", name] = positional;
  const json = flags["--json"] === true;
  const out = (v, text) => process.stdout.write(json ? JSON.stringify(v, null, 2) + "\n" : text + "\n");
  try {
    if (cmd === "init") {
      const dir = init(ws);
      out({ dir }, dir);
    }
    else if (cmd === "modules") {
      const mods = workspaceModules(ws);
      out(mods, mods.map((m) => `${m.name.padEnd(24)} ${String(m.files).padStart(5)} files  ${m.paths.join(", ")}`).join("\n") || "(no candidate modules found)");
    } else if (cmd === "status") {
      const all = status(ws);
      out(
        all.map(({ file, ...p }) => p),
        all.map((p) => `${p.id.padEnd(28)} ${p.state}${p.changed?.length ? ` — ${p.changed.length} file(s) changed` : ""}`).join("\n") || "(no pages yet — /aidlc:learn)",
      );
    } else if (cmd === "changes") {
      if (!name) throw new Error("usage: brain.mjs changes <workspace> <page>");
      const p = status(ws).find((s) => s.id === findPage(ws, name)?.id);
      if (!p) throw new Error(`no page named ${name}`);
      const cmds = diffCommands(p);
      out(
        { page: p.id, state: p.state, changed: p.changed ?? [], diff: cmds },
        [`${p.id}: ${p.state}`, ...(p.changed ?? []).map((f) => `  ${f}`), ...cmds.map((c) => `read: ${c}`)].join("\n"),
      );
    } else if (cmd === "stamp") {
      if (!name) throw new Error("usage: brain.mjs stamp <workspace> <page>");
      const r = stamp(ws, name);
      out(r, `${r.page} checked @${r.checked}`);
    } else if (cmd === "index") {
      const file = writeIndex(ws);
      out({ file }, file);
    }
    else {
      console.error("usage: brain.mjs <init|modules|status|changes|stamp|index> <workspace> [page] [--json]");
      process.exit(2);
    }
  } catch (e) {
    console.error(`brain: ${e.message}`);
    process.exit(1);
  }
}
