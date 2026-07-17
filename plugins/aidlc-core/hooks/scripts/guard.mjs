#!/usr/bin/env node
// PreToolUse[Bash] guard — blocks dangerous commands that static permission
// patterns cannot express (branch-aware force-push, prod DB ops, secret exfil).
// Exit 2 = block (stderr shown to the model). Exit 0 = allow. Never throw.
//
// Principle: inspect the COMMAND BEING EXECUTED, not free text. Quoted argument
// text (a commit message that mentions "push", "DROP TABLE", "filter-branch", …)
// is stripped before command-identity detection, and the content checks are skipped
// for `git` segments — git executes no SQL, cluster, filesystem or credential ops,
// so those tokens in a git command can only be message/branch text.
import { readFileSync } from "node:fs";
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

// Current branch, computed lazily and once — only push checks need it, so
// non-git commands never pay for the subprocess.
let _branch;
let _branchDone = false;
function branchInfo() {
  if (!_branchDone) {
    _branchDone = true;
    try {
      // symbolic-ref works even on an unborn branch (fresh repo, no commits)
      _branch = execSync("git symbolic-ref --short HEAD", {
        cwd,
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5000,
      })
        .toString()
        .trim();
    } catch {
      _branch = "";
    }
  }
  return { branch: _branch, onProtected: /^(main|master|develop|release\/.+)$/.test(_branch) };
}

// Blank the contents of quoted strings so words inside an argument (e.g. a -m
// commit message) can't masquerade as command tokens.
const stripQuotes = (s) => s.replace(/'[^']*'/g, " ").replace(/"[^"]*"/g, " ");

// Leading executable of a segment, ignoring env assignments and sudo, path-stripped.
function leadingExe(seg) {
  const s = seg
    .trim()
    .replace(/^(?:\w+=\S+\s+)*/, "")
    .replace(/^sudo\s+(?:-\S+\s+)*/, "");
  const m = s.match(/^\S+/);
  if (!m) return "";
  return m[0].replace(/^['"]|['"]$/g, "").split(/[\\/]/).pop();
}

// PROTECTED requires end-of-word (branch "develop-feature" must not match "develop").
const PROTECTED = String.raw`(?:main|master|develop)(?![\w\/-])`;
// `git push` as an ACTUAL invocation: git, optional global options (-c x=y, -C path,
// --opt[=val], -p …), then the `push` subcommand — not the word "push" in an argument.
const GIT_PUSH = String.raw`\bgit\b(?:\s+(?:-c\s+\S+|-C\s+\S+|--[\w-]+(?:=\S+)?|-\w+))*\s+push\b`;

// Segment per shell separator so flags/tokens from OTHER commands in a compound line
// (`rm -f x && git push`) don't leak across the checks.
for (const rawSeg of cmd.split(/[|;&]+/)) {
  const skel = stripQuotes(rawSeg); // quotes blanked — command-identity checks
  const isGit = leadingExe(rawSeg) === "git";

  // --- 1. Push protection (branch-aware; static deny rules are layer 1) ---
  if (new RegExp(GIT_PUSH).test(skel)) {
    const { branch, onProtected } = branchInfo();
    const hasForce = /(\s--force\b(?!-with-lease))|(\s-f\b)|(\s['"]?\+\S+)/.test(skel);
    const hasForceWithLease = /--force-with-lease/.test(skel);
    // `push origin main`, `push origin HEAD:main`, delete forms `push origin :main` / `--delete main`
    const targetsProtected =
      new RegExp(String.raw`\bpush\b[^]*\s(?:\S+\s+)?(?:\S*:)?${PROTECTED}`).test(skel) ||
      new RegExp(String.raw`--delete\s+${PROTECTED}`).test(skel);

    if (hasForce) block("force-push is never allowed by the AIDLC pipeline.");
    if (hasForceWithLease && (onProtected || targetsProtected))
      block(`force-with-lease to a protected branch ('${branch || "target"}') is not allowed.`);
    if (onProtected)
      block(`push while on protected branch '${branch}' — work on a {type}/{id}-{slug} branch and open a PR.`);
    if (targetsProtected)
      block("push explicitly targeting a protected branch — all changes reach it through PRs.");
  }

  // --- 2. History rewriting (git-specific) ---
  if (/\bgit\s+(filter-branch|filter-repo)\b/.test(skel))
    block("git history rewriting is not allowed in the pipeline.");

  // The content checks below are dangerous only when NOT run by git — git executes
  // no SQL, cluster, filesystem or credential operations. Skipping git segments is
  // what stops a commit message that merely mentions these from tripping the guard.
  if (isGit) continue;

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
