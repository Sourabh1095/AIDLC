#!/usr/bin/env node
// The reuse catalog: what a repo already has that new code should use instead of re-writing.
//
//   node catalog.mjs build   <repoRoot> [--name <repo>] [--out <dir>] [--config <aidlc.config.json>]
//   node catalog.mjs query   <repoRoot> <term...> [--limit 15] [--config …]
//   node catalog.mjs similar <repoRoot> [--base <ref>] [--placement] [--config …]
//
// build   — scan the repo's SHARED code (components, hooks, lib/utils, services and clients, types,
//           validators, errors, test fixtures and factories, monorepo packages) and write
//           <out>/<repo>.md + <repo>.json: every exported symbol with its kind, signature, location
//           and the first line of its doc comment.
// query   — the symbols most relevant to some words ("pagination table", "date format"), ranked.
//           This is what goes into a planner's or implementer's brief.
// similar — exports ADDED on this branch (vs --base, default the merge-base with origin's default
//           branch, else HEAD~1) that look like something the repo already has. Exit 1 when any are
//           found, so it can stand in a gate.
//
// WHY THIS EXISTS. The pipeline told the implementer, in one clause, to "reuse existing utilities
// before writing new ones" — and gave it nothing to reuse FROM. An agent that has not seen
// `src/lib/date.ts` writes `formatDateLabel` inline; one that has not seen `usePagination` writes it
// again per screen. Telling a model to search is weak; handing it the list is strong. Context7 does
// this for libraries; this does it for the project's own code.
//
// WHY A SCRIPT. The list must be complete and current, and a model asked to "look around" samples.
// This is deterministic, fast (it reads only shared areas), language-aware enough for the common
// stacks (TS/JS, Python, Go, Java/Kotlin, C#, Rust, PHP, Ruby) and dependency-free, like every
// script in this plugin. It is regenerated on demand rather than committed: derived data in git is
// churn on every branch and a merge conflict on every second one.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve, extname, basename, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Directories never worth reading.
export const IGNORED_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", ".next", ".nuxt", ".svelte-kit", "coverage", "vendor",
  "target", "bin", "obj", ".venv", "venv", "env", "__pycache__", ".mypy_cache", ".pytest_cache", ".tox",
  ".gradle", ".idea", ".vscode", ".turbo", ".cache", ".aidlc", ".claude", "storybook-static", "public",
]);

// Folder names that hold code meant to be shared. A file counts as shared when any directory on
// its path has one of these names (case-insensitive), or it sits in a monorepo package.
export const SHARED_DIR_NAMES = new Set([
  "components", "ui", "shared", "common", "core", "lib", "libs", "utils", "util", "utilities", "helpers",
  "hooks", "composables", "services", "clients", "client", "api", "sdk", "types", "typings", "interfaces",
  "models", "constants", "validators", "validation", "schemas", "errors", "exceptions", "middleware",
  "middlewares", "guards", "interceptors", "pipes", "decorators", "filters", "store", "stores", "fixtures",
  "factories", "test-utils", "testing", "mocks", "__mocks__", "support", "pkg", "internal", "packages",
]);
// Test-support files that are shared whatever folder they sit in.
const SHARED_FILE_RE = /^(conftest\.py|.*(fixture|factory|factories|test-utils|testutils|helpers?)\.[a-z]+)$/i;

const LANG = {
  ".ts": "js", ".tsx": "js", ".js": "js", ".jsx": "js", ".mjs": "js", ".cjs": "js", ".mts": "js", ".cts": "js",
  ".py": "py", ".go": "go", ".java": "java", ".kt": "kt", ".cs": "cs", ".rs": "rs", ".php": "php", ".rb": "rb",
};

const LIMITS = { files: 6000, perFile: 40, entries: 5000, fileBytes: 400_000 };

const toPosix = (p) => p.replace(/\\/g, "/");

// ---------------------------------------------------------------------------------------------
// Discovery

function sharedPathMatchers(config) {
  const extra = config?.reuse?.sharedPaths ?? [];
  return extra.map((p) => toPosix(String(p)).replace(/\/+$/, "").toLowerCase());
}

export function isSharedFile(relPath, extraPaths = []) {
  const p = toPosix(relPath);
  const lower = p.toLowerCase();
  if (extraPaths.some((x) => lower === x || lower.startsWith(x + "/"))) return true;
  const parts = lower.split("/");
  const file = parts.pop();
  if (SHARED_FILE_RE.test(file)) return true;
  return parts.some((d) => SHARED_DIR_NAMES.has(d));
}

