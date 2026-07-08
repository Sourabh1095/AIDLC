#!/usr/bin/env node
// PostToolUse[Edit|Write] — format the edited file with the project's own Prettier
// config, if one exists. Silent no-op otherwise. Never fails the tool call.
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, extname } from "node:path";

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
if (/\/(\.sdlc|backlog|\.claude)\//.test(fwd)) process.exit(0);
const exts = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".css", ".scss", ".html", ".yml", ".yaml"]);
if (!exts.has(extname(file).toLowerCase())) process.exit(0);

// Only if the project itself uses Prettier.
const hasConfig =
  [".prettierrc", ".prettierrc.json", ".prettierrc.js", ".prettierrc.yml", ".prettierrc.yaml", "prettier.config.js", "prettier.config.mjs"].some(
    (f) => existsSync(join(cwd, f))
  ) ||
  (existsSync(join(cwd, "package.json")) &&
    (() => {
      try {
        return !!JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")).prettier;
      } catch {
        return false;
      }
    })());
if (!hasConfig) process.exit(0);

try {
  execSync(`npx --no-install prettier --write "${file}"`, {
    cwd,
    stdio: "ignore",
    timeout: 20000,
  });
} catch {
  // prettier not installed locally, parse error, etc. — never block the pipeline over formatting
}
process.exit(0);
