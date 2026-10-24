// Tests for brain.mjs — module discovery, freshness against git, stamping and the index.
// Requires git on PATH. Every case runs in a temp repo.
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { check, done } from "../../hooks/scripts/lib/testkit.mjs";
import { samePath } from "../../hooks/scripts/lib/paths.mjs";
import { init, brainDir, candidateModules, workspaceModules, status, stamp, findPage, renderIndex, writeIndex, diffCommands, which, digest, enabled } from "./brain.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const tmps = [];
const temp = (p) => {
  const d = mkdtempSync(join(tmpdir(), p));
  tmps.push(d);
  return d;
};
const write = (root, rel, content = "export const x = 1;\n") => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
};
const git = (root, ...args) => execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
const commit = (root, msg) => {
  git(root, "add", "-A");
  git(root, "commit", "-qm", msg);
};
const page = (ws, id, fm, body = "") =>
  write(brainDir(ws), `${id}.md`, `---\n${Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n${body}`);

// --- A small product: a NestJS-style backend, a Next.js front end, shared code ----------------------
const repo = temp("brain-");
git(repo, "init", "-q");
git(repo, "config", "user.email", "t@t.co");
git(repo, "config", "user.name", "t");
write(repo, ".claude/aidlc.config.json", JSON.stringify({ project: { key: "P" } }));
write(repo, "src/modules/orders/orders.service.ts");
write(repo, "src/modules/orders/orders.controller.ts");
write(repo, "src/modules/orders/orders.service.test.ts");
write(repo, "src/modules/payments/payments.service.ts");
write(repo, "src/components/Button.tsx");
write(repo, "src/lib/date.ts");
write(repo, "app/(shop)/cart/page.tsx");
write(repo, "app/api/orders/route.ts");
write(repo, "app/[locale]/page.tsx");
commit(repo, "init");

// --- Discovery ---------------------------------------------------------------------------------------
const mods = candidateModules(repo);
const byName = Object.fromEntries(mods.map((m) => [m.name, m]));
check("finds the feature modules", Object.keys(byName).sort(), ["cart", "orders", "payments"]);
check("one module across layers: orders UI-API + service", byName.orders.paths.sort(), ["app/api/orders", "src/modules/orders"]);
check("route groups are see-through", byName.cart.paths, ["app/(shop)/cart"]);
check("tests do not count as module code", byName.orders.files, 3);

{
  const mono = temp("brain-mono-");
  write(mono, "apps/web/src/features/checkout/Checkout.tsx");
  write(mono, "apps/web/src/features/search/Search.tsx");
  write(mono, "apps/api/src/main.ts");
  write(mono, "packages/ui/src/index.ts");
  const names = candidateModules(mono).map((m) => m.name).sort();
  check("a monorepo app gives way to its features", names, ["api", "checkout", "search", "ui"]);
}
{
  const flat = temp("brain-flat-");
  write(flat, "src/billing/invoice.py");
  write(flat, "src/accounts/user.py");
  check("no containers: top-level source folders", candidateModules(flat).map((m) => m.name), ["accounts", "billing"]);
}

// --- init keeps it out of git ------------------------------------------------------------------------
const dir = init(repo);
check("init creates the folder", existsSync(join(dir, "modules")) && existsSync(join(dir, "flows")), true);
check("the folder ignores itself", readFileSync(join(dir, ".gitignore"), "utf8").trim().endsWith("*"), true);
check("git does not see it", git(repo, "status", "--porcelain", "--", ".aidlc"), "");

// --- Freshness ---------------------------------------------------------------------------------------
page(repo, "modules/orders", { module: "orders", paths: "src/modules/orders, app/api/orders", checked: "" }, "# Orders\n\n## Purpose\nTakes and tracks orders.\n");
page(repo, "modules/payments", { module: "payments", paths: "src/modules/payments", checked: "" }, "# Payments\n");
page(repo, "overview", {}, "# The product\n");
const st = () => Object.fromEntries(status(repo).map((p) => [p.id, p]));
check("a page never stamped", st()["modules/orders"].state, "never-checked");
check("a page with no code paths", st().overview.state, "no-paths");

