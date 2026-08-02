#!/usr/bin/env node
// PreToolUse[Bash] — dependency pre-install gate.
// A new dependency is a supply-chain + compatibility decision, and it's cheapest to get
// right BEFORE any code is written against it. This intercepts package-ADD commands and
// asks the operator to vet the package first — safe, latest-stable, compatible — per the
// `aidlc:security` dependency policy. Installs that only materialise an existing
// lockfile/manifest (`npm ci`, bare `npm install`, `pip install -r req.txt`, `go mod
// download`) are NOT gated: nothing new is being chosen.
//
// Exit 0 always; the gate is a permission "ask", never a hard block. Never throws.
//
// Parsing: the command is TOKENIZED into argv and the tool's global options are stepped
// over before reading the subcommand — the same parse-don't-regex approach guard.mjs
// uses, and for the same reason. A regex anchored on `npm\s+(install|add)` is defeated
// by any global option in between: `npm --prefix ./api install lodash` and
// `npm --loglevel=silly i evil-pkg` both slipped the gate entirely (the F46 shape).
// Segmentation and tokenization are shared with guard.mjs via ./lib/shell-parse.mjs,
// which is also where an unquoted NEWLINE became a separator: without that,
// `git status\nnpm install left-pad` is one `git` segment and this gate never fires.
import { readFileSync } from "node:fs";
import { splitSegments, commandArgv, commandName } from "./lib/shell-parse.mjs";

let data;
try {
  data = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.exit(0);
}

const cmd = (data.tool_input && data.tool_input.command) || "";
if (!cmd) process.exit(0);

// Per-ecosystem rules. `adds` = subcommands that CHOOSE a new dependency; `lockfile` =
// subcommands that only materialise what is already declared. `valueOpts` are global
// options taking a SEPARATE following value, which must be stepped over to reach the
// subcommand.
const TOOLS = {
  npm: { adds: ["install", "i", "add"], bareIsLockfile: true, valueOpts: ["--prefix", "-w", "--workspace", "--loglevel", "-C"] },
  pnpm: { adds: ["install", "i", "add"], bareIsLockfile: true, valueOpts: ["--dir", "-C", "--filter", "-F", "--loglevel"] },
  yarn: { adds: ["add"], bareIsLockfile: true, valueOpts: ["--cwd"] },
  bun: { adds: ["add"], bareIsLockfile: true, valueOpts: ["--cwd"] },
  pip: { adds: ["install"], bareIsLockfile: false, valueOpts: ["--target", "-t", "--index-url", "-i", "--find-links", "-f"] },
  pip3: { adds: ["install"], bareIsLockfile: false, valueOpts: ["--target", "-t", "--index-url", "-i", "--find-links", "-f"] },
  uv: { adds: ["add"], bareIsLockfile: false, valueOpts: ["--directory", "--project"] },
  poetry: { adds: ["add"], bareIsLockfile: false, valueOpts: ["-C", "--directory"] },
  pipenv: { adds: ["install"], bareIsLockfile: false, valueOpts: [] },
  cargo: { adds: ["add"], bareIsLockfile: false, valueOpts: ["--manifest-path", "-Z"] },
  go: { adds: ["get"], bareIsLockfile: false, valueOpts: ["-C"] },
  gem: { adds: ["install"], bareIsLockfile: false, valueOpts: ["-i", "--install-dir"] },
  composer: { adds: ["require"], bareIsLockfile: false, valueOpts: ["-d", "--working-dir"] },
  dotnet: { adds: [], bareIsLockfile: false, valueOpts: [] }, // handled below: `dotnet add <proj> package <pkg>`
};

// Flags whose VALUE is a version/spec rather than a package (kept out of the package list).
const isFlag = (t) => t.startsWith("-");

// Package specifiers a single segment installs; [] when the segment is not an add.
function addedPackages(segment) {
  const argv = commandArgv(segment);
  if (!argv.length) return [];
  const tool = commandName(argv);
  const rule = TOOLS[tool];
  if (!rule) return [];

  // `dotnet add <project> package <pkg>` — the only two-word add form here.
  if (tool === "dotnet") {
    const ai = argv.indexOf("add");
    const pi = argv.indexOf("package");
    if (ai >= 0 && pi > ai) return argv.slice(pi + 1).filter((t) => !isFlag(t));
    return [];
  }

  // Step over global options (and their separate values) to reach the subcommand. This
  // is what a regex cannot do, and what let `npm --prefix ./api install x` through.
  let i = 1;
  while (i < argv.length && isFlag(argv[i])) {
    if (rule.valueOpts.includes(argv[i]) && !argv[i].includes("=")) i += 2;
    else i += 1;
  }
  const sub = argv[i];
  if (!sub || !rule.adds.includes(sub)) return [];

  // Remaining non-flag tokens are the packages. None ⇒ a lockfile/manifest install
  // (`npm install`, `pip install` with only -r) ⇒ not an add.
  const rest = argv.slice(i + 1);
  const pkgs = [];
  for (let j = 0; j < rest.length; j++) {
    const t = rest[j];
    if (isFlag(t)) {
      // `-r requirements.txt` / `--requirement req.txt` install what is already declared.
      if (/^(-r|--requirement|-c|--constraint)$/.test(t)) return [];
      // Skip a separate value for the flags that take one and never name a package.
      if (/^(--registry|--index-url|-i|--target|-t|--find-links|-f|--prefix|--cwd|--dir|-C|-d|--working-dir|--manifest-path|--directory|--project|--filter|-F|-w|--workspace|--loglevel)$/.test(t))
        j++;
      continue;
    }
    pkgs.push(t);
  }
  // `pip install -r req.txt` handled above; `go get` with no args updates existing deps.
  return pkgs;
}

const pkgs = [];
for (const seg of splitSegments(cmd)) {
  for (const p of addedPackages(seg)) if (!pkgs.includes(p)) pkgs.push(p);
}

if (!pkgs.length) process.exit(0);

const list = pkgs.slice(0, 8).join(", ");
process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason:
        `AIDLC dependency policy — vet BEFORE installing (${list}) so no code gets built on a bad choice. ` +
        `Confirm only once you have checked, for each new package: ` +
        `(1) SAFE — maintained (recent publish, real repo activity), exact name (no typosquat), sane ` +
        `license, no code executed at install time, no open advisories (run this ecosystem's audit); ` +
        `(2) LATEST STABLE — the current stable release (not a stale major, not alpha/beta/rc) — verify ` +
        `the real version via Context7 or the registry, not memory; ` +
        `(3) COMPATIBLE — it satisfies the declared compatibility constraints of this project's stack ` +
        `(framework major, runtime version) and won't force a conflict you would have to silence with an ` +
        `override flag. See aidlc:security → Dependency policy. If it fails any test, pick an alternative ` +
        `now, before coding.`,
    },
  }),
);
process.exit(0);
