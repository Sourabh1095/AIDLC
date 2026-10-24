#!/usr/bin/env node
// PreToolUse[Bash|PowerShell] guard — blocks dangerous commands that static permission
// patterns cannot express (branch-aware force-push, prod DB ops, secret exfil, rewriting
// the guardrails themselves).
// Exit 2 = block (stderr shown to the model). Exit 0 = allow, or "ask" via JSON.
// Any internal failure becomes an "ask" (lib/hook-io.mjs → runGuard), never a silent allow.
//
// Principle: inspect the COMMAND BEING EXECUTED, not free text. A git segment is
// tokenized into argv and parsed (global options → subcommand → args), so a commit
// message that merely mentions "push", "DROP TABLE" or "filter-branch" is one opaque
// argument and can never be read as a command. Content checks are skipped for `git`
// segments — git executes no SQL, cluster, filesystem or credential ops.
//
// Both shell tools are guarded. On Windows Claude Code also exposes a PowerShell tool, and
// where Git Bash is absent it registers ONLY that one — so a hook matching `Bash` alone
// never fired there at all, and every check below was off. PowerShell commands go through
// the same parser: its separators (`;`, `|`, newline, and `&` as the call operator) split
// the same way, and names are compared case-insensitively (lib/shell-parse.mjs).
//
// Poly workspaces: the session cwd is the control plane, and the pipeline reaches a
// product repo with `git -C <path> …` (aidlc:run §2.5). Every repo-state check below
// therefore resolves against the `-C` target, NOT the session cwd — the control plane
// sits on `main` permanently, so reading HEAD from cwd blocks every legitimate
// feature-branch push (F46).
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { isEnvFile, envAccessFor as _envAccessFor } from "./lib/env-access.mjs";
import { expandSegments, commandArgv, commandName } from "./lib/shell-parse.mjs";
import { runGuard, ask, block as blockWith, str, cwdOf } from "./lib/hook-io.mjs";
import { normPath, resolveShellPath, unquote } from "./lib/paths.mjs";
import { protectedKind, PROTECTED_REASON } from "./lib/protected-paths.mjs";
import { findConfig, configuredBranches, branchMatches } from "./lib/config.mjs";

let cmd = "";
let cwd = "";
let toolName = "Bash";

const block = (reason) => blockWith("AIDLC guard blocked this command", reason);

// A prompt rather than a refusal, for the one case that is permitted-but-confirmed.
//
// COLLECTED, not emitted on the spot: a later segment of the same command may still
// block, and a block has to win over a prompt — `cat .env; rm -rf /etc` must never be
// downgraded to a question. `block()` exits immediately, so anything still standing when
// the run reaches the end has already survived every check in the file.
let pendingAsk = "";
const askFirst = (reason) => {
  if (!pendingAsk) pendingAsk = reason;
};

// --- Protected branches ------------------------------------------------------------------
// The fixed set every repo gets, plus whatever the workspace config declares permanent
// (`defaultBranch`, `integrationBranch`, `longLivedBranches`, top level and per repo). The
// fixed set alone missed a GitFlow `trunk` or a `production` branch the config named.
const PROTECTED_RE = /^(?:main|master|develop|release\/.+)$/;

function isProtected(branch, repoCwd) {
  if (!branch) return false;
  if (branch.includes("*")) return true; // a wildcard refspec can reach any branch
  if (PROTECTED_RE.test(branch)) return true;
  return configuredBranches(findConfig(repoCwd).cfg).some((p) => branchMatches(branch, p));
}

const gitOpts = (repoCwd) => ({ cwd: repoCwd, stdio: ["ignore", "pipe", "ignore"], timeout: 5000 });

// Current branch of a specific repo, computed lazily and cached per path — only push
// checks need it, so non-git commands never pay for the subprocess.
const _branches = new Map();
function branchInfo(repoCwd) {
  if (!_branches.has(repoCwd)) {
    let b = "";
    try {
      // symbolic-ref works even on an unborn branch (fresh repo, no commits)
      b = execFileSync("git", ["symbolic-ref", "--short", "HEAD"], gitOpts(repoCwd)).toString().trim();
    } catch {
      b = "";
    }
    _branches.set(repoCwd, b);
  }
  const branch = _branches.get(repoCwd);
  return { branch, onProtected: isProtected(branch, repoCwd) };
}

