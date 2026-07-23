#!/usr/bin/env node
// PreToolUse[Bash] guard — blocks dangerous commands that static permission
// patterns cannot express (branch-aware force-push, prod DB ops, secret exfil).
// Exit 2 = block (stderr shown to the model). Exit 0 = allow. Never throw.
//
// Principle: inspect the COMMAND BEING EXECUTED, not free text. A git segment is
// tokenized into argv and parsed (global options → subcommand → args), so a commit
// message that merely mentions "push", "DROP TABLE" or "filter-branch" is one opaque
// argument and can never be read as a command. Content checks are skipped for `git`
// segments — git executes no SQL, cluster, filesystem or credential ops.
//
// Poly workspaces: the session cwd is the control plane, and the pipeline reaches a
// product repo with `git -C <path> …` (aidlc:run §2.5). Every repo-state check below
// therefore resolves against the `-C` target, NOT the session cwd — the control plane
// sits on `main` permanently, so reading HEAD from cwd blocks every legitimate
// feature-branch push (F46).
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";

let data;
try {
  data = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.exit(0);
}

const cmd = (data.tool_input && data.tool_input.command) || "";
if (!cmd) process.exit(0);
const cwd = data.cwd || process.cwd();

function block(reason) {
  process.stderr.write(`AIDLC guard blocked this command: ${reason}`);
  process.exit(2);
}

const PROTECTED_RE = /^(?:main|master|develop|release\/.+)$/;

// Current branch of a specific repo, computed lazily and cached per path — only push
// checks need it, so non-git commands never pay for the subprocess.
const _branches = new Map();
function branchInfo(repoCwd) {
  if (!_branches.has(repoCwd)) {
    let b = "";
    try {
      // symbolic-ref works even on an unborn branch (fresh repo, no commits)
      b = execSync("git symbolic-ref --short HEAD", {
        cwd: repoCwd,
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5000,
      })
        .toString()
        .trim();
    } catch {
      b = "";
    }
    _branches.set(repoCwd, b);
  }
  const branch = _branches.get(repoCwd);
  return { branch, onProtected: PROTECTED_RE.test(branch) };
}

