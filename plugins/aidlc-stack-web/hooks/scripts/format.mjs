#!/usr/bin/env node
// PostToolUse[Edit|Write] — format the edited file with the project's own Prettier
// config, if one exists. Silent no-op otherwise. Never fails the tool call.
//
// This hook ships with the WEB STACK PACK, not with core: it is Prettier- and
// npm-specific by nature, and core must not assume a JavaScript toolchain. A workspace
// with only `aidlc` installed simply has no formatting hook, which is correct — its
// gate still runs whatever formatter the project actually declares
// (`pipeline.gates.verify`).
//
// Config resolution walks UP from the EDITED FILE's directory, not from the session
// cwd. In a poly workspace cwd is the control plane and the Prettier config lives in
// the product repo, so a cwd-anchored lookup found nothing and the hook was **silently
// inert for every poly run** — the same cwd-anchoring mistake F50 fixed in env-guard.
// Prettier is then invoked from the directory that owns the config, so its ignore files
// and relative settings resolve the way the repo means them to.
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, dirname, resolve, extname } from "node:path";

let data;
try {
  data = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.exit(0);
}

const file = (data.tool_input && data.tool_input.file_path) || "";
const cwd = data.cwd || process.cwd();
if (!file) process.exit(0);

// Only code files; leave pipeline/backlog markdown untouched (formatting would churn diffs).
const fwd = file.replace(/\\/g, "/");
if (/\/(\.aidlc|backlog|\.claude)\//.test(fwd)) process.exit(0);
const exts = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".css", ".scss", ".html", ".yml", ".yaml"]);
if (!exts.has(extname(file).toLowerCase())) process.exit(0);

const CONFIG_NAMES = [
  ".prettierrc",
  ".prettierrc.json",
  ".prettierrc.json5",
  ".prettierrc.js",
  ".prettierrc.cjs",
  ".prettierrc.mjs",
  ".prettierrc.yml",
  ".prettierrc.yaml",
  ".prettierrc.toml",
  "prettier.config.js",
  "prettier.config.cjs",
  "prettier.config.mjs",
];

// Nearest directory at or above `startDir` that declares Prettier — a config file, or a
// `prettier` key in its package.json. Returns "" when the project doesn't use Prettier.
function prettierRoot(startDir) {
  let dir = startDir;
  for (;;) {
    if (CONFIG_NAMES.some((f) => existsSync(join(dir, f)))) return dir;
    const pkg = join(dir, "package.json");
    if (existsSync(pkg)) {
      try {
        if (JSON.parse(readFileSync(pkg, "utf8")).prettier) return dir;
      } catch {
        /* unreadable package.json — keep walking */
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return ""; // filesystem root, no Prettier anywhere above
    dir = parent;
  }
}

const abs = resolve(cwd, file);
const root = prettierRoot(dirname(abs));
if (!root) process.exit(0);

try {
  execSync(`npx --no-install prettier --write "${abs}"`, {
    cwd: root,
    stdio: "ignore",
    timeout: 20000,
  });
} catch {
  // prettier not installed locally, parse error, etc. — never block the pipeline over formatting
}
process.exit(0);