// Gitlinks (mode 160000) newly staged in this repo's index, excluding paths
// registered as real submodules in .gitmodules. Only called for an actual
// `git commit`, so non-commit commands never pay for the subprocesses. Any
// failure (not a repo, git missing) returns [] — never block on uncertainty.
function stagedGitlinks(repoCwd) {
  let top, raw;
  try {
    top = execFileSync("git", ["rev-parse", "--show-toplevel"], gitOpts(repoCwd)).toString().trim();
    // ":<srcmode> <dstmode> <srcsha> <dstsha> <status>\t<path>" — works on an
    // unborn branch too (diffed against the empty tree). dstmode 160000 = a
    // gitlink being written; a deletion has dstmode 000000 and is fine.
    raw = execFileSync("git", ["diff", "--cached", "--raw"], gitOpts(repoCwd)).toString();
  } catch {
    return [];
  }
  const links = [];
  for (const line of raw.split("\n")) {
    const m = line.match(/^:\d{6} 160000 \S+ \S+ \S+\t(.+)$/);
    if (m) links.push(m[1].trim());
  }
  if (!links.length) return [];
  let modules = "";
  try {
    modules = readFileSync(join(top, ".gitmodules"), "utf8");
  } catch {
    /* no .gitmodules — every staged gitlink is unregistered */
  }
  const registered = new Set([...modules.matchAll(/^\s*path\s*=\s*(.+?)\s*$/gm)].map((m) => m[1]));
  return links.filter((p) => !registered.has(p));
}

// `expandSegments` / `commandArgv` / `commandName` live in ./lib/shell-parse.mjs,
// shared with dep-vet.mjs — see that file for the quote-aware parsing rationale
// for why an unquoted NEWLINE has to be a segment separator, and for why a nested
// shell's payload is expanded into segments of its own.

// git global options that consume a SEPARATE following value.
const GIT_VALUE_OPTS = new Set(["-c", "-C", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--super-prefix", "--config-env"]);

// Subcommands with a dedicated check below; also the fail-closed rescan set.
const GUARDED_SUBS = new Set(["push", "commit", "filter-branch", "filter-repo"]);

// git's own subcommands. Anything else may be an ALIAS from the user's or the repo's git
// config — `git p origin main --force` with `alias.p=push` is a force-push that the push
// check never saw, because it keys on the subcommand name. Only a name outside this set
// pays for the alias lookup.
const GIT_BUILTINS = new Set(
  ("add am annotate apply archive bisect blame branch bundle cat-file check-attr check-ignore checkout " +
    "cherry cherry-pick clean clone commit commit-tree config count-objects credential describe diff " +
    "diff-files diff-index diff-tree difftool fetch filter-branch filter-repo for-each-ref format-patch " +
    "fsck gc grep hash-object help init lfs log ls-files ls-remote ls-tree maintenance merge merge-base " +
    "mergetool mv name-rev notes prune pull push range-diff read-tree rebase reflog remote repack replace " +
    "reset restore rev-list rev-parse revert rm shortlog show show-branch show-ref sparse-checkout stash " +
    "status submodule switch symbolic-ref tag update-index update-ref var verify-commit version " +
    "whatchanged worktree write-tree").split(" "),
);

// Parse `git [global-opts] <subcommand> [args…]`, returning the -C target so repo
// state is read from the repo actually being acted on, and every `-c` setting.
function parseGit(argv) {
  let i = 1;
  let dashC = null;
  const configs = [];
  while (i < argv.length && argv[i].startsWith("-")) {
    const a = argv[i];
    if (a.startsWith("-c") && a.length > 2) configs.push(a.slice(2)); // -calias.p=push
    if (GIT_VALUE_OPTS.has(a)) {
      if (a === "-C" && i + 1 < argv.length) dashC = argv[i + 1];
      if (a === "-c" && i + 1 < argv.length) configs.push(argv[i + 1]);
      i += 2;
    } else i += 1;
  }
  let sub = argv[i] || "";
  let args = argv.slice(i + 1);
  // Parse anomaly: an UNQUOTED -C path containing spaces splits into several tokens,
  // so the subcommand slot lands on a path fragment. Never fail open — rescan for a
  // guarded subcommand and check it with the repo target treated as unknown. (A real
  // subcommand never contains a path separator, so normal commands can't take this
  // branch, and `git commit -m push` still parses as `commit` above.)
  if (/[\\/]/.test(sub)) {
    const j = argv.findIndex((t) => GUARDED_SUBS.has(t));
    if (j >= 0) return { dashC: null, sub: argv[j], args: argv.slice(j + 1), configs, unresolved: true };
  }
  return { dashC, sub, args, configs, unresolved: false };
}

// The expansion of a configured git alias, or "" — read from the repo being acted on, so
// both global and repo-local aliases count.
function gitAlias(repoCwd, name) {
  try {
    return execFileSync("git", ["config", "--get", `alias.${name}`], gitOpts(repoCwd)).toString().trim();
  } catch {
    return "";
  }
}

// Destination ref of a refspec: `HEAD:main` / `:main` / `+main` / `refs/heads/main` → `main`.
// The fully-qualified form was not normalised, so `git push origin feat:refs/heads/main`
// pushed straight to main past a check that only recognised the short name.
const refDest = (r) =>
  (r.includes(":") ? r.slice(r.lastIndexOf(":") + 1) : r).replace(/^\+/, "").replace(/^refs\/heads\//, "");

// --- Env-file access backstop -------------------------------------------------------
// The env-guard hook governs the file TOOLS; a shell command that reads or writes an env
// file bypasses it. This mirrors the same switch on the shell path. The harness `deny` on
// env was removed so the switch could work, so this is what keeps the default-deny honest
// for shell commands.
//
// Resolver, matcher and fail-closed semantics live in ./lib/env-access.mjs and are
// SHARED with env-guard.mjs — two enforcement points, one definition of the switch.
const isEnvBase = (t) => isEnvFile(argValue(t));
const envAccessFor = (envPath) => _envAccessFor(envPath, cwd);

// PowerShell binds a parameter value with a colon: `-Path:.env`. Strip the name so the
// value is what gets checked.
const argValue = (t) => unquote(t).replace(/^-[\w-]+:/, "");

// Redirections in a segment, quote-aware, so a quoted ">.env" inside an echo string is
// NOT read as a real redirect (the same parse-don't-regex principle the git checks use).
// Returns [{ op, target }] with op ">" (write/append) or "<" (read). Heredocs (`<<`) and
// fd duplications (`>&2`) are not file redirects and are skipped.
function redirections(seg) {
  const out = [];
  let quote = null;
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c !== ">" && c !== "<") continue;
    if (c === "<" && seg[i + 1] === "<") {
      i++;
      continue;
    }
    let j = i + 1;
    if (c === ">" && seg[j] === ">") j++; // >>
    if (seg[j] === "&") continue; // >&2
    while (j < seg.length && /\s/.test(seg[j])) j++;
    let target = "";
    let q = null;
    for (; j < seg.length; j++) {
      const d = seg[j];
      if (q) {
        if (d === q) q = null;
        else target += d;
        continue;
      }
      if (d === '"' || d === "'") {
        q = d;
        continue;
      }
      if (/[\s|;&<>()]/.test(d)) break;
      target += d;
    }
    if (target) out.push({ op: c, target });
    i = j - 1;
  }
  return out;
}

// Operands of a command: everything that is not a flag, with PowerShell `-Name:value`
// bindings reduced to their value. `valueFlags` names the flags whose NEXT token is a
// value, not an operand — exact case for POSIX tools, lower-case for PowerShell
// parameters (which match in any case).
function operands(argv, valueFlags = new Set()) {
  const out = [];
  let literal = false;
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      literal = true;
      continue;
    }
    if (!literal && /^-/.test(a)) {
      if (/^-[\w-]+:./.test(a)) out.push(argValue(a));
      else if (valueFlags.has(a) || (a.length > 2 && valueFlags.has(a.toLowerCase()))) i++;
      continue;
    }
    out.push(a);
  }
  return out;
}