function* walk(root, dir = root) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (IGNORED_DIRS.has(e.name) || e.name.startsWith(".")) continue;
      yield* walk(root, join(dir, e.name));
    } else if (e.isFile() && LANG[extname(e.name).toLowerCase()]) {
      yield join(dir, e.name);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Extraction

// A file of tests (as opposed to test SUPPORT — fixtures, factories and helpers are shared code).
const isTestFile = (rel) => /\.(test|spec)\.[a-z]+$|(^|\/)test_[^/]*\.py$|_test\.(go|py)$/i.test(rel);

function kindForJs(name, decl, file) {
  if (/^(interface|type|enum)$/.test(decl)) return "type";
  if (decl === "class") return "class";
  if (/^use[A-Z0-9]/.test(name)) return "hook";
  if (/^[A-Z][A-Z0-9_]+$/.test(name)) return "constant";
  if (/^[A-Z][A-Za-z0-9]*$/.test(name) && /\.(tsx|jsx)$/.test(file)) return "component";
  return "function";
}

// The first sentence of the comment block directly above line `i`.
function docAbove(lines, i, style) {
  let j = i - 1;
  while (j >= 0 && /^\s*(@\w|\[[^\]]*\]\s*$)/.test(lines[j])) j--; // decorators / attributes
  const out = [];
  if (j >= 0 && /\*\/\s*$/.test(lines[j])) {
    while (j >= 0 && !/\/\*/.test(lines[j])) out.unshift(lines[j--]);
    if (j >= 0) out.unshift(lines[j]);
  } else {
    const prefix = style === "rb" || style === "py" ? /^\s*#/ : /^\s*(\/\/\/?|#)/;
    while (j >= 0 && prefix.test(lines[j])) out.unshift(lines[j--]);
  }
  return firstSentence(out.join(" ").replace(/\/\*\*?|\*\/|^\s*\*|\s\*\s|\/\/\/?|#/g, " "));
}

function docBelow(lines, i) {
  // Python docstring on the line(s) after the def/class.
  const next = (lines[i + 1] || "").trim();
  const m = next.match(/^[rbuRBU]?("""|''')(.*)$/);
  if (!m) return "";
  let text = m[2];
  if (!text.includes(m[1])) text += " " + (lines[i + 2] || "").trim();
  return firstSentence(text.split(m[1])[0]);
}

function firstSentence(s) {
  const t = s.replace(/\s+/g, " ").replace(/@\w+.*$/, "").trim();
  const m = t.match(/^(.+?[.!?])(\s|$)/);
  return (m ? m[1] : t).slice(0, 120);
}

const sigOf = (line, name) => {
  const i = line.indexOf(name);
  const open = line.indexOf("(", i);
  if (open < 0) return "";
  let depth = 0;
  for (let k = open; k < line.length; k++) {
    if (line[k] === "(") depth++;
    else if (line[k] === ")" && --depth === 0) return line.slice(open, k + 1).replace(/\s+/g, " ").slice(0, 90);
  }
  return line.slice(open).replace(/\s+/g, " ").slice(0, 60) + "…";
};

export function extractExports(text, file) {
  const lang = LANG[extname(file).toLowerCase()];
  const lines = text.split(/\r?\n/);
  const out = [];
  const push = (name, kind, i, sig = "", doc = "") => {
    if (out.length < LIMITS.perFile) out.push({ name, kind, line: i + 1, sig, doc });
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;
    if (lang === "js") {
      if (/^\s*export\s+(\*|\{[^}]*\})\s+from\b/.test(line)) continue; // barrel re-export: the source is listed
      if ((m = line.match(/^\s*export\s+(?:default\s+)?(?:declare\s+)?(?:async\s+)?(function\*?|class|abstract\s+class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/))) {
        const decl = m[1].replace(/^abstract\s+/, "").replace("*", "");
        const kind = kindForJs(m[2], decl, file);
        push(m[2], kind, i, kind === "function" || kind === "hook" || kind === "component" ? sigOf(line, m[2]) : "", docAbove(lines, i, "js"));
      } else if ((m = line.match(/^\s*export\s*\{([^}]+)\}\s*;?\s*$/))) {
        for (const part of m[1].split(",")) {
          const name = part.trim().split(/\s+as\s+/).pop().trim();
          if (/^[A-Za-z_$][\w$]*$/.test(name) && name !== "default") push(name, kindForJs(name, "", file), i);
        }
      } else if ((m = line.match(/^\s*(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=/))) {
        push(m[1], kindForJs(m[1], "", file), i, "", docAbove(lines, i, "js"));
      }
    } else if (lang === "py") {
      if ((m = line.match(/^(?:async\s+)?def\s+([A-Za-z]\w*)\s*\(/))) {
        const fixture = /^\s*@pytest\.fixture/.test(lines[i - 1] || "") || /^\s*@pytest\.fixture/.test(lines[i - 2] || "");
        push(m[1], fixture ? "fixture" : "function", i, sigOf(line, m[1]), docBelow(lines, i) || docAbove(lines, i, "py"));
      } else if ((m = line.match(/^class\s+([A-Za-z]\w*)/))) push(m[1], "class", i, "", docBelow(lines, i) || docAbove(lines, i, "py"));
    } else if (lang === "go") {
      if ((m = line.match(/^func\s+(?:\(\s*\w+\s+\*?(\w+)\s*\)\s+)?([A-Z]\w*)\s*\(/)))
        push(m[1] ? `${m[1]}.${m[2]}` : m[2], m[1] ? "method" : "function", i, sigOf(line, m[2]), docAbove(lines, i, "go"));
      else if ((m = line.match(/^type\s+([A-Z]\w*)\s+(struct|interface|func|\w)/))) push(m[1], m[2] === "interface" ? "type" : "type", i, "", docAbove(lines, i, "go"));
    } else if (lang === "java" || lang === "kt" || lang === "cs") {
      if ((m = line.match(/^\s*public\s+(?:static\s+|final\s+|abstract\s+|sealed\s+|partial\s+)*(class|interface|enum|record|struct)\s+([A-Z]\w*)/)))
        push(m[2], m[1] === "interface" || m[1] === "enum" ? "type" : "class", i, "", docAbove(lines, i, lang));
      else if ((m = line.match(/^\s*public\s+static\s+(?:[\w<>[\],.?]+\s+)+([A-Za-z]\w*)\s*\(/)))
        push(m[1], "function", i, sigOf(line, m[1]), docAbove(lines, i, lang));
      else if (lang === "kt" && (m = line.match(/^(?:fun|class|object|interface|data\s+class)\s+([A-Za-z]\w*)/)))
        push(m[1], /^fun/.test(line) ? "function" : "class", i, /^fun/.test(line) ? sigOf(line, m[1]) : "", docAbove(lines, i, lang));
    } else if (lang === "rs") {
      if ((m = line.match(/^\s*pub\s+(?:async\s+)?(fn|struct|enum|trait|type)\s+([A-Za-z]\w*)/)))
        push(m[2], m[1] === "fn" ? "function" : "type", i, m[1] === "fn" ? sigOf(line, m[2]) : "", docAbove(lines, i, "rs"));
    } else if (lang === "php") {
      if ((m = line.match(/^\s*(?:final\s+|abstract\s+)?(class|interface|trait|enum)\s+([A-Z]\w*)/))) push(m[2], "class", i, "", docAbove(lines, i, "php"));
      else if ((m = line.match(/^\s*public\s+static\s+function\s+(\w+)\s*\(/))) push(m[1], "function", i, sigOf(line, m[1]), docAbove(lines, i, "php"));
    } else if (lang === "rb") {
      if ((m = line.match(/^\s*(class|module)\s+([A-Z]\w*)/))) push(m[2], "class", i, "", docAbove(lines, i, "rb"));
      else if ((m = line.match(/^\s*def\s+self\.(\w+[?!]?)/))) push(m[1], "function", i, "", docAbove(lines, i, "rb"));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Build

export function readConfig(configPath) {
  try {
    return configPath ? JSON.parse(readFileSync(configPath, "utf8")) : {};
  } catch {
    return {};
  }
}

// Narrowest-wins: a repo entry's `reuse` block overrides the top-level one.
export function reuseSettings(config, repoName) {
  const repo = (config?.repos ?? []).find((r) => r?.name === repoName);
  return { ...(config?.reuse ?? {}), ...(repo?.reuse ?? {}) };
}

function headCommit(root) {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return null;
  }
}

// The area an entry belongs to: its path up to and including the first shared directory name.
function areaOf(rel) {
  const parts = toPosix(rel).split("/");
  for (let i = parts.length - 2; i >= 0; i--) if (SHARED_DIR_NAMES.has(parts[i].toLowerCase())) return parts.slice(0, i + 1).join("/");
  return parts.slice(0, -1).join("/") || ".";
}

export function buildCatalog(root, { name, config } = {}) {
  const settings = reuseSettings(config, name);
  const extra = sharedPathMatchers({ reuse: settings });
  const entries = [];
  let files = 0;
  let truncated = false;
  for (const abs of walk(root)) {
    const rel = toPosix(relative(root, abs));
    if (!isSharedFile(rel, extra) || isTestFile(rel)) continue;
    if (++files > LIMITS.files) {
      truncated = true;
      break;
    }
    let text;
    try {
      if (statSync(abs).size > LIMITS.fileBytes) continue;
      text = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    for (const e of extractExports(text, rel)) {
      entries.push({ ...e, file: rel, area: areaOf(rel) });
      if (entries.length >= LIMITS.entries) {
        truncated = true;
        break;
      }
    }
    if (truncated) break;
  }
  entries.sort((a, b) => a.area.localeCompare(b.area) || a.file.localeCompare(b.file) || a.line - b.line);
  return {
    repo: name || basename(resolve(root)),
    generated: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    commit: headCommit(root),
    files: Math.min(files, LIMITS.files),
    truncated,
    entries,
  };
}

export function renderMarkdown(cat) {
  const lines = [
    `# Reuse catalog — ${cat.repo}`,
    "",
    `generated ${cat.generated}${cat.commit ? ` at ${cat.commit}` : ""} · ${cat.entries.length} exported symbols in ${cat.files} shared files` +
      (cat.truncated ? " · TRUNCATED (limits reached — query rather than read)" : ""),
    "",
    "> Before writing a function, hook, component, client, type, validator or test fixture, look here.",
    "> Use what exists; extend it (a parameter, a prop, a variant) when it almost fits; write new shared",
    "> code only when nothing fits, and put it in the shared area it belongs to. Generated by",
    "> `aidlc:reuse` → catalog.mjs — never edit by hand; regenerate it.",
    "",
  ];
  let area = null;
  for (const e of cat.entries) {
    if (e.area !== area) {
      area = e.area;
      lines.push(`## ${area}`, "");
    }
    lines.push(`- \`${e.name}${e.sig || ""}\` · ${e.kind} · ${e.file}:${e.line}${e.doc ? ` — ${e.doc}` : ""}`);
  }
  return lines.join("\n") + "\n";
}

export function writeCatalog(cat, outDir) {
  mkdirSync(outDir, { recursive: true });
  const base = join(outDir, cat.repo.replace(/[^\w.-]+/g, "_"));
  writeFileSync(base + ".json", JSON.stringify(cat, null, 2) + "\n");
  writeFileSync(base + ".md", renderMarkdown(cat));
  return { json: base + ".json", md: base + ".md" };
}

// ---------------------------------------------------------------------------------------------
// Query

// Split an identifier or phrase into lower-case words: `usePagination` → [use, pagination],
// `format_date-label` → [format, date, label].
export function words(s) {
  return String(s)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1);
}

// Light stemming: plural, -ing and -ed. Conservative on purpose — `status` stays `status`.
export function stem(w) {
  if (w.length <= 3) return w;
  if (/ies$/.test(w)) return w.slice(0, -3) + "y";
  if (/(ss|us|is)$/.test(w)) return w;
  let s = /(x|z|ch|sh)es$/.test(w) ? w.slice(0, -2) : w.replace(/s$/, "");
  if (/ing$/.test(s) && s.length > 5) s = s.slice(0, -3);
  else if (/ed$/.test(s) && s.length > 4) s = s.slice(0, -2);
  return s;
}

// The synonyms that most often separate "the thing I need" from "the name it was given". Each word
// maps to its group's first member. Members of 6+ characters also match as prefixes (`paginat`
// covers pagination and paginated); shorter ones match exactly, because `add` must not swallow
// `address` and `check` must not swallow `checkout`. Deliberately small: the goal is to stop
// `pager` hiding from `pagination`, not to build a search engine.
const SYNONYMS = [
  ["paginat", "paging", "pager", "page"],
  ["fetch", "get", "load", "retriev", "request", "query"],
  ["format", "fmt", "render", "display", "print"],
  ["date", "time", "datetime", "timestamp"],
  ["modal", "dialog", "popup", "overlay"],
  ["button", "btn"],
  ["user", "account", "profile", "member"],
  ["delete", "delet", "remove", "remov", "destroy"],
  ["create", "creat", "add", "new", "insert"],
  ["update", "updat", "edit", "modify", "modif", "patch"],
  ["validat", "valid", "check", "verify", "verif", "assert"],
  ["client", "api", "http", "service", "sdk"],
  ["error", "exception", "fault", "failure", "fail"],
  ["auth", "authenticat", "authoriz", "login", "session", "token", "credential", "signin"],
  ["config", "setting", "option", "env", "preference"],
  ["list", "table", "grid", "collection"],
  ["search", "filter", "find", "lookup"],
  ["notif", "notify", "notification", "toast", "alert", "snackbar"],
  ["upload", "attachment"],
  ["money", "currency", "price", "amount"],
  ["fixture", "factory", "factori", "mock", "fake", "stub", "seed"],
];
const EXACT = new Map();
const PREFIX = [];
for (const group of SYNONYMS)
  for (const w of group) {
    EXACT.set(w, group[0]);
    if (w.length >= 6) PREFIX.push([w, group[0]]);
  }
PREFIX.sort((a, b) => b[0].length - a[0].length);

// The comparison key for a word: its synonym group, else its stem.
export function canonical(w) {
  const s = stem(w);
  if (EXACT.has(w)) return EXACT.get(w);
  if (EXACT.has(s)) return EXACT.get(s);
  for (const [p, g] of PREFIX) if (w.startsWith(p)) return g;
  return s;
}
const keys = (s) => new Set(words(s).map(canonical));

export function queryCatalog(cat, terms, limit = 15) {
  const wanted = [...keys(terms.join(" "))];
  if (!wanted.length) return [];
  const scored = [];
  for (const e of cat.entries) {
    const nameW = keys(e.name);
    const docW = keys(e.doc || "");
    const pathW = keys(e.file);
    let score = 0;
    let hits = 0;
    for (const a of wanted) {
      const best = nameW.has(a) ? 3 : docW.has(a) ? 1.5 : pathW.has(a) ? 1 : 0;
      if (best) hits++;
      score += best;
    }
    if (!hits) continue;
    score *= hits / wanted.length; // reward covering more of the query
    scored.push({ ...e, score: Math.round(score * 100) / 100 });
  }
  return scored.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file)).slice(0, limit);
}

// ---------------------------------------------------------------------------------------------
// Similar: exports added on this branch that look like something that already exists.

function git(root, args) {
  return execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 }).toString();
}

export function defaultBase(root) {
  for (const ref of ["origin/HEAD", "origin/main", "origin/master", "main", "master"]) {
    try {
      return git(root, ["merge-base", "HEAD", ref]).trim();
    } catch {
      /* try the next */
    }
  }
  try {
    return git(root, ["rev-parse", "HEAD~1"]).trim();
  } catch {
    return null;
  }
}

// Name prefixes that say nothing about WHAT a symbol does: every hook starts with `use`, every
// predicate with `is`. Counting them made `isAidlcConfig` look like `isEnvFile`.
const NAME_NOISE = new Set(["is", "has", "can", "should", "use", "set", "do", "make", "to", "on", "with"]);

// Two names describe the same thing when their canonical words overlap by at least half — and at
// least two words are shared, or the shorter name is a single word fully contained in the other.
// `usePager` ~ `usePagination`, `formatDateLabel` ~ `formatDate`, `fetchUser` ~ `getUser`.
export function namesAlike(a, b) {
  const meaningful = (s) => new Set([...keys(s)].filter((w) => !NAME_NOISE.has(w)));
  const A = meaningful(a);
  const B = meaningful(b);
  if (!A.size || !B.size) return false;
  const inter = [...A].filter((w) => B.has(w)).length;
  const jac = inter / (A.size + B.size - inter);
  return (inter >= 2 && jac >= 0.5) || (Math.min(A.size, B.size) === 1 && inter === 1 && jac >= 0.5);
}

// `placement: true` also reports new exported functions and hooks living outside every shared
// area. Off by default: most of those are correctly feature-local (a server action, a page's
// loader), and a check that is usually wrong stops being read. Useful when reviewing a change that
// claims to have added shared code.
export function similarOnBranch(root, base, { config, name, placement = false } = {}) {
  const changed = git(root, ["diff", "--name-only", "--diff-filter=AM", `${base}`, "--"])
    .split(/\r?\n/)
    .filter((f) => f && LANG[extname(f).toLowerCase()]);
  const untracked = git(root, ["ls-files", "--others", "--exclude-standard"])
    .split(/\r?\n/)
    .filter((f) => f && LANG[extname(f).toLowerCase()]);
  const files = [...new Set([...changed, ...untracked])].filter((f) => !isTestFile(f));
  const cat = buildCatalog(root, { name, config });
  const findings = [];
  for (const f of files) {
    let now = "";
    try {
      now = readFileSync(join(root, f), "utf8");
    } catch {
      continue;
    }
    let before = "";
    try {
      before = git(root, ["show", `${base}:${f}`]);
    } catch {
      /* new file */
    }
    const had = new Set(extractExports(before, f).map((e) => e.name));
    for (const e of extractExports(now, f)) {
      if (had.has(e.name) || e.kind === "type" || e.kind === "constant") continue;
      const matches = cat.entries.filter((c) => c.file !== f && (c.name === e.name || namesAlike(c.name, e.name)));
      const shared = isSharedFile(f, sharedPathMatchers({ reuse: reuseSettings(config, name) }));
      if (matches.length) findings.push({ kind: "possible-duplicate", name: e.name, file: f, line: e.line, matches: matches.slice(0, 3) });
      else if (placement && !shared && (e.kind === "hook" || e.kind === "function"))
        findings.push({ kind: "unshared-new-export", name: e.name, file: f, line: e.line, matches: [] });
    }
  }
  return { base, findings };
}

// ---------------------------------------------------------------------------------------------
// CLI

function parseArgs(argv) {
  const flags = {};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) flags[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    else pos.push(argv[i]);
  }
  return { flags, pos };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2);
  const { flags, pos } = parseArgs(rest);
  const root = pos[0] ? resolve(pos[0]) : null;
  if (!cmd || !root || !existsSync(root)) {
    console.error(
      "usage: node catalog.mjs build|query|similar <repoRoot> [terms…] [--name <repo>] [--out <dir>] [--config <aidlc.config.json>] [--base <ref>] [--limit N]",
    );
    process.exit(2);
  }
  const config = readConfig(flags.config);
  const name = typeof flags.name === "string" ? flags.name : undefined;

  if (cmd === "build") {
    const cat = buildCatalog(root, { name, config });
    const out = typeof flags.out === "string" ? resolve(flags.out) : join(root, ".aidlc", "catalog");
    const paths = writeCatalog(cat, out);
    console.log(`catalog: ${cat.entries.length} symbols from ${cat.files} shared files → ${toPosix(paths.md)}${cat.truncated ? " (truncated)" : ""}`);
  } else if (cmd === "query") {
    const terms = pos.slice(1);
    const cat = buildCatalog(root, { name, config });
    const hits = queryCatalog(cat, terms, Number(flags.limit) || 15);
    if (!hits.length) console.log(`no existing symbols match "${terms.join(" ")}" — say so in the plan's Reuse section`);
    for (const h of hits) console.log(`${h.name}${h.sig || ""} · ${h.kind} · ${h.file}:${h.line}${h.doc ? ` — ${h.doc}` : ""}`);
  } else if (cmd === "similar") {
    const base = typeof flags.base === "string" ? flags.base : defaultBase(root);
    if (!base) {
      console.error("similar: no base ref (pass --base <ref>)");
      process.exit(2);
    }
    const { findings } = similarOnBranch(root, base, { config, name, placement: !!flags.placement });
    if (!findings.length) {
      console.log("reuse: no new export resembles an existing one");
      process.exit(0);
    }
    for (const f of findings) {
      if (f.kind === "possible-duplicate")
        console.log(
          `possible duplicate: ${f.name} (${f.file}:${f.line}) resembles ` +
            f.matches.map((m) => `${m.name} (${m.file}:${m.line})`).join(", "),
        );
      else console.log(`new ${f.name} (${f.file}:${f.line}) is exported from outside every shared area — is it feature-local, or does it belong in a shared folder?`);
    }
    process.exit(findings.some((f) => f.kind === "possible-duplicate") ? 1 : 0);
  } else {
    console.error(`unknown command: ${cmd}`);
    process.exit(2);
  }
}
