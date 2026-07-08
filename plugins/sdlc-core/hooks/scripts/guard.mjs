#!/usr/bin/env node
// PreToolUse[Bash] guard — blocks dangerous commands that static permission
// patterns cannot express (branch-aware force-push, prod DB ops, secret exfil).
// Exit 2 = block (stderr shown to the model). Exit 0 = allow. Never throw.
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
  process.stderr.write(`SDLC guard blocked this command: ${reason}`);
  process.exit(2);
}

function currentBranch() {
  // symbolic-ref works even on an unborn branch (fresh repo, no commits)
  try {
    return execSync("git symbolic-ref --short HEAD", {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

// --- 1. Push protection (branch-aware; static deny rules are layer 1) ---
// Evaluated per shell segment so flags from OTHER commands in a compound line
// (`rm -f x && git push`) don't leak into the push check.
// PROTECTED requires end-of-word (branch "develop-feature" must not match "develop").
const PROTECTED = String.raw`(?:main|master|develop)(?![\w\/-])`;
const pushSegments = cmd.split(/[|;&]+/).filter((s) => /\bgit\b[^]*\bpush\b/.test(s));
if (pushSegments.length) {
  const branch = currentBranch();
  const onProtected = /^(main|master|develop|release\/.+)$/.test(branch);
  for (const seg of pushSegments) {
    const hasForce = /(\s--force\b(?!-with-lease))|(\s-f\b)|(\s['"]?\+\S+)/.test(seg);
    const hasForceWithLease = /--force-with-lease/.test(seg);
    // `push origin main`, `push origin HEAD:main`, delete forms `push origin :main` / `--delete main`
    const targetsProtected =
      new RegExp(String.raw`\bpush\b[^]*\s(?:\S+\s+)?(?:\S*:)?${PROTECTED}`).test(seg) ||
      new RegExp(String.raw`--delete\s+${PROTECTED}`).test(seg);

    if (hasForce) block("force-push is never allowed by the SDLC pipeline.");
    if (hasForceWithLease && (onProtected || targetsProtected))
      block(`force-with-lease to a protected branch ('${branch || "target"}') is not allowed.`);
    if (onProtected)
      block(`push while on protected branch '${branch}' — work on a {type}/{id}-{slug} branch and open a PR.`);
    if (targetsProtected)
      block("push explicitly targeting a protected branch — all changes reach it through PRs.");
  }
}

// --- 2. Destructive DB operations outside localhost ---
if (/\b(DROP\s+(DATABASE|SCHEMA)|TRUNCATE\s+TABLE|db\.dropDatabase)\b/i.test(cmd)) {
  const local = /(localhost|127\.0\.0\.1|@db\b|@postgres\b|@mongo\b)/i.test(cmd);
  if (!local)
    block("destructive DB operation (DROP/TRUNCATE/dropDatabase) without an explicit localhost target.");
}

// --- 3. Anything that smells like production ---
if (/\b(psql|mongosh|mongo|mysql)\b/.test(cmd) && /\b(prod|production)\b/i.test(cmd))
  block("database shell targeting something named 'prod' — production access is off-limits.");
if (/\b(kubectl|helm)\b[^|;&]*\b(prod|production)\b/i.test(cmd))
  block("cluster command targeting a production context.");

// --- 4. Secret exfiltration patterns ---
if (
  /\.env[^|;&]*\|\s*(curl|wget|nc|ncat)\b/.test(cmd) ||
  /\b(curl|wget)\b[^|;&]*(-d|--data|--upload-file|-F)[^|;&]*\.env/.test(cmd)
)
  block("piping or uploading .env content over the network.");
if (/\b(cat|type|Get-Content)\b[^|;&]*(\.ssh[\\\/]|id_rsa|\.aws[\\\/]credentials)/.test(cmd))
  block("reading private keys or cloud credentials.");

// --- 5. Recursive delete outside the repo ---
const rmMatch = cmd.match(/\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)\s+(\S+)/);
if (rmMatch) {
  const target = rmMatch[2].replace(/["']/g, "");
  const cwdFwd = cwd.replace(/\\/g, "/");
  if (/^([A-Za-z]:)?[\\\/]+\S*$|^~/.test(target) && !target.startsWith(cwd) && !target.startsWith(cwdFwd))
    block(`recursive delete of an absolute path outside the project (${target}).`);
}
if (/Remove-Item\b[^|;&]*-Recurse/.test(cmd)) {
  const abs = cmd.match(/Remove-Item\b[^|;&]*?(([A-Za-z]:[\\\/]|~)[^\s|;&]*)/);
  if (abs && !abs[1].startsWith(cwd) && !abs[1].startsWith(cwd.replace(/\\/g, "/")))
    block(`recursive Remove-Item on an absolute path outside the project (${abs[1]}).`);
}

// --- 6. History rewriting ---
if (/\bgit\s+(filter-branch|filter-repo)\b/.test(cmd))
  block("git history rewriting is not allowed in the pipeline.");

process.exit(0);