// The value of a named PowerShell parameter (`-Destination x`, `-Destination:x`), or "".
function psParam(argv, names) {
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i].toLowerCase();
    for (const n of names) {
      if (a === n && i + 1 < argv.length) return argv[i + 1];
      if (a.startsWith(n + ":")) return argv[i].slice(n.length + 1);
    }
  }
  return "";
}

// Every path a command WRITES, DELETES or MOVES something into: the destination of a copy,
// the file a cmdlet sets, the targets of an in-place edit or a delete. Used for both the
// env-file backstop and the guardrail protection. Reads are handled separately below.
const PS_SET = new Set(["set-content", "sc", "add-content", "ac", "out-file", "clear-content", "clc", "new-item", "ni"]);
const PS_COPY = new Set(["copy-item", "cpi", "copy", "move-item", "mi", "move", "rename-item", "rni", "ren"]);
const DELETERS = new Set(["rm", "remove-item", "ri", "del", "erase", "rd", "rmdir", "unlink", "shred"]);
function writeTargets(argv) {
  const name = commandName(argv);
  if (name === "tee" || name === "truncate" || DELETERS.has(name)) return operands(argv, new Set(["-s", "--size"]));
  if (name === "dd") return argv.filter((a) => /^of=/.test(a)).map((a) => a.slice(3));
  if (name === "cp" || name === "mv" || name === "install" || name === "ln") {
    const t = psParam(argv, ["-t", "--target-directory"]);
    if (t) return [t];
    const ops = operands(argv, new Set(["-m", "--mode", "-o", "--owner", "-g", "--group", "-s", "--suffix"]));
    return ops.length >= 2 ? [ops[ops.length - 1]] : [];
  }
  if (name === "sed" || name === "perl") {
    if (!argv.some((a) => /^-[a-zA-Z]*i/.test(a) || a === "--in-place" || a.startsWith("--in-place="))) return [];
    const ops = operands(argv, new Set(["-e", "-f", "--expression", "--file"]));
    // The script is the first operand unless it came in through -e/-f.
    return argv.some((a) => /^(-e|-f|--expression|--file)(=|$)/.test(a)) ? ops : ops.slice(1);
  }
  if (PS_SET.has(name)) {
    const p = psParam(argv, ["-path", "-literalpath", "-filepath"]);
    return p ? [p] : operands(argv, new Set(["-value", "-encoding", "-itemtype", "-type", "-name"])).slice(0, 1);
  }
  if (PS_COPY.has(name)) {
    const ops = operands(argv, new Set(["-destination", "-path", "-literalpath", "-newname", "-filter", "-include", "-exclude"]));
    const src = psParam(argv, ["-path", "-literalpath"]) || ops[0];
    const dest = psParam(argv, ["-destination", "-newname"]) || ops[1];
    // A rename or move takes the source away, so the source is a "write" target too.
    const out = [];
    if (dest) out.push(dest);
    if (src && !["copy-item", "cpi", "copy"].includes(name)) out.push(src);
    return out;
  }
  return [];
}

