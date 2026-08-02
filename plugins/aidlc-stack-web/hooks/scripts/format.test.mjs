// Config-resolution tests for format.mjs. The hook shells out to `npx prettier`, which
// needs a real install, so these assert the decision the hook makes — *which directory
// owns the Prettier config for this file, if any* — rather than the formatting itself.
// That decision is the part that was wrong: a cwd-anchored lookup made the hook silently
// inert in every poly workspace.
//
// Run: `node format.test.mjs` (sibling hook) or `node format.test.mjs <path>`.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), "format.mjs");

// Re-create the hook's resolver from its own source, so the test tracks the shipped
// implementation rather than a copy that can drift from it.
const src = readFileSync(HOOK, "utf8");
const body = src.slice(src.indexOf("const CONFIG_NAMES"), src.indexOf("const abs ="));
const { prettierRoot } = await import(
  "data:text/javascript," +
    encodeURIComponent(
      `import { readFileSync, existsSync } from "node:fs";\nimport { join, dirname } from "node:path";\n${body}\nexport { prettierRoot };`,
    )
);

let fails = 0;
let n = 0;
function check(label, got, expected) {
  n++;
  if (got !== expected) {
    fails++;
    console.log(`FAIL [${label}]\n       expected: ${expected}\n       got:      ${got}`);
  } else console.log(`ok   [${label}]`);
}

const roots = [];
function scratch() {
  const d = mkdtempSync(join(tmpdir(), "fmt-"));
  roots.push(d);
  return d;
}

// --- poly: control plane holds no config; the product repo does. -----------------
{
  const ws = scratch();
  mkdirSync(join(ws, "api", "src"), { recursive: true });
  writeFileSync(join(ws, "api", ".prettierrc.json"), "{}");
  writeFileSync(join(ws, "api", "src", "a.ts"), "x");
  check("poly — config found in the product repo", prettierRoot(join(ws, "api", "src")), join(ws, "api"));
}

// --- mono: config at the repo root, file nested. ---------------------------------
{
  const ws = scratch();
  mkdirSync(join(ws, "src", "deep", "deeper"), { recursive: true });
  writeFileSync(join(ws, ".prettierrc"), "{}");
  check("mono — walks up from a nested file", prettierRoot(join(ws, "src", "deep", "deeper")), ws);
}

// --- monorepo: the package's own config wins over the root's. --------------------
{
  const ws = scratch();
  mkdirSync(join(ws, "packages", "web", "src"), { recursive: true });
  writeFileSync(join(ws, ".prettierrc"), "{}");
  writeFileSync(join(ws, "packages", "web", "prettier.config.mjs"), "export default {}");
  check(
    "monorepo — nearest config wins",
    prettierRoot(join(ws, "packages", "web", "src")),
    join(ws, "packages", "web"),
  );
}

// --- package.json `prettier` key counts as a config. -----------------------------
{
  const ws = scratch();
  mkdirSync(join(ws, "src"), { recursive: true });
  writeFileSync(join(ws, "package.json"), JSON.stringify({ name: "x", prettier: { semi: false } }));
  check("package.json prettier key", prettierRoot(join(ws, "src")), ws);
}

// --- package.json WITHOUT the key is not a config; keep walking. -----------------
{
  const ws = scratch();
  mkdirSync(join(ws, "api", "src"), { recursive: true });
  writeFileSync(join(ws, ".prettierrc"), "{}");
  writeFileSync(join(ws, "api", "package.json"), JSON.stringify({ name: "api" }));
  check("package.json without the key keeps walking up", prettierRoot(join(ws, "api", "src")), ws);
}

// --- malformed package.json must not throw; keep walking. ------------------------
{
  const ws = scratch();
  mkdirSync(join(ws, "api", "src"), { recursive: true });
  writeFileSync(join(ws, ".prettierrc"), "{}");
  writeFileSync(join(ws, "api", "package.json"), "{ not json");
  check("malformed package.json is survivable", prettierRoot(join(ws, "api", "src")), ws);
}

// --- no Prettier anywhere → "" (the hook no-ops). --------------------------------
{
  const ws = scratch();
  mkdirSync(join(ws, "src"), { recursive: true });
  check("no Prettier anywhere → no-op", prettierRoot(join(ws, "src")), "");
}

for (const d of roots) rmSync(d, { recursive: true, force: true });

console.log(`\n${n - fails}/${n} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