// Gitlinks (mode 160000) newly staged in this repo's index, excluding paths
// registered as real submodules in .gitmodules. Only called for an actual
// `git commit`, so non-commit commands never pay for the subprocesses. Any
// failure (not a repo, git missing) returns [] — never block on uncertainty.
function stagedGitlinks(repoCwd) {
  let top, raw;
  try {
    const opts = { cwd: repoCwd, stdio: ["ignore", "pipe", "ignore"], timeout: 5000 };
    top = execSync("git rev-parse --show-toplevel", opts).toString().trim();
    // ":<srcmode> <dstmode> <srcsha> <dstsha> <status>\t<path>" — works on an
    // unborn branch too (diffed against the empty tree). dstmode 160000 = a
    // gitlink being written; a deletion has dstmode 000000 and is fine.
    raw = execSync("git diff --cached --raw", opts).toString();
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

// Split a shell segment into argv, honouring quotes. A quoted argument stays ONE
// token, so its contents can never be mistaken for a flag or a subcommand. Parsing
// (rather than regex-matching quote-blanked text) is what makes the checks below
// fail closed: a path containing a space used to defeat the old `-C\s+\S+` pattern
// and silently skip every push check (F46).
function tokenize(seg) {
  const out = [];
  let cur = "";
  let quote = null;
  let quoted = false;
  for (const c of seg) {
    if (quote) {
      if (c === quote) quote = null;
      else cur += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      quoted = true;
    } else if (/\s/.test(c)) {
      if (cur || quoted) out.push(cur);
      cur = "";
      quoted = false;
    } else cur += c;
  }
  if (cur || quoted) out.push(cur);
  return out;
}

// argv with leading env assignments and sudo removed.
function commandArgv(seg) {
  const argv = tokenize(seg);
  while (argv.length && /^\w+=/.test(argv[0])) argv.shift();
  if (argv.length && argv[0].split(/[\\/]/).pop() === "sudo") {
    argv.shift();
    while (argv.length && argv[0].startsWith("-")) argv.shift();
  }
  return argv;
}

// git global options that consume a SEPARATE following value.
const GIT_VALUE_OPTS = new Set(["-c", "-C", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--super-prefix"]);

// Parse `git [global-opts] <subcommand> [args…]`, returning the -C target so repo
// state is read from the repo actually being acted on.
// Subcommands with a dedicated check below; also the fail-closed rescan set.
const GUARDED_SUBS = new Set(["push", "commit", "filter-branch", "filter-repo"]);

function parseGit(argv) {
  let i = 1;
  let dashC = null;
  while (i < argv.length && argv[i].startsWith("-")) {
    if (GIT_VALUE_OPTS.has(argv[i])) {
      if (argv[i] === "-C" && i + 1 < argv.length) dashC = argv[i + 1];
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
    if (j >= 0) return { dashC: null, sub: argv[j], args: argv.slice(j + 1), unresolved: true };
  }
  return { dashC, sub, args, unresolved: false };
}

// Destination ref of a refspec: `HEAD:main` / `:main` / `+main` → `main`.
const refDest = (r) => (r.includes(":") ? r.slice(r.lastIndexOf(":") + 1) : r).replace(/^\+/, "");

// --- Env-file access backstop -------------------------------------------------------
// The env-guard hook governs the Read|Edit|Write TOOLS; a shell command that reads or
// writes an env file bypasses it. This mirrors the same switch on the Bash path. The
// harness `deny` on env was removed so the switch could work, so this is what keeps the
// default-deny honest for shell commands. Reads pipeline.envFileAccess once; fails closed.
const isEnvBase = (t) => {
  const b = String(t)
    .replace(/^['"]|['"]$/g, "")
    .replace(/\\/g, "/")
    .split("/")
    .pop();
  return /^\.env(\.|$)/.test(b);
};

let _access;
function envFileAccess(dir) {
  if (_access !== undefined) return _access;
  _access = "deny";
  try {
    const cfg = JSON.parse(readFileSync(join(dir, ".claude", "aidlc.config.json"), "utf8"));
    if (cfg && cfg.pipeline && cfg.pipeline.envFileAccess === "ask") _access = "ask";
  } catch {
    /* no/unreadable config → deny */
  }
  return _access;
}

// Target of an output redirection whose basename is an env file — quote-aware, so a
// quoted ">.env" inside an echo string is NOT read as a real redirect (the same
// parse-don't-regex principle the git checks use). Returns the path, or "".
function envRedirectTarget(seg) {
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
    if (c === ">") {
      let j = i + 1;
      if (seg[j] === ">") j++; // >>
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
      if (target && isEnvBase(target)) return target.replace(/^['"]|['"]$/g, "");
    }
  }
  return "";
}

// A command that writes a file to an env path: tee/cp/mv/install/dd of=/truncate, or an
// in-place sed. Returns the env path, or "".
function envCmdWriteTarget(argv) {
  const cmd = argv[0] ? argv[0].split(/[\\/]/).pop() : "";
  if (["tee", "cp", "mv", "install", "dd", "truncate"].includes(cmd)) {
    for (const a of argv.slice(1)) {
      if (isEnvBase(a)) return a.replace(/^['"]|['"]$/g, "");
      if (/^of=/.test(a) && isEnvBase(a.slice(3))) return a.slice(3);
    }
  }
  if (cmd === "sed" && argv.some((a) => a === "-i" || /^-i\S*$/.test(a))) {
    const t = argv.slice(1).find(isEnvBase);
    if (t) return t.replace(/^['"]|['"]$/g, "");
  }
  return "";
}

// A file-dumping reader (cat/type/Get-Content/head/…) pointed at an env file. Returns
// the env path, or "".
const ENV_READERS = new Set(["cat", "type", "Get-Content", "gc", "bat", "less", "more", "head", "tail", "nl", "xxd", "od"]);
function envReadTarget(argv) {
  const cmd = argv[0] ? argv[0].split(/[\\/]/).pop() : "";
  if (!ENV_READERS.has(cmd)) return "";
  const t = argv.slice(1).find(isEnvBase);
  return t ? t.replace(/^['"]|['"]$/g, "") : "";
}

// Segment per shell separator so flags/tokens from OTHER commands in a compound line
// (`rm -f x && git push`) don't leak across the checks.
for (const rawSeg of cmd.split(/[|;&]+/)) {
  const argv = commandArgv(rawSeg);
  const isGit = argv.length > 0 && argv[0].split(/[\\/]/).pop() === "git";

  if (isGit) {
    const { dashC, sub, args } = parseGit(argv);
    // Every repo-state check resolves against the -C target, not the session cwd.
    const repoCwd = dashC ? resolve(cwd, dashC) : cwd;

    // --- 1. Push protection (branch-aware; static deny rules are layer 1) ---
    if (sub === "push") {
      const { branch, onProtected } = branchInfo(repoCwd);
      const hasForce = args.some(
        (a) => a === "--force" || (/^-[a-zA-Z]*f[a-zA-Z]*$/.test(a) && !a.startsWith("--")) || a.startsWith("+"),
      );
      const hasForceWithLease = args.some((a) => a === "--force-with-lease" || a.startsWith("--force-with-lease="));
      // Refspecs are the positional args after the remote: `push origin main`,
      // `push origin HEAD:main`, `push origin :main`, plus the `--delete main` form.
      const positional = args.filter((a) => !a.startsWith("-"));
      const di = args.findIndex((a) => a === "--delete" || a === "-d");
      const targetsProtected =
        positional.slice(1).some((r) => PROTECTED_RE.test(refDest(r))) ||
        (di >= 0 && di + 1 < args.length && PROTECTED_RE.test(refDest(args[di + 1])));

      if (hasForce) block("force-push is never allowed by the AIDLC pipeline.");
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
    continue;
  }

  // --- 2c. Env-file access on the Bash path (backstop for the env-guard hook) ---
  // Unless the workspace opted in with pipeline.envFileAccess: "ask", block reading or
  // writing an env file from a shell command. Under "ask" we step aside and let the
  // normal permission flow prompt (the Read/Edit/Write tools are the governed path).
  if (envFileAccess(cwd) !== "ask") {
    const wt = envRedirectTarget(rawSeg) || envCmdWriteTarget(argv);
    if (wt)
      block(
        `writing env file '${wt}' from a shell command is blocked by default — env files can ` +
          `hold secrets. Set "pipeline.envFileAccess": "ask" in .claude/aidlc.config.json to allow ` +
          `it with your per-change approval (default "deny"); prefer the Write/Edit tools, which ` +
          `prompt per change. Do not edit that config yourself — ask the user to.`,
      );
    const rt = envReadTarget(argv);
    if (rt)
      block(
        `reading env file '${rt}' from a shell command is blocked by default — the pipeline never ` +
          `needs secret values. Set "pipeline.envFileAccess": "ask" in .claude/aidlc.config.json to ` +
          `allow it (default "deny"). Ask the user to flip it — do not edit that config yourself.`,
      );
  }

  // --- 3. Destructive DB operations outside localhost ---
  if (/\b(DROP\s+(DATABASE|SCHEMA)|TRUNCATE\s+TABLE|db\.dropDatabase)\b/i.test(rawSeg)) {
    const local = /(localhost|127\.0\.0\.1|@db\b|@postgres\b|@mongo\b)/i.test(rawSeg);
    if (!local)
      block("destructive DB operation (DROP/TRUNCATE/dropDatabase) without an explicit localhost target.");
  }

  // --- 4. Anything that smells like production ---
  if (/\b(psql|mongosh|mongo|mysql)\b/.test(rawSeg) && /\b(prod|production)\b/i.test(rawSeg))
    block("database shell targeting something named 'prod' — production access is off-limits.");
  if (/\b(kubectl|helm)\b[^|;&]*\b(prod|production)\b/i.test(rawSeg))
    block("cluster command targeting a production context.");

  // --- 5. Reading private keys / cloud credentials ---
  if (/\b(cat|type|Get-Content)\b[^|;&]*(\.ssh[\\\/]|id_rsa|\.aws[\\\/]credentials)/.test(rawSeg))
    block("reading private keys or cloud credentials.");

  // --- 6. Recursive delete outside the repo ---
  const rmMatch = rawSeg.match(/\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)\s+(\S+)/);
  if (rmMatch) {
    const target = rmMatch[2].replace(/["']/g, "");
    const cwdFwd = cwd.replace(/\\/g, "/");
    if (/^([A-Za-z]:)?[\\\/]+\S*$|^~/.test(target) && !target.startsWith(cwd) && !target.startsWith(cwdFwd))
      block(`recursive delete of an absolute path outside the project (${target}).`);
  }
  if (/Remove-Item\b[^|;&]*-Recurse/.test(rawSeg)) {
    const abs = rawSeg.match(/Remove-Item\b[^|;&]*?(([A-Za-z]:[\\\/]|~)[^\s|;&]*)/);
    if (abs && !abs[1].startsWith(cwd) && !abs[1].startsWith(cwd.replace(/\\/g, "/")))
      block(`recursive Remove-Item on an absolute path outside the project (${abs[1]}).`);
  }
}

// --- 7. Secret exfiltration (spans a pipe, so evaluate on the whole command) ---
if (
  /\.env[^|;&]*\|\s*(curl|wget|nc|ncat)\b/.test(cmd) ||
  /\b(curl|wget)\b[^|;&]*(-d|--data|--upload-file|-F)[^|;&]*\.env/.test(cmd)
)
  block("piping or uploading .env content over the network.");

process.exit(0);
