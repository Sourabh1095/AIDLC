// Tests for the reuse tools — catalog.mjs (what exists) and dup-check.mjs (what a branch copied).
// Run: `node reuse.test.mjs`. Requires git on PATH.
//
// The scenario is the one the tools exist for: a repo that already has a date formatter, a
// pagination hook, a Button and a user factory, and a branch that re-writes the formatter under a
// new name, copies a table block from one feature into another, and pastes the same block twice.
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import {
  extractExports, buildCatalog, queryCatalog, renderMarkdown, namesAlike, isSharedFile, similarOnBranch, canonical, stem,
} from "./catalog.mjs";
import { findClones, normalizeLine, mergeBase } from "./dup-check.mjs";
import { check, done } from "../../hooks/scripts/lib/testkit.mjs";

const names = (xs) => xs.map((x) => x.name);

// ---------------------------------------------------------------- extraction, per language
check("ts: function, hook, component, type, const, class", names(extractExports(
  [
    "/** Formats a date for display. Uses the user's locale. */",
    "export function formatDate(d: Date, fmt = 'short'): string {",
    "export const usePagination = (total: number) => {",
    "export function Button(props: ButtonProps) {",
    "export interface ButtonProps { variant: string }",
    "export const MAX_PAGE_SIZE = 100;",
    "export default class ApiClient {",
    "export { a, b as c } from './x';",
    "export { helper, other as renamed };",
  ].join("\n"),
  "src/components/ui/button.tsx",
)), ["formatDate", "usePagination", "Button", "ButtonProps", "MAX_PAGE_SIZE", "ApiClient", "helper", "renamed"]);
check("ts: kinds", extractExports("export const usePagination = () => 1\nexport function Button() {}\nexport const MAX = 1", "x.tsx").map((e) => e.kind), ["hook", "component", "constant"]);
check("ts: doc comment's first sentence", extractExports("/** Formats a date for display. Locale-aware. */\nexport function formatDate(d) {}", "a.ts")[0].doc, "Formats a date for display.");
check("ts: signature", extractExports("export function formatDate(d: Date, fmt = 'short'): string {", "a.ts")[0].sig, "(d: Date, fmt = 'short')");
check("py: public defs and classes, fixtures, docstrings", extractExports(
  ['def format_date(d):', '    """Format a date."""', "def _private():", "class UserFactory:", "@pytest.fixture", "def db_session():"].join("\n"),
  "tests/conftest.py",
).map((e) => [e.name, e.kind]), [["format_date", "function"], ["UserFactory", "class"], ["db_session", "fixture"]]);
check("go: exported funcs, methods and types only", names(extractExports(
  ["func FormatDate(t time.Time) string {", "func helper() {}", "func (c *Client) Get(url string) error {", "type Client struct {"].join("\n"),
  "pkg/x.go",
)), ["FormatDate", "Client.Get", "Client"]);
check("java/cs: public types and static methods", names(extractExports(
  ["public final class DateUtils {", "  public static String format(Date d) {", "  private static void hidden() {}"].join("\n"),
  "src/util/DateUtils.java",
)), ["DateUtils", "format"]);
check("rust: pub items", names(extractExports("pub fn parse(s: &str) -> u32 {\nfn private() {}\npub struct Config {", "src/lib.rs")), ["parse", "Config"]);

// ---------------------------------------------------------------- what counts as shared
check("shared: components/ui", isSharedFile("src/components/ui/button.tsx"), true);
check("shared: lib, hooks, utils", [isSharedFile("src/lib/date.ts"), isSharedFile("src/hooks/x.ts"), isSharedFile("app/utils/y.py")], [true, true, true]);
check("shared: test fixtures and conftest", [isSharedFile("tests/fixtures/users.ts"), isSharedFile("tests/conftest.py")], [true, true]);
check("not shared: a feature screen", isSharedFile("src/app/orders/page.tsx"), false);
check("shared: configured path", isSharedFile("src/billing/money.ts", ["src/billing"]), true);

// ---------------------------------------------------------------- name matching
check("stem keeps status", stem("status"), "status");
check("synonyms: pager ~ pagination", canonical("pager") === canonical("pagination"), true);
check("synonyms: add does not swallow address", canonical("address") === canonical("add"), false);
check("alike: formatDateLabel ~ formatDate", namesAlike("formatDateLabel", "formatDate"), true);
check("alike: usePager ~ usePagination", namesAlike("usePager", "usePagination"), true);
check("alike: fetchUser ~ getUser", namesAlike("fetchUser", "getUser"), true);
check("not alike: formatDate vs parseUrl", namesAlike("formatDate", "parseUrl"), false);
check("not alike: useAuth vs useTheme", namesAlike("useAuth", "useTheme"), false);
check("not alike: a shared prefix word is not a shared meaning", namesAlike("isAidlcConfig", "isEnvFile"), false);

// ---------------------------------------------------------------- a real repo
const repo = mkdtempSync(join(tmpdir(), "reuse-"));
const w = (p, s) => {
  mkdirSync(dirname(join(repo, p)), { recursive: true });
  writeFileSync(join(repo, p), s);
};
const git = (...a) => execFileSync("git", a, { cwd: repo, stdio: ["ignore", "pipe", "ignore"] }).toString();
git("init");
git("symbolic-ref", "HEAD", "refs/heads/main");
git("config", "user.email", "t@t.co");
git("config", "user.name", "test");

