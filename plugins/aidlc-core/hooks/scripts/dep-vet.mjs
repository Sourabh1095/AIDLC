#!/usr/bin/env node
// PreToolUse[Bash|PowerShell] — dependency pre-install gate.
// A new dependency is a supply-chain + compatibility decision, and it's cheapest to get
// right BEFORE any code is written against it. This intercepts package-ADD commands and
// asks the operator to vet the package first — safe, latest-stable, compatible — per the
// `aidlc:security` dependency policy. Installs that only materialise an existing
// lockfile/manifest (`npm ci`, bare `npm install`, `pip install -r req.txt`, `go mod
// download`) are NOT gated: nothing new is being chosen. Neither are local paths
// (`pip install -e .`, `npm i ../shared`): nothing is fetched from a registry.
//
// Running a package straight from the registry is the same decision without the install
// step: `npx some-tool`, `pnpm dlx`, `yarn dlx`, `bunx`, `uvx`, `pipx run` fetch and
// EXECUTE code nobody vetted. Those are gated too — except `npx`/`bunx` of a tool the
// project already has in node_modules/.bin, which runs the locked local copy and fetches
// nothing (`npx prettier`, `npx tsc`).
//
// Exit 0 always; the gate is a permission "ask", never a hard block. Any internal failure
// becomes an "ask" too (./lib/hook-io.mjs) — it never silently lets an install through.
//
// Parsing: the command is TOKENIZED into argv and the tool's global options are stepped
// over before reading the subcommand — the same parse-don't-regex approach guard.mjs
// uses, and for the same reason. A regex anchored on `npm\s+(install|add)` is defeated
// by any global option in between: `npm --prefix ./api install lodash` and
// `npm --loglevel=silly i evil-pkg` both slipped the gate entirely (the F46 shape).
// Segmentation and tokenization are shared with guard.mjs via ./lib/shell-parse.mjs,
// which is also where an unquoted NEWLINE became a separator: without that,
// `git status\nnpm install left-pad` is one `git` segment and this gate never fires.
import { existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { expandSegments, commandArgv, commandName } from "./lib/shell-parse.mjs";
import { runGuard, ask, str, cwdOf } from "./lib/hook-io.mjs";
import { fromShellPath } from "./lib/paths.mjs";

// Per-ecosystem rules.
//   adds        subcommands that CHOOSE a new dependency
//   globalOpts  options BEFORE the subcommand that take a separate value
//   addOpts     options AFTER the subcommand that take a separate value (so the value is
//               not mistaken for a package). Per tool, because the same letter differs:
//               npm's `-w` takes a workspace name, pnpm's `-w` is a boolean
//               (`--workspace-root`), and bun's `-d` is `--dev`. One shared list made
//               `pnpm add -w lodash` and `bun add -d zod` skip the package as a "value".
const PIP = {
  adds: ["install"],
  globalOpts: ["--python", "--log", "--proxy", "--cache-dir"],
  addOpts: ["-r", "--requirement", "-c", "--constraint", "-t", "--target", "-i", "--index-url", "--extra-index-url", "-f", "--find-links", "--trusted-host", "--prefix", "--root", "--platform", "--python-version", "--implementation", "--abi", "--src", "--upgrade-strategy"],
};
const TOOLS = {
  npm: { adds: ["install", "i", "add", "isntall", "in", "ins", "inst", "insta", "instal"], globalOpts: ["--prefix", "-w", "--workspace", "--loglevel", "-C", "--registry", "--userconfig", "--cache"], addOpts: ["--prefix", "-w", "--workspace", "--loglevel", "--registry", "--tag", "--save-prefix", "--userconfig", "--cache"] },
  pnpm: { adds: ["install", "i", "add"], globalOpts: ["--dir", "-C", "--filter", "-F", "--loglevel", "--registry", "--reporter"], addOpts: ["--dir", "-C", "--filter", "-F", "--loglevel", "--registry", "--reporter", "--config.registry"] },
  yarn: { adds: ["add"], globalOpts: ["--cwd", "--registry"], addOpts: ["--cwd", "--registry"] },
  bun: { adds: ["add", "a"], globalOpts: ["--cwd"], addOpts: ["--cwd", "--registry", "--backend"] },
  pip: PIP,
  pip3: PIP,
  uv: { adds: ["add"], globalOpts: ["--directory", "--project", "--python"], addOpts: ["--directory", "--project", "--group", "--optional", "--index", "--package", "--python", "--extra"] },
  poetry: { adds: ["add"], globalOpts: ["-C", "--directory"], addOpts: ["-C", "--directory", "-G", "--group", "--source", "-E", "--extras", "--python", "--platform"] },
  pipenv: { adds: ["install"], globalOpts: [], addOpts: ["-r", "--requirements", "--python", "-i", "--index"] },
  pipx: { adds: ["install", "inject", "run"], globalOpts: [], addOpts: ["--python", "--pip-args", "--spec", "--index-url"] },
  cargo: { adds: ["add", "install"], globalOpts: ["--manifest-path", "-Z", "--config"], addOpts: ["--manifest-path", "-p", "--package", "-F", "--features", "--rename", "--git", "--branch", "--tag", "--rev", "--path", "--registry", "--vers", "--version", "--target", "--root"] },
  go: { adds: ["get", "install"], globalOpts: ["-C"], addOpts: ["-C"] },
  gem: { adds: ["install"], globalOpts: [], addOpts: ["-i", "--install-dir", "-v", "--version", "-s", "--source", "-n", "--bindir"] },
  composer: { adds: ["require"], globalOpts: ["-d", "--working-dir"], addOpts: ["-d", "--working-dir"] },
  dotnet: { adds: [], globalOpts: [], addOpts: [] }, // handled below: `dotnet add <proj> package <pkg>`
};

// One-shot runners: they fetch and execute a package. `local` = may run a project-local
// copy from node_modules/.bin instead of fetching.
const RUNNERS = {
  npx: { valueOpts: ["-p", "--package", "-c", "--call", "--registry", "--prefix", "-w", "--workspace"], local: true },
  bunx: { valueOpts: ["-p", "--package"], local: true },
  uvx: { valueOpts: ["--from", "--with", "--python", "--index"], local: false },
};

const isFlag = (t) => t.startsWith("-");
// A local path or file: spec — nothing is fetched from a registry.
const isLocalSpec = (t) => /^(\.{1,2}([\\/]|$)|[\\/]|~|[a-zA-Z]:[\\/]|file:)/.test(t) || t === ".";

// Reduce wrapper spellings to the tool they run, so one rule table covers them:
//   python -m pip install x · py -m pip install x  →  pip install x
//   uv pip install x                                →  pip install x
//   pnpm dlx x · yarn dlx x                         →  npx x (fetch-and-run)
//   pipx run x                                      →  uvx x (fetch-and-run, never local)
function normalise(argv) {
  const name = commandName(argv);
  if (/^(python[\d.]*|py)$/.test(name)) {
    const m = argv.indexOf("-m");
    if (m >= 0 && /^pip3?$/.test(argv[m + 1] || "")) return ["pip", ...argv.slice(m + 2)];
    return argv;
  }
  if (name === "uv" && argv[1] === "pip") return ["pip", ...argv.slice(2)];
  if ((name === "pnpm" || name === "yarn") && argv[1] === "dlx") return ["npx", "--package-fetch", ...argv.slice(2)];
  if (name === "pipx" && argv[1] === "run") return ["uvx", ...argv.slice(2)];
  return argv;
}

// Is `bin` in a node_modules/.bin at or above `dir`? That is where npx/bunx look first.
function hasLocalBin(dir, bin) {
  let d = dir;
  for (;;) {
    for (const ext of ["", ".cmd", ".exe", ".ps1"]) if (existsSync(join(d, "node_modules", ".bin", bin + ext))) return true;
    const parent = dirname(d);
    if (parent === d) return false;
    d = parent;
  }
}

// Package specifiers a single segment fetches; [] when it fetches nothing new.
function fetchedPackages(segment, dir) {
  const argv = normalise(commandArgv(segment));
  if (!argv.length) return [];
  const tool = commandName(argv) || argv[0];

  const runner = RUNNERS[tool];
  if (runner) {
    // `pnpm dlx` / `yarn dlx` were normalised with a marker: they always fetch.
    const forceFetch = argv[1] === "--package-fetch";
    let pkg = "";
    const explicit = [];
    for (let i = 1; i < argv.length; i++) {
      const t = argv[i];
      if (t === "--package-fetch") continue;
      if (/^(-p|--package|--from|--with)$/.test(t) && i + 1 < argv.length) {
        explicit.push(argv[++i]);
        continue;
      }
      if (/^(--package|--from|--with)=/.test(t)) {
        explicit.push(t.split("=").slice(1).join("="));
        continue;
      }
      if (isFlag(t)) {
        if (runner.valueOpts.includes(t)) i++;
        continue;
      }
      pkg = t;
      break;
    }
    // `--package` names what gets installed for the run: always a fetch.
    if (explicit.length) return explicit.filter((p) => !isLocalSpec(p));
    if (!pkg || isLocalSpec(pkg)) return [];
    const bare = pkg.replace(/^(@[^/]+\/[^@]+|[^@]+)@.*$/, "$1"); // strip @version
    const versioned = bare !== pkg;
    if (!forceFetch && runner.local && !versioned && hasLocalBin(dir, bare.split("/").pop())) return [];
    return [pkg];
  }

  const rule = TOOLS[tool];
  if (!rule) return [];

  // `dotnet add <project> package <pkg>` — the only two-word add form here.
  if (tool === "dotnet") {
    const ai = argv.indexOf("add");
    const pi = argv.indexOf("package");
    if (ai >= 0 && pi > ai) return argv.slice(pi + 1).filter((t) => !isFlag(t)).slice(0, 1);
    return [];
  }

  // Step over global options (and their separate values) to reach the subcommand. An
  // option this table does not know is assumed to take a value when the token after it
  // is not itself a subcommand — so `npm --registry X install evil` still finds
  // `install`, where stepping one token at a time read `X` as the subcommand and
  // gated nothing.
  let i = 1;
  while (i < argv.length && isFlag(argv[i])) {
    const opt = argv[i];
    if (opt.includes("=")) i += 1;
    else if (rule.globalOpts.includes(opt)) i += 2;
    else if (i + 1 < argv.length && !isFlag(argv[i + 1]) && !rule.adds.includes(argv[i + 1])) i += 2;
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
      if (/^(-r|--requirement|--requirements|-c|--constraint)$/.test(t) && !["cargo", "gem"].includes(tool)) {
        j++;
        continue;
      }
      if (rule.addOpts.includes(t)) j++;
      continue;
    }
    if (isLocalSpec(t)) continue;
    pkgs.push(t);
  }
  // `go get` / `cargo install` with no args update or build what is already declared.
  return pkgs;
}