// The FILES a reading command reads. Lower-case names: they are compared that way.
//
// The list named `type`, `Get-Content`, `gc` — three Windows/PowerShell spellings — and
// not one macOS-native one, so the guard was measurably weaker on a Mac than on the box
// it was written on. It also named only DUMPING readers: `grep . .env`, `sed -n p .env`,
// `awk 1 .env`, `source .env` and PowerShell's `Select-String -Path .env` all print (or
// load) every value, and all walked past. A reader is anything whose output carries the
// file's content.
//
// Search and script tools take a PATTERN (or script) first, and that operand is not a file:
// `grep -rn ".env" src/` searches for the text ".env" and must not read as a read OF one.
// So their first operand is skipped unless the pattern came in through a flag (`-e`, `-f`).
const DUMPERS = new Set([
  "cat", "type", "get-content", "gc", "bat", "less", "more", "head", "tail", "nl", "xxd", "od", "hexdump", "open",
  "cut", "sort", "uniq", "diff", "tac", "rev", "paste", "column", "strings", "base64", "iconv", "source", ".",
  "openssl", "certutil", "format-hex", "pbcopy", "clip",
]);
const PATTERN_FIRST = new Set(["grep", "egrep", "fgrep", "rg", "ag", "ack", "findstr", "sed", "awk", "gawk", "mawk"]);
const COPIERS = new Set(["cp", "mv", "scp", "rsync", "copy-item", "cpi", "copy"]);
// Exact case: grep's `-A 3` takes a value and its `-a` does not.
const SEARCH_VALUE_FLAGS = new Set([
  "-e", "-f", "-m", "-A", "-B", "-C", "-g", "-t", "-T", "-d", "-D", "--regexp", "--file", "--max-count",
  "--after-context", "--before-context", "--context", "--glob", "--type", "--type-not", "--include", "--exclude",
  "--exclude-dir",
]);
function readOperands(argv) {
  const name = commandName(argv);
  if (DUMPERS.has(name) || COPIERS.has(name)) return operands(argv).map(argValue);
  if (PATTERN_FIRST.has(name)) {
    const ops = operands(argv, SEARCH_VALUE_FLAGS).map(argValue);
    const patternByFlag = argv.some((a) => /^(-e|-f|--regexp|--file|--expression)(=|$)/.test(a) || /^\/[cg]:/i.test(a));
    return patternByFlag ? ops : ops.slice(1);
  }
  if (name === "select-string" || name === "sls") {
    const p = psParam(argv, ["-path", "-literalpath"]);
    if (p) return [p];
    const ops = operands(argv, new Set(["-pattern", "-encoding", "-context"])).map(argValue);
    return argv.some((a) => /^-pattern(:|$)/i.test(a)) ? ops : ops.slice(1);
  }
  return [];
}

