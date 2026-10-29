#!/usr/bin/env node
// The project brain — one person's growing understanding of the product, kept in the workspace.
//
//   node brain.mjs init    <workspace>            create .aidlc/brain/ (kept out of git); print its path
//   node brain.mjs modules <workspace> [--json]   candidate modules, from the code's own layout
//   node brain.mjs status  <workspace> [--json]   every page, and how far its code has moved since it was checked
//   node brain.mjs changes <workspace> <page>     files under a page's paths changed since it was checked
//   node brain.mjs stamp   <workspace> <page>     mark a page checked against HEAD, after refreshing it
//   node brain.mjs move    <workspace> <page> <area>  put a page in an area folder (`.` for the top), re-index
//   node brain.mjs index   <workspace>            regenerate index.md from the pages
//   node brain.mjs which   <workspace> <files…>   the pages (or modules without one) those files belong to
//   node brain.mjs links   <workspace> <files…>   the modules those files import from, and whether both pages say so
//   node brain.mjs context <workspace> <files…>   the modules being changed: what they are for, their rules, what uses them
//   node brain.mjs digest  <workspace>            everything a business study is assembled from
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
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync, renameSync, rmdirSync } from "node:fs";
import { join, relative, resolve, basename, dirname, isAbsolute } from "node:path";
import { execFileSync } from "node:child_process";
import { isMain as isEntry, parseArgs, tryJson } from "../../hooks/scripts/lib/cli.mjs";
import { frontmatter } from "../../hooks/scripts/lib/run-files.mjs";
import { memoryRoot, keepOutOfGit } from "../../hooks/scripts/lib/memory-home.mjs";
import { isWithin } from "../../hooks/scripts/lib/paths.mjs";
import { walk, isTestFile, IGNORED_DIRS, SHARED_DIR_NAMES } from "../reuse/catalog.mjs";

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

// The page files under one folder: its own, then each subfolder's — an area (`modules/billing/`) groups
// related modules the way the product does. Any depth is read, so a page is never silently dropped for
// sitting one folder too deep; one level is what the skills recommend.
function pageFiles(dir, rel = "") {
  let entries;
  try {
    entries = readdirSync(join(dir, rel), { withFileTypes: true });
  } catch {
    return [];
  }
  const sorted = entries.sort((a, b) => a.name.localeCompare(b.name));
  return [
    ...sorted.filter((e) => e.isFile() && e.name.endsWith(".md")).map((e) => (rel ? `${rel}/${e.name}` : e.name)),
    ...sorted.filter((e) => e.isDirectory() && !e.name.startsWith(".")).flatMap((e) => pageFiles(dir, rel ? `${rel}/${e.name}` : e.name)),
  ];
}

