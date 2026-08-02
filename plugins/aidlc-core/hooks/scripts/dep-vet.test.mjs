// Detection tests for dep-vet.mjs. Run: `node dep-vet.test.mjs` (sibling hook)
// or `node dep-vet.test.mjs <path>`.
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), "dep-vet.mjs");

// Returns "ask" if the hook gated the command, "" otherwise.
function decision(command) {
  const out = execFileSync("node", [HOOK], {
    input: JSON.stringify({ tool_input: { command } }),
    encoding: "utf8",
  });
  if (!out.trim()) return "";
  try {
    return JSON.parse(out).hookSpecificOutput.permissionDecision;
  } catch {
    return "PARSE_ERROR";
  }
}

let fails = 0;
let n = 0;
function check(command, expected, label) {
  n++;
  const got = decision(command) === "ask" ? "gate" : "allow";
  if (got !== expected) {
    fails++;
    console.log(`FAIL [${label}] expected=${expected} got=${got}\n       cmd: ${command}`);
  } else {
    console.log(`ok   [${label}] ${expected}`);
  }
}

// Package ADDS → gate
check("npm i lodash", "gate", "npm i pkg");
check("npm install react react-dom", "gate", "npm install multi");
check("npm install --save-dev typescript", "gate", "npm install -D pkg");
check("npm i zod@3.23.8", "gate", "npm i pkg@version");
check("pnpm add @tanstack/react-query", "gate", "pnpm add scoped");
check("yarn add axios", "gate", "yarn add");
check("bun add hono", "gate", "bun add");
check("pnpm install dayjs", "gate", "pnpm install pkg");
check("cd apps/web && npm i clsx", "gate", "add in a compound command");

// Global options BEFORE the subcommand — a regex anchored on `npm\s+install` misses
// these entirely, so both used to bypass the gate silently (the F46 shape).
check("npm --prefix ./api install lodash", "gate", "npm --prefix <path> install");
check("npm --loglevel=silly i evil-pkg", "gate", "npm --loglevel=x i (inline value)");
check("pnpm -C packages/ui add clsx", "gate", "pnpm -C <dir> add");
check("sudo npm i -g typescript", "gate", "sudo-prefixed add");

// Non-JS ecosystems — a Python or Rust repo got no gate at all before.
check("pip install requests", "gate", "pip install");
check("pip3 install 'django>=5'", "gate", "pip3 install with a version spec");
check("uv add httpx", "gate", "uv add");
check("poetry add pydantic", "gate", "poetry add");
check("cargo add tokio", "gate", "cargo add");
check("go get github.com/gin-gonic/gin", "gate", "go get");
check("gem install rails", "gate", "gem install");
check("composer require monolog/monolog", "gate", "composer require");
check("dotnet add ./Api.csproj package Serilog", "gate", "dotnet add package");

// Lockfile / manifest installs in those ecosystems → allow
check("pip install -r requirements.txt", "allow", "pip install -r (declared deps)");
check("pip install --requirement dev-requirements.txt", "allow", "pip --requirement");
check("go mod download", "allow", "go mod download");
check("cargo build", "allow", "cargo build");
check("poetry install", "allow", "poetry install (lockfile)");

// Lockfile installs / non-adds → allow
check("npm ci", "allow", "npm ci");
check("npm install", "allow", "bare npm install");
check("npm i", "allow", "bare npm i");
check("pnpm install", "allow", "bare pnpm install");
check("pnpm i", "allow", "bare pnpm i");
check("yarn", "allow", "bare yarn");
check("yarn install", "allow", "yarn install (lockfile)");
check("npm run install:deps", "allow", "npm run script named install");
check("npm run build", "allow", "npm run build");
check("npm test", "allow", "npm test");
check('git commit -m "npm i lodash in the notes"', "allow", "pkg name only inside a quoted message");
check("git status", "allow", "unrelated git");

// --- Multi-line commands: a NEWLINE is a segment separator (lib/shell-parse.mjs) ---
// Before this, `cmd.split(/[|;&]+/)` left a multi-line command as ONE segment, so
// argv[0] came from the FIRST line. A leading `git`/`echo`/`cd` line meant no known
// package manager was found and the gate silently never fired.
check("git status\nnpm install left-pad", "gate", "newline: add after a git line");
check("git log --oneline\npnpm add axios", "gate", "newline: pnpm add after git");
check("echo building\nyarn add react", "gate", "newline: add after echo");
check("cd apps/web\nnpm i clsx", "gate", "newline: add after cd");
check("npm run build\nnpm i zod\nnpm test", "gate", "newline: add in the middle");
check("git status\r\nnpm i lodash", "gate", "CRLF newline: add after git");
check("pip install -r req.txt\npip install requests", "gate", "newline: real add after a -r install");
// …and a newline INSIDE quotes is not a separator: a multi-line commit message is
// one command, and its body must never be read as a command to execute.
check('git commit -m "release notes\n- ran npm i lodash locally"', "allow", "newline inside a quoted message");
check("git status\nnpm ci", "allow", "newline: lockfile install stays ungated");
check("git status\nnpm run build", "allow", "newline: unrelated script stays ungated");

// --- Nested shells: the payload is the real command (lib/shell-parse.mjs) ---
// `bash -c "npm install evil-pkg"` has argv[0] = bash, so no package manager was found
// and the supply-chain gate never fired.
check('bash -c "npm install evil-pkg"', "gate", "nested: npm install via bash -c");
check("sh -c 'pnpm add axios'", "gate", "nested: pnpm add via sh -c");
check('bash -c "cd apps/web && yarn add react"', "gate", "nested: add inside a compound payload");
check("env CI=1 npm i lodash", "gate", "env wrapper before an add");
check('bash -c "npm ci"', "allow", "nested: lockfile install stays ungated");
check('bash -c "npm run build"', "allow", "nested: unrelated script stays ungated");

console.log(`\n${n - fails}/${n} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