stamp(repo, "orders");
stamp(repo, "modules/payments");
check("stamped pages are current", [st()["modules/orders"].state, st()["modules/payments"].state], ["current", "current"]);
check("stamp records the commit", st()["modules/orders"].checked, git(repo, "rev-parse", "--short", "HEAD"));

write(repo, "src/modules/orders/orders.service.ts", "export const x = 2;\n");
commit(repo, "teammate changes orders");
check("a teammate's change makes the page behind", st()["modules/orders"].state, "behind");
check("…and names the file", st()["modules/orders"].changed, ["src/modules/orders/orders.service.ts"]);
check("an untouched module stays current", st()["modules/payments"].state, "current");

git(repo, "checkout", "-q", "-b", "feat/x");
write(repo, "src/modules/payments/refund.ts");
commit(repo, "refunds");
stamp(repo, "payments");
git(repo, "checkout", "-q", "-");
check("checked on a branch HEAD does not contain → behind", st()["modules/payments"].state, "off-branch");

page(repo, "modules/ghost", { module: "ghost", paths: "src/ghost", checked: "deadbeef" }, "# Ghost\n");
check("a commit this repo does not have", st()["modules/ghost"].state, "unknown-commit");
check("findPage by bare name", findPage(repo, "ghost").id, "modules/ghost");

// --- A run stamps on its branch; a squash merge must not make the page look stale --------------------
git(repo, "checkout", "-q", "-b", "feat/sq");
write(repo, "src/modules/orders/orders.controller.ts", "export const c = 2;\n");
commit(repo, "orders: new endpoint");
stamp(repo, "orders");
git(repo, "checkout", "-q", "-");
git(repo, "merge", "--squash", "-q", "feat/sq");
git(repo, "commit", "-qm", "squash: orders endpoint");
check("squash-merged: same code under a new commit → current", st()["modules/orders"].state, "current");

// --- which: the pages a change touched, and the module a page does not exist for yet -------------------
{
  const w = which(repo, ["src/modules/orders/orders.service.ts", "app/(shop)/cart/page.tsx", "src/lib/date.ts"]);
  check("which: a covered file names its page", w.pages, [{ id: "modules/orders", files: ["src/modules/orders/orders.service.ts"] }]);
  check("which: an uncovered file names its candidate module", w.candidates.map((c) => [c.name, c.files]), [["cart", ["app/(shop)/cart/page.tsx"]]]);
  check("which: shared code belongs to no module", w.unmapped, ["src/lib/date.ts"]);
}

// --- digest: what a business study is built from -------------------------------------------------------
{
  const f = join(brainDir(repo), "modules", "payments.md");
  writeFileSync(f, readFileSync(f, "utf8") + "\n## Business rules\n- Refunds over 500 need a manager [assumed]\n- Card only [req: P-12]\n");
  const d = digest(repo);
  check("digest: every assumption, with its page", d.assumed, [{ page: "modules/payments", line: "Refunds over 500 need a manager [assumed]" }]);
  check("digest: requirement IDs the pages cite", d.requirements, ["P-12"]);
  check("digest: sections are parsed", d.pages.find((p) => p.id === "modules/payments").sections["Business rules"].includes("Card only"), true);
  check("digest: code modules with no page", d.uncovered.map((c) => c.name), ["cart"]);
}

// --- Index -------------------------------------------------------------------------------------------
const idx = renderIndex(repo);
check("index links each module", idx.includes("[Orders](modules/orders.md)"), true);
check("index carries the purpose", idx.includes("Takes and tracks orders."), true);
check("index says which are current", /Orders.*\| current @/.test(idx), true);
check("index counts what needs a refresh", idx.includes("3 module page(s) · 2 behind the code"), true);
writeIndex(repo);
check("writeIndex writes index.md", existsSync(join(dir, "index.md")), true);
check("index.md is not itself a page", status(repo).some((p) => p.id === "index"), false);