w("src/lib/date.ts", "/** Formats a date for display. */\nexport function formatDate(d: Date): string {\n  return d.toISOString();\n}\n");
w("src/hooks/use-pagination.ts", "/** Client-side pagination over a list. */\nexport function usePagination(total: number, pageSize = 20) {\n  return { pages: Math.ceil(total / pageSize) };\n}\n");
w("src/components/ui/button.tsx", "/** The primary action button. */\nexport function Button(props: { label: string }) {\n  return null;\n}\n");
w("tests/fixtures/users.ts", "/** Builds a user for tests. */\nexport const makeUser = (o = {}) => ({ id: 1, ...o });\n");
const table = (entity) =>
  [
    `export function render${entity}Table(rows) {`,
    "  const sorted = rows.slice().sort((a, b) => a.createdAt - b.createdAt);",
    "  const visible = sorted.filter((r) => !r.archived && r.ownerId === currentUser.id);",
    "  const page = visible.slice(offset, offset + pageSize);",
    "  const header = columns.map((c) => c.label.toUpperCase()).join(' | ');",
    "  const body = page.map((r) => columns.map((c) => String(r[c.key] ?? '')).join(' | '));",
    "  const footer = `${page.length} of ${visible.length} shown`;",
    "  const total = visible.reduce((sum, r) => sum + (r.amount || 0), 0);",
    "  log.debug('rendered table', { rows: page.length, total });",
    "  return [header, ...body, footer, 'total: ' + total].join('\\n');",
    "}",
  ].join("\n") + "\n";
w("src/features/users/users-table.ts", table("Users"));
git("add", "-A");
git("commit", "-m", "init");
git("checkout", "-b", "feature/x");

// The branch: a re-written formatter, a copied table, and one block pasted twice.
w("src/features/orders/format.ts", "export function formatDateLabel(d: Date): string {\n  return d.toLocaleDateString();\n}\n");
w("src/features/orders/orders-table.ts", table("Orders"));
const twice = [
  "export function summarize(items) {",
  "  const open = items.filter((i) => i.status === 'open');",
  "  const late = open.filter((i) => i.dueAt < Date.now());",
  "  const byOwner = groupBy(late, (i) => i.ownerId);",
  "  const counts = Object.entries(byOwner).map(([k, v]) => [k, v.length]);",
  "  const worst = counts.sort((a, b) => b[1] - a[1]).slice(0, 5);",
  "  const label = worst.map(([k, c]) => k + ': ' + c).join(', ');",
  "  metrics.gauge('late_items', late.length);",
  "  return { open: open.length, late: late.length, label };",
  "}",
].join("\n");
w("src/features/a/summary.ts", twice + "\n");
w("src/features/b/summary.ts", twice.replace("summarize", "summarizeB") + "\n");
git("add", "src/features/orders/format.ts", "src/features/orders/orders-table.ts");
git("commit", "-m", "wip"); // a/ and b/ stay untracked: the check must see uncommitted work too

const cat = buildCatalog(repo, { name: "web" });
check("catalog: lists the shared symbols", names(cat.entries).sort(), ["Button", "formatDate", "makeUser", "usePagination"]);
check("catalog: feature code is not catalogued", cat.entries.some((e) => e.file.includes("features/")), false);
check("catalog: markdown names location and purpose", renderMarkdown(cat).includes("`formatDate(d: Date)` · function · src/lib/date.ts:2 — Formats a date for display."), true);
check("query: pagination", queryCatalog(cat, ["pagination"])[0]?.name, "usePagination");
check("query: a synonym finds it too", queryCatalog(cat, ["pager"])[0]?.name, "usePagination");
check("query: date formatting", queryCatalog(cat, ["format", "the", "date"])[0]?.name, "formatDate");
check("query: test data", queryCatalog(cat, ["user", "factory"])[0]?.name, "makeUser");
check("query: nothing relevant", queryCatalog(cat, ["websocket"]).length, 0);

const base = mergeBase(repo, "main");
const sim = similarOnBranch(repo, base, { name: "web" });
const dupe = sim.findings.find((f) => f.kind === "possible-duplicate");
check("similar: the re-written formatter is flagged", dupe && [dupe.name, dupe.matches[0].name], ["formatDateLabel", "formatDate"]);

const clones = findClones(repo, base, { minLines: 6 });
const existing = clones.find((c) => c.kind === "existing");
check("dup-check: the copied table is a copy of existing code", existing && [existing.file, existing.other.file], ["src/features/orders/orders-table.ts", "src/features/users/users-table.ts"]);
check("dup-check: the clone covers the block, not one window", existing && existing.lines >= 8, true);
check("dup-check: the block pasted twice is a copy within the change", clones.filter((c) => c.kind === "within-change").length, 1);
check("dup-check: literals do not hide a copy", normalizeLine("  const x = 'users' + 42;"), normalizeLine("const x = \"orders\" + 7;"));
check("dup-check: braces and imports are not significant", [normalizeLine("  });"), normalizeLine("import { a } from 'b';")], ["", ""]);
check("dup-check: fuzzy folds identifiers", normalizeLine("const users = load(id);", true), normalizeLine("const orders = fetch(key);", true));

rmSync(repo, { recursive: true, force: true });
done();