// Every page: modules/**.md, flows/**.md and the top-level ones (overview, actors, glossary…). A page in
// an area folder carries `area` (`billing`, or `billing/payouts` deeper), null at the top.
export function pages(ws) {
  const dir = brainDir(ws);
  const out = [];
  for (const sub of ["", ...PAGE_DIRS]) {
    const names = sub
      ? pageFiles(join(dir, sub))
      : (() => {
          try {
            return readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "index.md").sort();
          } catch {
            return [];
          }
        })();
    for (const f of names) {
      const file = join(dir, sub, f);
      const fm = frontmatter(file) ?? {};
      const slash = f.lastIndexOf("/");
      out.push({
        id: sub ? `${sub}/${f.slice(0, -3)}` : f.slice(0, -3),
        kind: sub ? sub.slice(0, -1) : "page",
        area: slash > 0 ? f.slice(0, slash) : null,
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

// Pages answering to a name: the full id (`modules/billing/payments`), the id without its kind
// (`billing/payments`), or the bare name (`payments`) when only one page has it.
export function matchPages(ws, name) {
  const want = toPosix(String(name)).replace(/\.md$/, "").replace(/^\/+|\/+$/g, "").toLowerCase();
  const all = pages(ws);
  const exact = all.filter((p) => p.id.toLowerCase() === want || p.id.toLowerCase().replace(/^[^/]+\//, "") === want);
  const hits = exact.length ? exact : all.filter((p) => p.id.split("/").pop().toLowerCase() === want);
  // `checkout` the module and `checkout` the flow: the name means the module, as it always has.
  const mods = hits.filter((p) => p.kind === "module");
  return hits.length > 1 && mods.length === 1 ? mods : hits;
}
export function findPage(ws, name) {
  const hits = matchPages(ws, name);
  return hits.length === 1 ? hits[0] : null;
}
const pageOrThrow = (ws, name) => {
  const hits = matchPages(ws, name);
  if (hits.length > 1) throw new Error(`${name} names more than one page: ${hits.map((p) => p.id).join(", ")} — give its area`);
  if (!hits.length) throw new Error(`no page named ${name}`);
  return hits[0];
};

// --- Freshness ---------------------------------------------------------------------------------------

const underAny = (file, paths) => paths.some((q) => file === q || file.startsWith(q + "/"));
// A page's paths relative to the workspace (prefixed with its `repo` when it sets one).
const wsPaths = (p) => p.paths.map((q) => (p.repo === "." ? q : `${p.repo}/${q}`));

// What differs in a repo between the code a page was checked against and HEAD. CONTENT, not history:
// a run stamps its pages on its feature branch, and a squash merge lands the same code as a new
// commit — history says "not an ancestor", content says nothing changed, and content is the question.
// An abandoned branch's page still reads as behind, because the code it described is not in HEAD.
// `onBranch` only labels which of the two a behind page is.
function changedSince(repoDir, checked, head) {
  const sha = tryGit(repoDir, ["rev-parse", "--verify", "--quiet", `${checked}^{commit}`]);
  if (!sha) return null;
  let onBranch = true;
  try {
    git(repoDir, ["merge-base", "--is-ancestor", sha, head]);
  } catch {
    onBranch = false;
  }
  const out = tryGit(repoDir, ["diff", "--name-only", sha, head]);
  if (out === null) return null;
  return { base: sha, onBranch, files: out.split(/\r?\n/).filter(Boolean).map(toPosix) };
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
  const root = resolve(ws);
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
      return { ...g, base: d.base, changed, state: !changed.length ? "current" : d.onBranch ? "behind" : "off-branch" };
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
  const p = pageOrThrow(ws, name);
  if (!p.paths.length) throw new Error(`${p.id} has no paths — it is dated by \`updated\`, not checked against code`);
  const root = resolve(ws);
  const heads = pathGroups(root, p, repoDirs(root)).map((g) => ({ key: g.key, head: tryGit(g.dir, ["rev-parse", "--short", "HEAD"]) }));
  const missing = heads.filter((h) => !h.head).map((h) => h.key);
  if (missing.length) throw new Error(`not a git repo: ${missing.join(", ")} — nothing to stamp against`);
  const checked = heads.length === 1 ? heads[0].head : heads.map((h) => `${h.key}@${h.head}`).join(", ");
  writeFileSync(p.file, setFrontmatter(readFileSync(p.file, "utf8"), { checked, updated: today(now) }));
  return { page: p.id, checked };
}

// --- Areas -------------------------------------------------------------------------------------------------

// Move a module or flow page into an area folder (`billing`, created when missing), or back to the top
// with "." — the page itself, unchanged. Refuses to overwrite: two pages with one name in one area are
// two modules that need two names.
export function move(ws, name, area) {
  const p = pageOrThrow(ws, name);
  if (p.kind === "page") throw new Error(`${p.id} is a product page; only module and flow pages go in areas`);
  const clean = toPosix(String(area ?? ".")).replace(/^\/+|\/+$/g, "").toLowerCase();
  const top = clean === "." || clean === "";
  if (!top && !/^[\p{L}\p{N}_-]+(\/[\p{L}\p{N}_-]+)*$/u.test(clean)) throw new Error(`not an area name: ${area} — letters, digits, - and _`);
  const base = join(brainDir(ws), `${p.kind}s`);
  const to = top ? join(base, basename(p.file)) : join(base, clean, basename(p.file));
  if (resolve(to) === resolve(p.file)) return { from: p.id, to: p.id };
  if (existsSync(to)) throw new Error(`${toPosix(relative(brainDir(ws), to))} already exists`);
  mkdirSync(dirname(to), { recursive: true });
  renameSync(p.file, to);
  // An area left empty by the move goes too: an empty folder reads as an area with nothing in it.
  const old = dirname(p.file);
  if (old !== base && !readdirSync(old).length) rmdirSync(old);
  return { from: p.id, to: toPosix(relative(brainDir(ws), to)).replace(/\.md$/, "") };
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
  const areas = [...new Set(mods.map((p) => p.area).filter(Boolean))].sort();
  const cell = (s) => String(s ?? "").replace(/\|/g, "\\|");
  const lines = [
    `# Project brain — ${basename(memoryRoot(resolve(ws)))}`,
    "",
    "<!-- Generated by brain.mjs index. Edit the pages, not this file. -->",
    "",
    `${mods.length} module page(s)${areas.length ? ` in ${areas.length} area(s)` : ""} · ${behind} behind the code · ${flows.length} flow(s)`,
    "",
    "## Modules",
    "",
  ];
  const table = (list) => {
    lines.push("| Module | What it does | Code | State |", "|---|---|---|---|");
    for (const p of list) {
      const name = p.id.split("/").pop();
      const code = wsPaths(p).join(", ");
      const state = `${STATE_LABEL[p.state] ?? p.state}${p.changed?.length ? ` — ${p.changed.length} file(s)` : ""}${p.checked ? ` @${p.checked}` : ""}`;
      lines.push(`| [${cell(p.title ?? name)}](${p.id}.md) | ${cell(p.purpose ?? "")} | ${cell(code)} | ${state} |`);
    }
  };
  if (!mods.length) lines.push("_None yet — `/aidlc:learn` maps them._");
  else if (!areas.length) table(mods);
  else {
    // Modules in no area first, then one section per area — the way the product groups them.
    const loose = mods.filter((p) => !p.area);
    if (loose.length) table(loose);
    for (const a of areas) {
      if (lines.at(-1) !== "") lines.push("");
      lines.push(`### ${a}`, "");
      table(mods.filter((p) => p.area === a));
    }
  }
  if (flows.length) {
    lines.push("", "## Flows", "");
    for (const p of flows) lines.push(`- [${p.title ?? p.id.split("/").pop()}](${p.id}.md)${p.area ? ` (${p.area})` : ""}${p.purpose ? ` — ${p.purpose}` : ""}`);
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

// One module, however each layer spells it: `booking-approval`, `BookingApproval` and `bookingApprovals`
// meet on `bookingapproval`. Case, separators and a plain plural are spelling, not meaning.
export function moduleKey(name) {
  let k = String(name).toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  if (k.length > 5 && k.endsWith("ies")) k = `${k.slice(0, -3)}y`;
  else if (k.length > 4 && k.endsWith("s") && !/(ss|us|is)$/.test(k)) k = k.slice(0, -1);
  return k;
}
// The name a page is written under: `BookingApproval` → `booking-approval`.
const pageName = (name) =>
  String(name)
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1-$2")
    .replace(/[\s_.]+/g, "-")
    .toLowerCase();

// A deployable app or service in a monorepo (`apps/api`, `services/billing`) is a package of its own.
// When nothing inside it looks like a feature container, its source folder's children are its modules:
// a NestJS app keeps them straight in `src/<module>`, and treating the whole app as one module hides
// every one of them. Libraries under `packages/` are left whole — their folders are parts, not features.
const MANIFESTS = ["package.json", "project.json", "pyproject.toml", "go.mod", "Cargo.toml", "pom.xml", "build.gradle", "build.gradle.kts", "composer.json"];
const isPackage = (dir) => {
  try {
    return readdirSync(dir).some((f) => MANIFESTS.includes(f) || f.endsWith(".csproj"));
  } catch {
    return false;
  }
};
// Folders in an app's source that are plumbing, not product: never offered as modules.
const PLUMBING = new Set([
  ...SHARED_DIR_NAMES,
  "config", "configs", "configuration", "database", "db", "prisma", "migrations", "seeds", "test", "tests", "e2e",
  "scripts", "assets", "static", "i18n", "locales", "generated", "dto", "dtos", "entities", "health", "logger", "logging",
]);

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
    const key = moduleKey(name);
    const files = sourceFiles(abs);
    if (!files || !key) return;
    const c = byName.get(key) ?? { name: pageName(name), repo, paths: [], files: 0 };
    c.paths.push(toPosix(relative(repoRoot, abs)));
    c.files += files;
    byName.set(key, c);
  };
  // An app whose top level or `src/` has a feature container (`app/`, `modules/`, `features/`…) is
  // searched as usual. One without (a flat NestJS `src/`) has its modules straight under `src/`.
  const srcOf = (app) => ["src", "internal"].find((d) => subdirs(app).includes(d));
  const hasContainer = (app) => {
    const src = srcOf(app);
    return [...subdirs(app), ...(src ? subdirs(join(app, src)) : [])].some((n) => CONTAINERS.has(n.toLowerCase()));
  };
  const appModules = (app) => {
    const src = srcOf(app);
    if (!src) return false;
    for (const name of subdirs(join(app, src)))
      if (!PLUMBING.has(name.toLowerCase()) && !/^[[@(]/.test(name)) add(name, join(app, src, name));
    return true;
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
        if (!UNITS.has(kind)) continue;
        const flatApp = kind !== "packages" && isPackage(child) && !hasContainer(child);
        if (!(flatApp && appModules(child))) visit(child, depth + 1);
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
  const root = resolve(ws);
  const dirs = repoDirs(root);
  if (dirs.length === 1) return candidateModules(root).map((c) => ({ ...c, repos: ["."] }));
  const byName = new Map();
  for (const dir of dirs.slice(0, -1)) {
    const key = repoKey(root, dir);
    for (const c of candidateModules(dir, { repo: key })) {
      const id = moduleKey(c.name);
      const m = byName.get(id) ?? { name: c.name, repos: [], paths: [], files: 0 };
      m.repos.push(key);
      m.paths.push(...c.paths.map((q) => (key === "." ? q : `${key}/${q}`)));
      m.files += c.files;
      byName.set(id, m);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// --- Which module does a file belong to? -------------------------------------------------------------------

// For the files a run or a session just touched: the pages that cover them, and for files no page
// covers, the candidate module they sit in — so the brain grows a page for a module the first time work
// touches it, with no /aidlc:learn needed first. Files in neither (shared code, config) are `unmapped`:
// the reuse catalog knows those.
export function which(ws, files) {
  const root = resolve(ws);
  const rel = files.map((f) => toPosix(isAbsolute(f) ? relative(root, f) : f).replace(/^\.\//, ""));
  const withPaths = pages(ws).filter((p) => p.paths.length);
  const covered = new Map();
  const rest = [];
  for (const f of rel) {
    const hits = withPaths.filter((p) => underAny(f, wsPaths(p)));
    for (const p of hits) covered.set(p.id, [...(covered.get(p.id) ?? []), f]);
    if (!hits.length) rest.push(f);
  }
  const candidates = [];
  if (rest.length)
    for (const c of workspaceModules(ws)) {
      const mine = rest.filter((f) => underAny(f, c.paths));
      if (mine.length) candidates.push({ name: c.name, paths: c.paths, files: mine });
    }
  const placed = new Set(candidates.flatMap((c) => c.files));
  return {
    pages: [...covered].map(([id, fs]) => ({ id, files: fs })),
    candidates,
    unmapped: rest.filter((f) => !placed.has(f)),
  };
}

// --- Connections: which modules a module's code reaches into ---------------------------------------------------

// A change that makes one module call another is a fact about both: the caller's page says what it
// connects to, and the called module's page says what uses it. Left to the model, the first gets written
// and the second does not, and nothing marks the second page as behind, because its own code never moved.
// This reads the imports in the files a change touched, resolves each to the module that owns it, and
// says which of the two lines each page is missing. Imports only: HTTP calls, queues and SDKs to outside
// services are still the model's to read.
const CODE_EXT = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py"];

export function importsOf(text, file) {
  const out = new Set();
  if (file.endsWith(".py")) {
    for (const m of text.matchAll(/^[ \t]*from[ \t]+(\.+[\w.]*|[\w.]+)[ \t]+import\b/gm)) out.add(m[1]);
    for (const m of text.matchAll(/^[ \t]*import[ \t]+([\w.]+(?:[ \t]*,[ \t]*[\w.]+)*)/gm))
      for (const s of m[1].split(",")) out.add(s.trim());
  } else {
    for (const m of text.matchAll(/\bfrom\s+["']([^"'\n]+)["']/g)) out.add(m[1]);
    for (const m of text.matchAll(/\bimport\s*\(?\s*["']([^"'\n]+)["']/g)) out.add(m[1]);
    for (const m of text.matchAll(/\brequire\s*\(\s*["']([^"'\n]+)["']/g)) out.add(m[1]);
  }
  return [...out];
}

// tsconfig.json allows comments and trailing commas; JSON.parse does not.
function readJsonc(file) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === "\\") out += text[++i] ?? "";
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
    } else out += c;
  }
  try {
    return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
  } catch {
    return null;
  }
}

function resolver(root) {
  const aliasCache = new Map();
  // `paths` and `baseUrl` from every tsconfig/jsconfig between a folder and the workspace root, nearest
  // first: an app's own config, then the monorepo's base config it extends.
  const aliases = (dir) => {
    if (aliasCache.has(dir)) return aliasCache.get(dir);
    const out = [];
    for (const name of ["tsconfig.json", "tsconfig.base.json", "jsconfig.json"]) {
      const co = readJsonc(join(dir, name))?.compilerOptions;
      if (!co) continue;
      const base = resolve(dir, co.baseUrl ?? ".");
      for (const [pattern, targets] of Object.entries(co.paths ?? {}))
        out.push({ prefix: pattern.replace(/\*$/, ""), wildcard: pattern.endsWith("*"), targets: [].concat(targets).map((t) => resolve(base, t)) });
      if (co.baseUrl) out.push({ prefix: "", wildcard: true, targets: [join(base, "*")] });
    }
    const up = dirname(dir);
    const all = [...out, ...(isWithin(up, root) && up !== dir ? aliases(up) : [])];
    aliasCache.set(dir, all);
    return all;
  };
  const MARKERS = ["package.json", "pyproject.toml", "setup.py", "setup.cfg"];
  const packageRoot = (dir) => {
    for (let d = dir; isWithin(d, root); d = dirname(d)) {
      if (MARKERS.some((m) => existsSync(join(d, m)))) return d;
      if (d === dirname(d) || d === root) break;
    }
    return root;
  };
  const exists = (p) =>
    existsSync(p) || CODE_EXT.some((e) => existsSync(p + e)) || (/\.[cm]?js$/.test(p) && [".ts", ".tsx"].some((e) => existsSync(p.replace(/\.[cm]?js$/, e))));
  // Packages of this workspace, by their package.json name (`@acme/shared`): each repo, and each app,
  // package, service or lib inside one. Longest name first, so `@acme/shared-ui` is not read as `@acme/shared`.
  let packages = null;
  const workspacePackages = () => {
    if (packages) return packages;
    const dirs = new Set();
    for (const base of repoDirs(root)) {
      dirs.add(base);
      for (const unit of ["apps", "packages", "services", "libs"]) for (const name of subdirs(join(base, unit))) dirs.add(join(base, unit, name));
    }
    packages = [...dirs]
      .map((dir) => ({ dir, pj: tryJson(join(dir, "package.json")) }))
      .filter((p) => typeof p.pj?.name === "string")
      .map((p) => ({ name: p.pj.name, dir: p.dir, exports: p.pj.exports }))
      .sort((a, b) => b.name.length - a.name.length);
    return packages;
  };
  // What `exports` maps a subpath to, preferring the types entry: it sits nearest the source.
  const exportTarget = (exp, key) => {
    let v = typeof exp === "string" ? (key === "." ? exp : null) : exp?.[key];
    while (v && typeof v === "object") v = v.types ?? v.import ?? v.require ?? v.default ?? null;
    return typeof v === "string" ? v : null;
  };
  // A built entry (`./dist/schema/index.d.ts`) read as the source it was built from (`src/schema/index`).
  const sourceOf = (p) => p.replace(/^\.\//, "").replace(/^(dist|build|lib)\//, "src/").replace(/(\.d)?\.[cm]?[jt]s$/, "");
  // The file an import names, as an absolute path, or null when it is a package or cannot be found.
  return (spec, fromFile) => {
    const dir = dirname(fromFile);
    if (fromFile.endsWith(".py")) {
      const dots = /^\.*/.exec(spec)[0].length;
      const rest = spec.slice(dots).replace(/\./g, "/");
      if (dots) {
        let base = dir;
        for (let i = 1; i < dots; i++) base = dirname(base);
        return join(base, rest);
      }
      const pkg = packageRoot(dir);
      return [pkg, join(pkg, "src"), root, join(root, "src")].map((b) => join(b, rest)).find(exists) ?? null;
    }
    if (spec.startsWith("./") || spec.startsWith("../")) return join(dir, spec);
    const tries = [];
    for (const a of aliases(dir))
      if (a.wildcard ? spec.startsWith(a.prefix) : spec === a.prefix)
        for (const t of a.targets) tries.push(t.replace("*", a.wildcard ? spec.slice(a.prefix.length) : ""));
    if (/^[@~]\//.test(spec)) {
      const pkg = packageRoot(dir);
      tries.push(join(pkg, "src", spec.slice(2)), join(pkg, spec.slice(2)));
    }
    const pkg = workspacePackages().find((p) => spec === p.name || spec.startsWith(p.name + "/"));
    if (pkg) {
      const sub = spec.slice(pkg.name.length + 1);
      if (sub) tries.push(join(pkg.dir, "src", sub), join(pkg.dir, sub));
      const target = exportTarget(pkg.exports, sub ? `./${sub}` : ".");
      if (target) tries.push(join(pkg.dir, sourceOf(target)));
      tries.push(join(pkg.dir, "src", "index"), join(pkg.dir, "index"));
    }
    return tries.find(exists) ?? null;
  };
}

// The files to read: each given file, and every source file under each given folder. Tests are left out:
// a test reaching into another module's fixtures is not a connection the product has.
function codeFiles(root, inputs) {
  const out = new Set();
  for (const input of inputs) {
    const abs = resolve(root, input);
    let isDir = false;
    try {
      isDir = statSync(abs).isDirectory();
    } catch {
      continue;
    }
    for (const f of isDir ? walk(abs) : [abs]) {
      const rel = toPosix(relative(root, f));
      if (CODE_EXT.some((e) => rel.endsWith(e)) && !isTestFile(rel)) out.add(f);
    }
  }
  return [...out];
}

// Does a page section name this module? A line's lead (`- Payments — why`) or, for a name long enough
// not to hide inside other words, anywhere in a line.
function names(text, name) {
  const key = moduleKey(name);
  if (!text || !key) return false;
  return text.split(/\r?\n/).some((l) => {
    const lead = l.replace(/^\s*[-*]\s*/, "").split(/\s+[—–-]\s+|:/)[0];
    return moduleKey(lead) === key || (key.length >= 5 && moduleKey(l).includes(key));
  });
}

// Which module owns a workspace-relative path. A page the user drew wins over a candidate the layout
// suggests; the longest path wins within each.
function owners(ws, all = pages(ws)) {
  const pageOwners = all.filter((p) => p.kind === "module" && p.paths.length).map((p) => ({ name: p.id.split("/").pop(), page: p.id, area: p.area, file: p.file, paths: wsPaths(p) }));
  let mods = null;
  return (rel) => {
    const longest = (list) => {
      let best = null;
      let len = -1;
      for (const o of list) for (const q of o.paths) if ((rel === q || rel.startsWith(q + "/")) && q.length > len) [best, len] = [o, q.length];
      return best;
    };
    const page = longest(pageOwners);
    if (page) return page;
    mods ??= workspaceModules(ws).map((c) => ({ name: c.name, page: null, area: null, file: null, paths: c.paths }));
    return longest(mods);
  };
}

// Every import in `files` that reaches into another module: { from, to, file, import } with owners.
// `limit` bounds how many files are read; `partial` says it was reached.
function edges(root, files, ownerOf, limit = Infinity) {
  const resolve_ = resolver(root);
  const out = [];
  let read = 0;
  for (const f of files) {
    if (read >= limit) return { edges: out, partial: true };
    const rel = toPosix(relative(root, f));
    const from = ownerOf(rel);
    if (!from) continue;
    let text;
    try {
      text = readFileSync(f, "utf8");
    } catch {
      continue;
    }
    read++;
    for (const spec of importsOf(text, rel)) {
      const target = resolve_(spec, f);
      if (!target) continue;
      const to = ownerOf(toPosix(relative(root, target)));
      if (!to || to === from) continue;
      // Two pages are two modules, even when two areas give them one name (`accounts/settings`,
      // `billing/settings`). A page and a layout candidate sharing a name are one module's two layers.
      if (!(from.page && to.page) && moduleKey(to.name) === moduleKey(from.name)) continue;
      out.push({ from, to, file: rel, import: spec });
    }
  }
  return { edges: out, partial: false };
}

export function links(ws, inputs) {
  const root = resolve(ws);
  const all = pages(ws);
  const found = new Map();
  for (const e of edges(root, codeFiles(root, inputs), owners(ws, all)).edges) {
    const key = `${e.from.page ?? e.from.name}→${e.to.page ?? e.to.name}`;
    if (!found.has(key)) found.set(key, e);
  }
  const out = [...found.values()].map(({ from, to, file, import: spec }) => ({
    from: from.name,
    fromPage: from.page,
    to: to.name,
    toPage: to.page,
    file,
    import: spec,
    forward: !!from.file && names(sections(from.file)["Connects to"], to.name),
    reverse: !!to.file && names(sections(to.file)["Used by"], from.name),
  }));
  // A new connection may add a step to a journey: the flow pages that name a module of one.
  const fresh = [...new Set(out.filter((l) => !l.forward || !l.reverse).flatMap((l) => [l.from, l.to]))];
  const flows = [];
  if (fresh.length)
    for (const p of all.filter((x) => x.kind === "flow")) {
      let text = "";
      try {
        text = readFileSync(p.file, "utf8");
      } catch {
        continue;
      }
      const hit = fresh.filter((n) => names(text, n));
      if (hit.length) flows.push({ id: p.id, mentions: hit });
    }
  return { links: out, flows };
}

// --- Context: the module a person is changing, and what leans on it --------------------------------------------

// The lead of each bullet in a section (`- Payments — charges the order. [code: x]` → `Payments`).
const leads = (text) =>
  String(text ?? "")
    .split(/\r?\n/)
    .filter((l) => /^\s*[-*]\s+\S/.test(l))
    .map((l) => l.replace(/^\s*[-*]\s+/, "").split(/\s+[—–-]\s+|:/)[0].replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").trim())
    .filter(Boolean);
// A bullet as a person reads it: the line without its source tags.
const plain = (l) => l.replace(/^\s*[-*]\s+/, "").replace(/\s*\[(code|req|told):[^\]]*\]/gi, "").replace(/\s*\|\s*$/, "").trim();
const bullets = (text) => String(text ?? "").split(/\r?\n/).filter((l) => /^\s*[-*]\s+\S/.test(l) && !/^\s*[-*]\s+</.test(l));

// For files being changed, newest first: the module each belongs to, what its page says it is for and the
// rules it keeps, what it connects to, and what uses it. "Used by" joins the page's own list with every
// import into the module found in the workspace now, so it answers even before the brain has a page, and
// it shows which of them the page does not list yet. Reads at most `limit` files for that scan.
export function context(ws, files, { limit = 6000, max = 3 } = {}) {
  const root = resolve(ws);
  const all = pages(ws);
  const ownerOf = owners(ws, all);
  const states = new Map(status(ws).map((p) => [p.id, p]));
  const groups = new Map();
  const unmapped = [];
  for (const f of files) {
    const rel = toPosix(isAbsolute(f) ? relative(root, f) : f).replace(/^\.\//, "");
    const o = ownerOf(rel);
    if (!o) {
      unmapped.push(rel);
      continue;
    }
    const k = o.page ?? `candidate:${o.name}`;
    if (!groups.has(k)) groups.set(k, { owner: o, files: [] });
    groups.get(k).files.push(rel);
  }
  const touched = [...groups.values()].slice(0, max);
  // One pass over the workspace's code for the imports into any of them.
  const scan = touched.length ? edges(root, codeFiles(root, ["."]), ownerOf, limit) : { edges: [], partial: false };
  const modules = touched.map(({ owner, files: mine }) => {
    const s = owner.file ? sections(owner.file) : {};
    let text = "";
    try {
      text = owner.file ? readFileSync(owner.file, "utf8") : "";
    } catch {
      /* unreadable page: shown as no page */
    }
    const recorded = leads(s["Used by"]);
    const live = [...new Set(scan.edges.filter((e) => e.to === owner).map((e) => e.from.name))];
    const usedBy = [
      ...recorded.map((name) => ({ name, recorded: true, live: live.some((l) => moduleKey(l) === moduleKey(name)) })),
      ...live.filter((l) => !recorded.some((r) => moduleKey(r) === moduleKey(l))).map((name) => ({ name, recorded: false, live: true })),
    ];
    const st = owner.page ? states.get(owner.page) : null;
    return {
      name: owner.name,
      page: owner.page,
      area: owner.area ?? null,
      title: owner.page ? (all.find((p) => p.id === owner.page)?.title ?? null) : null,
      purpose: owner.page ? (all.find((p) => p.id === owner.page)?.purpose ?? null) : null,
      rules: bullets(s["Business rules"]).slice(0, 3).map(plain),
      connectsTo: leads(s["Connects to"]),
      usedBy,
      assumed: (text.match(/\[assumed\]/gi) ?? []).length,
      gaps: bullets(s["Gaps & questions"]).length,
      state: st?.state ?? null,
      behindFiles: st?.changed?.length ?? 0,
      files: mine,
    };
  });
  return { modules, unmapped, partial: scan.partial };
}

// --- Digest: what a business study is assembled from ----------------------------------------------------------

function sections(file) {
  let text;
  try {
    text = readFileSync(file, "utf8").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  } catch {
    return {};
  }
  const heads = [...text.matchAll(/^##\s+(.+?)\s*$/gm)];
  return Object.fromEntries(
    heads.map((h, i) => [h[1], text.slice(h.index + h[0].length, i + 1 < heads.length ? heads[i + 1].index : text.length).trim()]),
  );
}

// Everything a study needs, so the model assembles from the brain instead of re-reading the code: each
// page's sections and freshness, every `[assumed]` line (they get their own chapter, never the
// narrative), the requirement IDs the pages cite, and the code modules no page covers yet.
export function digest(ws) {
  const all = status(ws);
  const assumed = [];
  const requirements = new Set();
  for (const p of all) {
    let text = "";
    try {
      text = readFileSync(p.file, "utf8");
    } catch {
      continue;
    }
    for (const l of text.split(/\r?\n/)) {
      if (/\[assumed\]/i.test(l)) assumed.push({ page: p.id, line: l.replace(/^\s*[-*]\s*/, "").trim() });
      for (const m of l.matchAll(/\[req:\s*([^\]]+)\]/gi)) for (const id of m[1].split(/[,\s]+/).filter(Boolean)) requirements.add(id);
    }
  }
  const coveredPaths = all.flatMap(wsPaths);
  const overlaps = (q) => coveredPaths.some((c) => q === c || q.startsWith(c + "/") || c.startsWith(q + "/"));
  return {
    workspace: basename(memoryRoot(resolve(ws))),
    pages: all.map(({ file, repos, ...p }) => ({ ...p, sections: sections(file) })),
    assumed,
    requirements: [...requirements].sort(),
    uncovered: workspaceModules(ws)
      .filter((c) => !c.paths.some(overlaps))
      .map(({ name, paths, files }) => ({ name, paths, files })),
  };
}

// `"brain": { "enabled": false }` in aidlc.config.json switches the brain off for a workspace: no
// session line, and the pipeline and the other commands stop growing it.
export const enabled = (ws) => tryJson(join(resolve(ws), ".claude", "aidlc.config.json"))?.brain?.enabled !== false;

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
      const want = pageOrThrow(ws, name).id;
      const p = status(ws).find((s) => s.id === want);
      const cmds = diffCommands(p);
      out(
        { page: p.id, state: p.state, changed: p.changed ?? [], diff: cmds },
        [`${p.id}: ${p.state}`, ...(p.changed ?? []).map((f) => `  ${f}`), ...cmds.map((c) => `read: ${c}`)].join("\n"),
      );
    } else if (cmd === "stamp") {
      if (!name) throw new Error("usage: brain.mjs stamp <workspace> <page>");
      const r = stamp(ws, name);
      out(r, `${r.page} checked @${r.checked}`);
    } else if (cmd === "move") {
      const area = positional[3];
      if (!name || !area) throw new Error("usage: brain.mjs move <workspace> <page> <area | .>");
      const r = move(ws, name, area);
      writeIndex(ws);
      out(r, r.from === r.to ? `${r.to} is already there` : `${r.from} → ${r.to}`);
    } else if (cmd === "index") {
      const file = writeIndex(ws);
      out({ file }, file);
    } else if (cmd === "which") {
      const r = which(ws, positional.slice(2));
      out(
        r,
        [
          ...r.pages.map((p) => `page ${p.id}: ${p.files.join(", ")}`),
          ...r.candidates.map((c) => `no page yet — module "${c.name}" (paths: ${c.paths.join(", ")}): ${c.files.join(", ")}`),
          r.unmapped.length ? `not in any module: ${r.unmapped.join(", ")}` : "",
        ]
          .filter(Boolean)
          .join("\n") || "(no files given)",
      );
    } else if (cmd === "context") {
      const r = context(ws, positional.slice(2));
      out(
        r,
        r.modules
          .map((m) =>
            [
              `${m.page ?? `${m.name} (no page yet)`}${m.state && m.state !== "current" ? ` · ${m.state}` : ""}${m.purpose ? ` — ${m.purpose}` : ""}`,
              ...m.rules.map((x) => `  rule: ${x}`),
              m.usedBy.length ? `  used by: ${m.usedBy.map((u) => `${u.name}${u.recorded || !m.page ? "" : " (not on the page)"}`).join(", ")}` : "",
              `  files: ${m.files.join(", ")}`,
            ]
              .filter(Boolean)
              .join("\n"),
          )
          .join("\n") || "(those files are in no module)",
      );
    } else if (cmd === "links") {
      const r = links(ws, positional.slice(2));
      const where = (name, page) => (page ? `${page}` : `${name} (no page yet)`);
      const line = (l) => {
        const missing = [
          !l.forward && `${where(l.from, l.fromPage)} → add under "Connects to": ${l.to}`,
          !l.reverse && `${where(l.to, l.toPage)} → add under "Used by": ${l.from}`,
        ].filter(Boolean);
        return `${l.from} → ${l.to}  [code: ${l.file}] imports ${l.import}\n  ${missing.length ? missing.join("\n  ") : "on both pages"}`;
      };
      out(
        r,
        [
          ...r.links.map(line),
          ...r.flows.map((f) => `check flow ${f.id} (names ${f.mentions.join(", ")}): did this add a step?`),
        ].join("\n") || "(no imports into other modules)",
      );
    } else if (cmd === "digest") {
      const d = digest(ws);
      out(
        d,
        `${d.pages.length} page(s) · ${d.pages.filter((p) => NEEDS_REFRESH.has(p.state)).length} behind · ` +
          `${d.assumed.length} assumption(s) to confirm · ${d.requirements.length} requirement(s) cited · ` +
          `${d.uncovered.length} code module(s) with no page${d.uncovered.length ? `: ${d.uncovered.map((c) => c.name).join(", ")}` : ""}`,
      );
    } else {
      console.error("usage: brain.mjs <init|modules|status|changes|stamp|move|index|which|links|context|digest> <workspace> [page | files…] [--json]");
      process.exit(2);
    }
  } catch (e) {
    console.error(`brain: ${e.message}`);
    process.exit(1);
  }
}