// --- A linked worktree reads the main checkout's brain, and stamps its own branch -----------------------
{
  const wt = join(temp("brain-wt-"), "w");
  git(repo, "worktree", "add", "-q", "-b", "feat/wt", wt);
  check("worktree: same brain as the main checkout", samePath(brainDir(wt), dir), true);
  write(wt, "src/modules/payments/payouts.ts");
  commit(wt, "payouts");
  const r = stamp(wt, "payments");
  check("worktree: stamps the worktree's own commit", r.checked, git(wt, "rev-parse", "--short", "HEAD"));
  check("worktree: current there", status(wt).find((p) => p.id === "modules/payments").state, "current");
  check("…and behind on main, which does not have that code", status(repo).find((p) => p.id === "modules/payments").state, "off-branch");
  git(repo, "worktree", "remove", "--force", wt);
}

// --- Switched off -------------------------------------------------------------------------------------
{
  const off = temp("brain-off-");
  write(off, ".claude/aidlc.config.json", JSON.stringify({ project: { key: "P" }, brain: { enabled: false } }));
  check("brain.enabled: false switches it off", [enabled(off), enabled(repo)], [false, true]);
}

// --- Poly: one module across a backend repo and a frontend repo ------------------------------------------
{
  const ws = temp("brain-poly-");
  write(ws, ".claude/aidlc.config.json", JSON.stringify({ project: { key: "P" }, repos: [{ name: "api", path: "api" }, { name: "web", path: "web" }] }));
  for (const r of ["api", "web"]) {
    mkdirSync(join(ws, r), { recursive: true });
    git(join(ws, r), "init", "-q");
    git(join(ws, r), "config", "user.email", "t@t.co");
    git(join(ws, r), "config", "user.name", "t");
  }
  write(ws, "api/src/modules/auth/auth.service.ts");
  write(ws, "api/src/modules/billing/billing.service.ts");
  write(ws, "web/app/(auth)/login/page.tsx");
  write(ws, "web/src/features/auth/LoginForm.tsx");
  commit(join(ws, "api"), "init");
  commit(join(ws, "web"), "init");

  const auth = workspaceModules(ws).find((m) => m.name === "auth");
  check("poly: same-named candidates merge across repos", [auth.repos, auth.paths], [["api", "web"], ["api/src/modules/auth", "web/src/features/auth"]]);

  page(ws, "modules/auth", { module: "auth", paths: "api/src/modules/auth, web/src/features/auth" }, "# Auth\n");
  const r = stamp(ws, "auth");
  check("poly: a page across repos records a commit per repo", /^api@[0-9a-f]+, web@[0-9a-f]+$/.test(r.checked), true);
  const one = () => status(ws).find((p) => p.id === "modules/auth");
  check("poly: current in both repos", one().state, "current");
  write(ws, "web/src/features/auth/LoginForm.tsx", "export const y = 2;\n");
  commit(join(ws, "web"), "web changes auth");
  check("poly: a change in one repo makes it behind", [one().state, one().changed], ["behind", ["web/src/features/auth/LoginForm.tsx"]]);
  check("poly: the diff to read names the right repo", diffCommands(one()).length === 2 && diffCommands(one())[1].includes("web"), true);
}

// --- The session line ----------------------------------------------------------------------------------
{
  const hook = () =>
    execFileSync("node", [join(HERE, "..", "..", "hooks", "scripts", "session-context.mjs")], {
      input: JSON.stringify({ cwd: repo, source: "startup" }),
      env: { ...process.env, CLAUDE_CONFIG_DIR: join(temp("brain-home-"), ".claude") },
      encoding: "utf8",
    });
  check("session start names the brain and what is behind", /Project brain: .*3 module page\(s\), 2 behind the code \(ghost, payments\)/.test(hook()), true);
  const cfgFile = join(repo, ".claude", "aidlc.config.json");
  const cfg = readFileSync(cfgFile, "utf8");
  writeFileSync(cfgFile, JSON.stringify({ ...JSON.parse(cfg), brain: { enabled: false } }));
  check("…and says nothing when the brain is switched off", hook().includes("Project brain"), false);
  writeFileSync(cfgFile, cfg);
}

for (const t of tmps) rmSync(t, { recursive: true, force: true });
done();
