// Tests for protect-paths.mjs — the Edit/Write/NotebookEdit guard on the pipeline's own
// guardrails. Run: `node protect-paths.test.mjs`. It had no tests before; the probe that
// found its case-sensitivity gap is the first row of each group.
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = join(HERE, "protect-paths.mjs");

const ws = mkdtempSync(join(tmpdir(), "protect-"));
mkdirSync(join(ws, ".claude"), { recursive: true });
writeFileSync(join(ws, ".claude", "settings.json"), "{}");
writeFileSync(join(ws, ".claude", "aidlc.config.json"), JSON.stringify({ pipeline: { envFileAccess: "deny" } }));
const fresh = mkdtempSync(join(tmpdir(), "protect-fresh-"));

function run(toolName, toolInput, cwd = ws) {
  let code = 0;
  let out = "";
  try {
    out = execFileSync("node", [HOOK], {
      input: typeof toolInput === "string" ? toolInput : JSON.stringify({ tool_name: toolName, tool_input: toolInput, cwd }),
      stdio: ["pipe", "pipe", "pipe"],
    }).toString();
  } catch (e) {
    code = typeof e.status === "number" ? e.status : -1;
    out = (e.stdout || "").toString();
  }
  if (code === 2) return "block";
  if (code !== 0) return `exit${code}`;
  return out.includes('"ask"') ? "ask" : "allow";
}

let fails = 0;
let n = 0;
function check(toolName, toolInput, expected, label, cwd) {
  n++;
  const got = run(toolName, toolInput, cwd);
  if (got !== expected) {
    fails++;
    console.log(`FAIL [${label}] expected=${expected} got=${got}`);
  } else console.log(`ok   [${label}] ${expected}`);
}

const settings = join(ws, ".claude", "settings.json");
const insensitive = process.platform !== "linux";

// ===== Permission settings =====
check("Edit", { file_path: settings }, "block", "settings: existing file");
check("Edit", { file_path: settings.replace(".claude", ".Claude").replace("settings.json", "SETTINGS.json") }, insensitive ? "block" : "allow", "settings: case variant");
check("Write", { file_path: join(fresh, ".claude", "settings.json") }, "allow", "settings: first-time creation (init)", fresh);
check("Edit", { file_path: ".claude/settings.json" }, "block", "settings: relative path resolves against the session cwd");

// ===== Hooks: the RUNNING ones, not anything named aidlc-core =====
check("Edit", { file_path: join(HERE, "guard.mjs") }, "block", "hooks: the running guard");
check("Write", { file_path: join(HERE, "..", "hooks.json") }, "block", "hooks: the running hooks.json");
check("Write", { file_path: join(ws, ".claude", "hooks", "pre.sh") }, "block", "hooks: project .claude/hooks");
check("Edit", { file_path: join(ws, ".claude", "plugins", "cache", "x", "aidlc", "1.0.0", "hooks", "scripts", "guard.mjs") }, "block", "hooks: an installed plugin copy");
check("Edit", { file_path: join(ws, "src", "plugins", "aidlc-core", "hooks", "scripts", "guard.mjs") }, "allow", "hooks: a non-running source copy is editable");
check("Edit", { file_path: join(ws, "src", "hooks", "useAuth.ts") }, "allow", "hooks: a React hooks folder is ordinary code");

// ===== Git internals =====
check("Write", { file_path: join(ws, ".git", "config") }, "block", "git: config");
check("Write", { file_path: join(ws, ".GIT", "hooks", "pre-commit") }, insensitive ? "block" : "allow", "git: case variant");
check("Edit", { file_path: join(ws, ".github", "CODEOWNERS") }, "allow", "git: .github is not .git");

// ===== CI asks =====
check("Write", { file_path: join(ws, ".github", "workflows", "ci.yml") }, "ask", "ci: workflow file");
check("Write", { file_path: join(ws, "azure-pipelines.yml") }, "ask", "ci: azure pipelines");

// ===== The env-file switch is the human's =====
const cfg = join(ws, ".claude", "aidlc.config.json");
check("Edit", { file_path: cfg, old_string: '"envFileAccess": "deny"', new_string: '"envFileAccess": "ask"' }, "ask", "config: edit flips envFileAccess");
check("Write", { file_path: cfg, content: JSON.stringify({ pipeline: { envFileAccess: "ask" } }) }, "ask", "config: write flips envFileAccess");
check("Write", { file_path: cfg, content: JSON.stringify({ pipeline: { envFileAccess: "deny" }, ux: { renderBaseUrl: "http://localhost:3100" } }) }, "allow", "config: unrelated write leaves the switch alone");
check("Edit", { file_path: cfg, old_string: '"renderBaseUrl": "a"', new_string: '"renderBaseUrl": "b"' }, "allow", "config: unrelated edit");

// ===== Ordinary files and failure handling =====
check("Write", { file_path: join(ws, "src", "index.ts") }, "allow", "ordinary file");
check("Write", { file_path: 42 }, "allow", "non-string path is no path (no crash)");
check("Write", "not json", "ask", "unreadable input asks");

rmSync(ws, { recursive: true, force: true });
rmSync(fresh, { recursive: true, force: true });
console.log(`\n${n - fails}/${n} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
