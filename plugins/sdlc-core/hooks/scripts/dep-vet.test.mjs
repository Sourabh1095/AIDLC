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

console.log(`\n${n - fails}/${n} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