function main(data) {
  const cmd = str(data.tool_input && data.tool_input.command);
  if (!cmd) process.exit(0);
  const toolName = str(data.tool_name) || "Bash";

  // Follow `cd` within the command line, so `cd web && npx prettier` looks for prettier
  // in web/node_modules rather than the session root.
  let dir = cwdOf(data);
  const pkgs = [];
  for (const seg of expandSegments(cmd)) {
    const argv = commandArgv(seg);
    const name = commandName(argv);
    if ((name === "cd" || name === "set-location" || name === "pushd" || name === "sl") && argv[1]) {
      dir = resolve(dir, fromShellPath(argv[1], toolName));
      continue;
    }
    for (const p of fetchedPackages(seg, dir)) if (!pkgs.includes(p)) pkgs.push(p);
  }

  if (!pkgs.length) process.exit(0);

  const list = pkgs.slice(0, 8).join(", ");
  ask(
    `AIDLC dependency policy — vet BEFORE installing or running (${list}) so no code gets built on a bad choice. ` +
      `Confirm only once you have checked, for each new package: ` +
      `(1) SAFE — maintained (recent publish, real repo activity), exact name (no typosquat), sane ` +
      `license, no code executed at install time, no open advisories (run this ecosystem's audit); ` +
      `(2) LATEST STABLE — the current stable release (not a stale major, not alpha/beta/rc) — verify ` +
      `the real version via Context7 or the registry, not memory; ` +
      `(3) COMPATIBLE — it satisfies the declared compatibility constraints of this project's stack ` +
      `(framework major, runtime version) and won't force a conflict you would have to silence with an ` +
      `override flag. See aidlc:security → Dependency policy. If it fails any test, pick an alternative ` +
      `now, before coding.`,
  );
  process.exit(0);
}

runGuard("dependency gate", main);