function envReadTarget(argv, rawSeg) {
  const t = readOperands(argv).find((a) => isEnvFile(a));
  if (t) return t;
  // `< .env` feeds the file to whatever the command is.
  const r = redirections(rawSeg).find((x) => x.op === "<" && isEnvFile(x.target));
  if (r) return r.target;
  // PowerShell / .NET file APIs: `[IO.File]::ReadAllText('.env')` is one token to the parser.
  const m = rawSeg.match(/\[(?:system\.)?io\.file\]::(?:readall\w*|open\w*|readlines)\s*\(\s*['"]?([^'")]+)/i);
  if (m && isEnvFile(m[1])) return m[1];
  return "";
}

// --- Private keys and credential stores ---------------------------------------------
// Matched on the path TOKEN, so the reader check below can be argv-based like the env
// one. It previously matched a regex over the raw segment and named only three readers
// (`cat`/`type`/`Get-Content`) — while ENV_READERS one line above already listed
// thirteen, so `head ~/.ssh/id_rsa` and `base64 ~/.aws/credentials` walked straight
// through a check that blocked `cat` on the same file.
//
// What is deliberately NOT here: `.pem` and `.key`. Both are overwhelmingly public
// certificates and test fixtures inside real repos, so blocking them would fire on the
// correct case constantly — and a guard that cries wolf trains people to route around
// it, which is how F46's false block was described and is a worse outcome than the gap.
// Keystore formats (`.p12`/`.pfx`/`.jks`) carry a private key essentially by definition,
// so those stay.
const SECRET_PATH_SRC = String.raw`(?:\.ssh[\\/]|\bid_(?:rsa|dsa|ecdsa|ed25519)\b|\.aws[\\/]credentials\b|\.kube[\\/]config\b|\.gnupg[\\/]|\.docker[\\/]config\.json\b|(?:^|[\\/])[._]netrc\b|\.pgpass\b|\.my\.cnf\b|\bapplication_default_credentials\.json\b|\.(?:p12|pfx|jks|keystore)\b)`;
const SECRET_PATH_RE = new RegExp(SECRET_PATH_SRC, "i");

// The same readers as the env check, plus the tools that relocate a file wholesale — the
// pipeline never needs to copy a private key, and `cp ~/.ssh/id_rsa /tmp/k` is a read with
// extra steps. Operand-based (readOperands), so `grep -rn id_rsa docs/` — a search FOR the
// text, which a security review does — is not a read of a key.
function secretReadTarget(argv) {
  const t = readOperands(argv).find((a) => SECRET_PATH_RE.test(a));
  return t ? unquote(t) : "";
}
// Reader names for the raw-segment backstop at §5: the dumpers and copiers only. Search
// tools are left out on purpose — a segment that merely mentions both `grep` and `id_rsa`
// is almost always a search for the string, and a backstop that fires on that cries wolf.
// Clipboard tools earn their place here rather than in the argv check: `pbcopy < ~/.ssh/id_rsa`
// puts the path after a redirect, so it is never an operand — but the segment still names
// both a reader and a key path, which is what this backstop matches.
const BACKSTOP_READERS = [...DUMPERS, ...COPIERS].filter((n) => n !== "." && n !== "source");
const SECRET_READER_RE = new RegExp(`\\b(?:${BACKSTOP_READERS.join("|")})\\b`, "i");

// --- Delete blast radius --------------------------------------------------------------
// Does this operand land outside the project (or ON the project root)? The old check
// tested `^[/\\]` or `^~`, so it only ever saw ABSOLUTE targets: `rm -rf ../../..`
// escaped the repo entirely and was allowed. Resolving against cwd covers both spellings
// with one rule. Path comparison is case-insensitive on Windows and macOS
// (lib/paths.mjs → normPath), and a Git Bash drive path (`/d/app/dist`) is read as the
// drive it names — Node alone read it as `<cwd drive>:\d\app\dist` and blocked an
// in-project delete as "outside".
//
// Everything the shell expands BEFORE the command runs, which `resolve` would take
// literally: `$HOME`, `${HOME}`, `$(pwd)`, a backtick substitution, cmd's `%TEMP%`,
// PowerShell's `$env:USERPROFILE`. `~` was handled; the rest of the family was not.
const SHELL_EXPANSION_RE = /\$[({]?\w|`|%\w+%/;

function deleteEscapes(target) {
  const t = unquote(target);
  if (!t) return null;
  // The shell expands `~` before the command runs; node's resolve would not, so a
  // home-relative path is treated as outside on sight.
  if (/^~/.test(t)) return "outside";
  // The same reasoning, for the rest of the expansion syntax — and this half failed
  // OPEN rather than merely being missing. `resolve(cwd, "$HOME/stuff")` yields
  // `<project>/$HOME/stuff`, which starts with the project root, so the check returned
  // "inside, allowed" for `rm -rf $HOME/stuff` and every other variable spelling; the
  // shell then expanded it into a path the guard never evaluated. Unexpandable means
  // unprovable, and an unprovable delete target gets the same answer as an outside one.
  //
  // Deliberately not narrowed by quoting: tokenize() strips quotes without recording
  // which kind, so `'$HOME'` (a literal directory, safe) is indistinguishable here from
  // `$HOME` (expanded, not safe). Blocking both costs a false positive on a directory
  // literally named `$HOME` — loud, and rarer than the failure it prevents. The remedy
  // for a legitimate `rm -rf "$PWD/dist"` is to spell it `rm -rf dist`.
  if (SHELL_EXPANSION_RE.test(t)) return "unexpandable";
  const a = normPath(resolveShellPath(cwd, t, toolName));
  const c = normPath(cwd);
  if (a === c) return "root"; // `rm -rf .` — inside the project, and it IS the project
  return a.startsWith(c + "/") ? null : "outside";
}

// Recursive-delete operands for `rm`, PowerShell `Remove-Item` and cmd `rd /s`, or []
// when the command is none of them or is not recursive. Flags are read from argv rather
// than matched as a combined blob, so `-r -f` and `--recursive` count exactly like `-rf`.
// PowerShell accepts any unambiguous prefix of `-Recurse` (`-r`, `-rec`), and cmd's
// builtins take `/s` — `rd /s /q C:\Windows` used to read `/s` and `/q` as operands and
// never see a recursive delete at all.
const PS_DELETE = new Set(["remove-item", "ri", "rd", "rmdir", "del", "erase"]);
function recursiveDeleteTargets(argv) {
  const name = commandName(argv);
  const isRm = name === "rm";
  const isPs = PS_DELETE.has(name);
  if (!isRm && !isPs) return [];
  let recursive = false;
  const ops = [];
  let literal = false;
  for (const a of argv.slice(1)) {
    if (a === "--") {
      literal = true;
      continue;
    }
    if (!literal && isPs && /^\/[a-zA-Z]$/.test(a)) {
      if (/^\/s$/i.test(a)) recursive = true;
      continue;
    }
    if (!literal && a.startsWith("-")) {
      if (isRm && (a === "--recursive" || (!a.startsWith("--") && /r/i.test(a.slice(1))))) recursive = true;
      if (isPs && /^-r(e(c(u(r(se?)?)?)?)?)?$/i.test(a)) recursive = true;
      continue;
    }
    ops.push(a);
  }
  return recursive ? ops : [];
}

// --- Guardrail self-modification from the shell ----------------------------------------
// The Edit/Write path has always been guarded (protect-paths.mjs); the shell path was not,
// so `echo {} > .claude/settings.json` replaced the permission rules and
// `cp evil.mjs <plugin>/hooks/scripts/guard.mjs` replaced this file. Same definition of
// "protected" as the tool path (lib/protected-paths.mjs), with one shell-specific
// narrowing: inside `.git/` only `config` and `hooks/` are blocked. Those are the two that
// run code (`core.hooksPath`, `core.fsmonitor`, a hook script); deleting a stale
// `.git/index.lock` is an ordinary recovery step and must keep working.
function checkProtectedWrite(target) {
  const kind = protectedKind(argValue(target), cwd, toolName);
  if (!kind) return;
  const shown = argValue(target);
  if (kind === "settings") {
    // Creation is the /aidlc:init bootstrap (via the Write tool, which shows the content);
    // a shell write or delete of an EXISTING settings file is never the pipeline's job.
    if (existsSync(resolveShellPath(cwd, shown, toolName)))
      block(`writing or deleting ${shown} from a shell command — ${PROTECTED_REASON.settings}.`);
    return;
  }
  if (kind === "hooks") block(`writing or deleting ${shown} — ${PROTECTED_REASON.hooks}.`);
  if (kind === "git") {
    if (/(^|[\\/])\.git[\\/](config$|hooks[\\/])/i.test(normPath(resolveShellPath(cwd, shown, toolName))))
      block(`writing ${shown} — git config and git hooks can execute code; use git commands instead.`);
    return;
  }
  if (kind === "ci")
    askFirst(`AIDLC: this shell command modifies the CI pipeline file ${shown} — confirm it is intended for the current work item.`);
}

// Segment per shell separator so flags/tokens from OTHER commands in a compound line
// (`rm -f x && git push`) don't leak across the checks. The separator set includes an
// unquoted NEWLINE: without it a multi-line command is one segment, and a leading
// `git …` line makes every check below skip (see ./lib/shell-parse.mjs).
function checkSegment(rawSeg, aliasDepth = 0) {
  const argv = commandArgv(rawSeg);
  const isGit = commandName(argv) === "git";

  if (isGit) {
    const { dashC, sub, args, configs } = parseGit(argv);
    // Every repo-state check resolves against the -C target, not the session cwd.
    const repoCwd = dashC ? resolveShellPath(cwd, dashC, toolName) : cwd;

    // --- 0. Aliases hide the real subcommand ---
    // An inline alias exists only to rename a command for this one invocation; the
    // pipeline never needs one, and it is exactly the shape that hides a force-push.
    if (configs.some((c) => /^alias\./i.test(c)))
      block("defining a git alias inline (`-c alias.…`) — it hides the real subcommand from this check.");
    if (sub && !GIT_BUILTINS.has(sub) && !/[\\/]/.test(sub) && aliasDepth < 2) {
      const expansion = gitAlias(repoCwd, sub);
      if (expansion) {
        const rest = args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ");
        const prefix = dashC ? `git -C "${dashC}"` : "git";
        // `!cmd` aliases run a shell command line; plain ones are more git arguments.
        const line = expansion.startsWith("!") ? `${expansion.slice(1)} ${rest}` : `${prefix} ${expansion} ${rest}`;
        for (const s of expandSegments(line)) checkSegment(s, aliasDepth + 1);
        return;
      }
    }

    // --- 1. Push protection (branch-aware; static deny rules are layer 1) ---
    if (sub === "push") {
      const { branch, onProtected } = branchInfo(repoCwd);
      const hasForce = args.some(
        (a) => a === "--force" || (/^-[a-zA-Z]*f[a-zA-Z]*$/.test(a) && !a.startsWith("--")) || a.startsWith("+"),
      );
      const hasForceWithLease = args.some((a) => a === "--force-with-lease" || a.startsWith("--force-with-lease="));
      // These push every branch (and --mirror force-updates and deletes to match), so they
      // reach the protected ones whatever is checked out. The pipeline pushes one branch.
      const pushesAll = args.find((a) => ["--mirror", "--all", "--branches", "--prune"].includes(a));
      // Refspecs are the positional args after the remote: `push origin main`,
      // `push origin HEAD:main`, `push origin :main`, plus the `--delete main` form.
      const positional = args.filter((a) => !a.startsWith("-"));
      const di = args.findIndex((a) => a === "--delete" || a === "-d");
      const targetsProtected =
        positional.slice(1).some((r) => isProtected(refDest(r), repoCwd)) ||
        (di >= 0 && di + 1 < args.length && isProtected(refDest(args[di + 1]), repoCwd));

      if (hasForce) block("force-push is never allowed by the AIDLC pipeline.");
      if (pushesAll) block(`\`git push ${pushesAll}\` updates every branch, protected ones included — push the work branch by name.`);
      if (hasForceWithLease && (onProtected || targetsProtected))
        block(`force-with-lease to a protected branch ('${branch || "target"}') is not allowed.`);
      if (onProtected)
        block(
          `push while on protected branch '${branch}'${dashC ? ` in ${dashC}` : ""} — work on a ` +
            `{type}/{id}-{slug} branch and open a PR.`,
        );
      if (targetsProtected)
        block("push explicitly targeting a protected branch — all changes reach it through PRs.");
    }

    // --- 2. History rewriting (git-specific) ---
    if (sub === "filter-branch" || sub === "filter-repo")
      block("git history rewriting is not allowed in the pipeline.");

    // --- 2b. Accidental gitlink (a nested repo staged as a submodule) ---
    // In a poly workspace the control plane holds each product repo as a subfolder
    // with its own .git. If one isn't ignored, `git add -A` at the control plane
    // stages it as a mode-160000 gitlink with no .gitmodules entry — it clones as
    // an empty directory and git reports no error, so nothing else catches it.
    // The index is already written by the time a commit runs, so inspect it here.
    if (sub === "commit") {
      const links = stagedGitlinks(repoCwd);
      if (links.length)
        block(
          `staging a nested git repository as a gitlink (${links.join(", ")}). This would commit a ` +
            `submodule reference with no .gitmodules entry, which clones as an empty directory. ` +
            `Product repos are versioned independently — add the path to this repo's .gitignore ` +
            `(the # AIDLC:REPOS block), then \`git reset -- <path>\` to unstage it (index only; your ` +
            `checkout is untouched). If it was already committed, \`git rm --cached -rf <path>\`.`,
        );
    }

    // The content checks below are dangerous only when NOT run by git — git executes
    // no SQL, cluster, filesystem or credential operations. Skipping git segments is
    // what stops a commit message that merely mentions these from tripping the guard.
    return;
  }

  // --- 2c. Env-file access on the shell path (backstop for the env-guard hook) ---
  // At `deny` this blocks; at `ask` it PROMPTS. It used to step aside at `ask` and let
  // "the normal permission flow" handle it — but there is no such flow here: env-guard
  // sits on the file tools, and the shell tools match none of them. So `ask` meant a
  // silent allow, and `cat .env` printed secrets with nothing asked. A PreToolUse hook may
  // return `permissionDecision: "ask"` for any tool, so the shell path raises the same
  // prompt the tool path does and the switch finally means one thing on both.
  //
  // The switch is resolved from each env path's OWN location, so a poly product-repo env
  // file sees the control-plane setting regardless of the session cwd.
  const written = [...writeTargets(argv), ...redirections(rawSeg).filter((r) => r.op === ">").map((r) => r.target)];
  const wt = written.find(isEnvBase);
  if (wt) {
    const shown = argValue(wt);
    if (envAccessFor(shown) !== "ask")
      block(
        `writing env file '${shown}' from a shell command is blocked — env files can hold secrets. ` +
          `Set "pipeline.envFileAccess": "ask" in .claude/aidlc.config.json to allow it with your ` +
          `per-change approval; prefer the Write/Edit tools, which show the diff. Do not edit that ` +
          `config yourself — ask the user to.`,
      );
    askFirst(
      `AIDLC: this shell command writes the env file '${shown}'. Env files can hold secrets, and a ` +
        `shell write does not show you a diff the way the Edit/Write tools do — approve it only if ` +
        `you know what it puts there.`,
    );
  }
  // (Copying an env file somewhere else is a read of it: copiers are readers in readOperands.)
  const rt = envReadTarget(argv, rawSeg);
  if (rt) {
    if (envAccessFor(rt) !== "ask")
      block(
        `reading env file '${rt}' from a shell command is blocked — the pipeline never needs secret ` +
          `values. Set "pipeline.envFileAccess": "ask" in .claude/aidlc.config.json to allow it. ` +
          `Ask the user to flip it — do not edit that config yourself.`,
      );
    askFirst(
      `AIDLC: this shell command reads the env file '${rt}', which puts its VALUES — secrets ` +
        `included — into the transcript. Approve only if the pipeline genuinely needs them; the ` +
        `variable names alone live in .env.example.`,
    );
  }

  // --- 2d. The guardrails themselves (settings, hooks, git config) ---
  for (const t of written) checkProtectedWrite(t);

  // --- 3. Destructive DB operations outside localhost ---
  if (/\b(DROP\s+(DATABASE|SCHEMA)|TRUNCATE\s+TABLE|db\.dropDatabase)\b/i.test(rawSeg)) {
    const local = /(localhost|127\.0\.0\.1|@db\b|@postgres\b|@mongo\b)/i.test(rawSeg);
    if (!local)
      block("destructive DB operation (DROP/TRUNCATE/dropDatabase) without an explicit localhost target.");
  }

  // --- 4. Anything that smells like production ---
  if (/\b(psql|mongosh|mongo|mysql)\b/i.test(rawSeg) && /\b(prod|production)\b/i.test(rawSeg))
    block("database shell targeting something named 'prod' — production access is off-limits.");
  if (/\b(kubectl|helm)\b[^|;&]*\b(prod|production)\b/i.test(rawSeg))
    block("cluster command targeting a production context.");

  // --- 5. Reading (or copying out) private keys and cloud credentials ---
  const st = secretReadTarget(argv);
  if (st) block(`reading or copying a private key / credential store ('${st}').`);

  // Backstop for the same check. The argv form above is precise and is what catches
  // `head`/`base64`/`cp` — but a reader invoked through a NESTED shell
  // (`bash -c "cat ~/.ssh/id_rsa"`) is not argv[0] of this segment, and the raw-segment
  // regex this replaced did catch that shape. Keeping both is deliberate: widening a
  // guard must never quietly narrow it somewhere else, and the cost is a false positive
  // on a segment that merely mentions both a reader and a key path — loud, not silent.
  // (Git segments never reach here, so commit messages are already exempt.)
  if (SECRET_PATH_RE.test(rawSeg) && SECRET_READER_RE.test(rawSeg))
    block("reading private keys or cloud credentials.");

  // --- 6. Recursive delete escaping the project (or deleting the project itself) ---
  for (const t of recursiveDeleteTargets(argv)) {
    const verdict = deleteEscapes(t);
    if (verdict === "outside")
      block(`recursive delete of a path outside the project (${t} → ${resolveShellPath(cwd, t, toolName)}).`);
    if (verdict === "unexpandable")
      block(
        `recursive delete of a path the shell expands before it runs (${t}), so its real target ` +
          `cannot be checked here. If it is inside the project, spell it relative to the project root.`,
      );
    if (verdict === "root") block(`recursive delete of the project root itself (${t}).`);
  }
}

function main(data) {
  toolName = str(data.tool_name) || "Bash";
  cmd = str(data.tool_input && data.tool_input.command);
  if (!cmd) process.exit(0);
  cwd = cwdOf(data);

  for (const rawSeg of expandSegments(cmd)) checkSegment(rawSeg);

  // --- 7. Secret exfiltration (spans a pipe, so evaluate on the whole command) ---
  // Env files were the only source covered here, so `cat ~/.ssh/id_rsa | curl -d @- …`
  // was not exfiltration as far as this check was concerned. PowerShell's web cmdlets are
  // the same channel under different names.
  const EXFIL_SRC = String.raw`(?:\.env\b|${SECRET_PATH_SRC})`;
  const SENDERS = String.raw`(?:curl|wget|nc|ncat|invoke-webrequest|iwr|invoke-restmethod|irm)`;
  if (
    new RegExp(`${EXFIL_SRC}[^;&]*\\|\\s*${SENDERS}\\b`, "i").test(cmd) ||
    new RegExp(`\\b${SENDERS}\\b[^|;&]*(?:-d|--data|--data-binary|--data-raw|--upload-file|-F|-T|-infile|-body)[^|;&]*${EXFIL_SRC}`, "i").test(cmd)
  )
    block("piping or uploading secret material (env file, private key or credential store) over the network.");

  // Nothing blocked. If some segment wanted confirmation, ask for it now — after every
  // check in the file has had its say.
  if (pendingAsk) ask(pendingAsk);
  process.exit(0);
}

runGuard("guard", main);
