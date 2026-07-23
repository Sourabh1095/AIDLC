// Regression tests for env-guard.mjs. Run: `node env-guard.test.mjs` (tests the
// sibling env-guard.mjs) or `node env-guard.test.mjs <path-to-env-guard.mjs>`.
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const GUARD = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), "env-guard.mjs");

// Build a workspace whose .claude/aidlc.config.json carries the given envFileAccess.
// `access === null` writes a config WITHOUT the key; `access === "none"` writes no
// config file at all; `access === "bad"` writes malformed JSON.
function workspace(access) {
  const dir = mkdtempSync(join(tmpdir(), "envguard-"));
  if (access !== "none") {
    mkdirSync(join(dir, ".claude"), { recursive: true });
    let body;
    if (access === "bad") body = "{ this is not json ";
    else if (access === null) body = JSON.stringify({ pipeline: { autonomy: "high" } });
    else body = JSON.stringify({ pipeline: { envFileAccess: access } });
    writeFileSync(join(dir, ".claude", "aidlc.config.json"), body);
  }
  return dir;
}

// Returns "block" (exit 2) | "ask" (exit 0 + permissionDecision:ask) | "allow" (exit 0, no decision).
function run(toolName, filePath, cwd) {
  let code = 0;
  let out = "";
  try {
    out = execFileSync("node", [GUARD], {
      input: JSON.stringify({ tool_name: toolName, tool_input: { file_path: filePath }, cwd }),
      stdio: ["pipe", "pipe", "pipe"],
    }).toString();
  } catch (e) {
    code = typeof e.status === "number" ? e.status : -1;
    out = (e.stdout || "").toString();
  }
  if (code === 2) return "block";
  if (code !== 0) return `exit${code}`;
  try {
    const j = JSON.parse(out);
    if (j?.hookSpecificOutput?.permissionDecision === "ask") return "ask";
  } catch {
    /* not JSON → allow */
  }
  return "allow";
}

let fails = 0;
let n = 0;
function check(tool, path, cwd, expected, label) {
  n++;
  const got = run(tool, path, cwd);
  if (got !== expected) {
    fails++;
    console.log(`FAIL [${label}] expected=${expected} got=${got}\n       ${tool} ${path}`);
  } else {
    console.log(`ok   [${label}] ${expected}`);
  }
}

const deny = workspace("deny");
const ask = workspace("ask");
const absent = workspace(null); // config present but no envFileAccess key
const noConfig = workspace("none"); // no config file at all
const bad = workspace("bad"); // malformed config

// A poly workspace: the switch lives once at the control-plane root; product repos are
// subfolders that each carry their own env files but NO config of their own.
function polyWorkspace(access) {
  const root = mkdtempSync(join(tmpdir(), "envguard-poly-"));
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(join(root, ".claude", "aidlc.config.json"), JSON.stringify({ pipeline: { envFileAccess: access } }));
  const sub = join(root, "core-api");
  mkdirSync(join(sub, "config"), { recursive: true });
  return { root, sub };
}
const polyAsk = polyWorkspace("ask");
const polyDeny = polyWorkspace("deny");
// An orphan tree with no config anywhere up to the filesystem root.
const orphanRoot = mkdtempSync(join(tmpdir(), "envguard-orphan-"));
const orphanSub = join(orphanRoot, "svc");
mkdirSync(orphanSub, { recursive: true });

try {
  // ===== envFileAccess = "deny" (explicit) → block every env file, allow the rest =====
  check("Read", ".env", deny, "block", "deny: read .env");
  check("Edit", ".env.example", deny, "block", "deny: edit .env.example");
  check("Write", ".env.local", deny, "block", "deny: write .env.local");
  check("Write", ".env.production.local", deny, "block", "deny: write nested-suffix env");
  check("Edit", "backend/.env", deny, "block", "deny: edit poly-subfolder .env");
  check("Read", "apps/web/.env.example", deny, "block", "deny: read monorepo .env.example");
  // Non-env files are never touched by this guard.
  check("Read", "src/index.ts", deny, "allow", "deny: read source file");
  check("Edit", "package.json", deny, "allow", "deny: edit package.json");
  check("Read", ".envrc", deny, "allow", "deny: .envrc is not an env file");
  check("Write", ".env-sample", deny, "allow", "deny: .env-sample is not an env file");
  check("Read", "config/database.env", deny, "allow", "deny: foo.env basename is not .env*");

  // ===== envFileAccess = "ask" → prompt for env files, still ignore the rest =====
  check("Read", ".env", ask, "ask", "ask: read .env");
  check("Edit", ".env.example", ask, "ask", "ask: edit .env.example");
  check("Write", "apps/web/.env.production", ask, "ask", "ask: write monorepo env");
  check("Read", "src/index.ts", ask, "allow", "ask: read source file untouched");
  check("Read", ".envrc", ask, "allow", "ask: .envrc untouched");

  // ===== fail-closed: config absent / missing / malformed → deny =====
  check("Read", ".env", absent, "block", "no envFileAccess key → deny");
  check("Edit", ".env.example", noConfig, "block", "no config file → deny");
  check("Write", ".env", bad, "block", "malformed config → deny");
  // …but non-env files still pass even when the config is unreadable.
  check("Read", "src/index.ts", noConfig, "allow", "no config, non-env → allow");

  // ===== poly / subfolder cwd: the switch is resolved from the env file's OWN location,
  // walking up to the nearest (control-plane) config — the session cwd is irrelevant.
  // The 0.28.x cwd-anchored read blocked these even in a workspace that opted in (F50). =====
  check("Edit", join(polyAsk.sub, ".env.example"), polyAsk.sub, "ask", "poly ask: edit subrepo env, cwd=subrepo");
  check("Read", ".env", polyAsk.sub, "ask", "poly ask: read subrepo env by basename, cwd=subrepo");
  check("Edit", "core-api/.env.example", polyAsk.root, "ask", "poly ask: edit subrepo env, cwd=control plane");
  check("Write", join(polyAsk.sub, "config", ".env.local"), polyAsk.sub, "ask", "poly ask: deep subrepo env resolves up");
  check("Edit", join(polyDeny.sub, ".env.example"), polyDeny.sub, "block", "poly deny: control-plane deny blocks subrepo env");
  check("Edit", join(orphanSub, ".env"), orphanSub, "block", "poly: no config anywhere up the tree → deny (fail closed)");
} finally {
  for (const d of [deny, ask, absent, noConfig, bad, polyAsk.root, polyDeny.root, orphanRoot])
    rmSync(d, { recursive: true, force: true });
}

console.log(`\n${n - fails}/${n} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
