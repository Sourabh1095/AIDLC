// Tests for lib/memory-home.mjs and the SessionStart line that announces a switch.
// Every case runs against a temp workspace and a temp home — never the developer's own ~/.claude.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { check, done } from "./lib/testkit.mjs";
import { ensureWorkspaceMemory, defaultMemoryDir, projectSlug, currentMemoryDir, memoryRoot, sameDir } from "./lib/memory-home.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
delete process.env.CLAUDE_CONFIG_DIR;
delete process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY;

const tmps = [];
const temp = (p) => {
  const d = mkdtempSync(join(tmpdir(), p));
  tmps.push(d);
  return d;
};
const write = (file, content) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content, null, 2) + "\n");
};
const workspace = (cfg = { project: { key: "P" } }) => {
  const ws = temp("mem-ws-");
  write(join(ws, ".claude", "aidlc.config.json"), cfg);
  return ws;
};
const legacyWith = (ws, home, files) => {
  const dir = defaultMemoryDir(ws, home);
  for (const [f, c] of Object.entries(files)) write(join(dir, f), c);
  return dir;
};
const localSettings = (ws) => JSON.parse(readFileSync(join(ws, ".claude", "settings.local.json"), "utf8"));
const mem = (ws) => join(ws, ".aidlc", "memory");
const slash = (p) => p.replace(/\\/g, "/");

check("slug follows Claude Code's folder naming", projectSlug("D:\\RTO Tool").endsWith("D--RTO-Tool"), true);

// --- A fresh workspace with memories in the default place ------------------------------------------
{
  const ws = workspace();
  const home = temp("mem-home-");
  const legacy = legacyWith(ws, home, { "MEMORY.md": "- [a](a.md)\n", "a.md": "fact a\n", "sub/b.md": "fact b\n" });
  const r = ensureWorkspaceMemory({ cwd: ws, cfg: {}, home });
  check("switches", r.state, "switched");
  check("reports where it came from", sameDir(r.from, legacy), true);
  check("counts the copied files", r.copied, 3);
  check("copies the index", readFileSync(join(mem(ws), "MEMORY.md"), "utf8"), "- [a](a.md)\n");
  check("copies nested files", readFileSync(join(mem(ws), "sub", "b.md"), "utf8"), "fact b\n");
  check("leaves the old copy alone", existsSync(join(legacy, "a.md")), true);
  check("pins the setting with forward slashes", localSettings(ws).autoMemoryDirectory, slash(mem(ws)));
  check("the folder ignores itself", readFileSync(join(mem(ws), ".gitignore"), "utf8").trim().endsWith("*"), true);
  check("Claude Code now reads the workspace folder", sameDir(currentMemoryDir(ws, home), mem(ws)), true);

  const before = readFileSync(join(ws, ".claude", "settings.local.json"), "utf8");
  check("second session: nothing to do", ensureWorkspaceMemory({ cwd: ws, cfg: {}, home }).state, "ok");
  check("second session: settings untouched", readFileSync(join(ws, ".claude", "settings.local.json"), "utf8"), before);
}

// --- An existing settings.local.json keeps every byte it had -----------------------------------------
{
  const ws = workspace();
  const home = temp("mem-home-");
  const text = '{\n  "permissions": { "allow": ["Bash(npm test)", "Bash(npm run lint)"] },\n  "env": { "X": "1" }\n}\n';
  write(join(ws, ".claude", "settings.local.json"), text);
  const r = ensureWorkspaceMemory({ cwd: ws, cfg: {}, home });
  const after = readFileSync(join(ws, ".claude", "settings.local.json"), "utf8");
  check("existing file: switches with nothing to copy", [r.state, r.copied], ["switched", 0]);
  check("existing file: one-line array stays on one line", after.includes('"allow": ["Bash(npm test)", "Bash(npm run lint)"]'), true);
  check("existing file: keeps the other keys", [localSettings(ws).env.X, localSettings(ws).autoMemoryDirectory], ["1", slash(mem(ws))]);
}

// --- Left alone ----------------------------------------------------------------------------------
{
  const ws = workspace();
  const home = temp("mem-home-");
  write(join(ws, ".claude", "settings.local.json"), "{ not json");
  check("unparseable settings: reported, not rewritten", ensureWorkspaceMemory({ cwd: ws, cfg: {}, home }).state, "unreadable");
  check("unparseable settings: file untouched", readFileSync(join(ws, ".claude", "settings.local.json"), "utf8"), "{ not json");
}
{
  const ws = workspace();
  const home = temp("mem-home-");
  legacyWith(ws, home, { "MEMORY.md": "x\n" });
  check("opted out: no-op", ensureWorkspaceMemory({ cwd: ws, cfg: { memory: { inWorkspace: false } }, home }), null);
  check("opted out: nothing created", existsSync(mem(ws)) || existsSync(join(ws, ".claude", "settings.local.json")), false);
}
{
  const ws = workspace();
  const home = temp("mem-home-");
  write(join(ws, ".claude", "settings.json"), { autoMemoryEnabled: false });
  check("auto memory off in project settings: no-op", ensureWorkspaceMemory({ cwd: ws, cfg: {}, home }), null);
  process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = "1";
  const ws2 = workspace();
  check("auto memory off by env: no-op", ensureWorkspaceMemory({ cwd: ws2, cfg: {}, home }), null);
  delete process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY;
}

// --- Where the memories come from -------------------------------------------------------------------
{
  const ws = workspace();
  const home = temp("mem-home-");
  write(join(home, ".claude", "settings.json"), { autoMemoryDirectory: "~/notes/memory" });
  write(join(home, "notes", "memory", "MEMORY.md"), "user-level\n");
  const r = ensureWorkspaceMemory({ cwd: ws, cfg: {}, home });
  check("a user-level ~/ setting is where they come from", [sameDir(r.from, join(home, "notes", "memory")), r.copied], [true, 1]);
}
{
  const ws = workspace();
  const home = temp("mem-home-");
  const moved = join(temp("mem-old-"), ".aidlc", "memory");
  write(join(moved, "MEMORY.md"), "from the old checkout\n");
  write(join(ws, ".claude", "settings.local.json"), { autoMemoryDirectory: slash(moved) });
  const r = ensureWorkspaceMemory({ cwd: ws, cfg: {}, home });
  check("folder moved: repinned to the new place", [r.state, localSettings(ws).autoMemoryDirectory], ["switched", slash(mem(ws))]);
  check("folder moved: memories follow", readFileSync(join(mem(ws), "MEMORY.md"), "utf8"), "from the old checkout\n");
}
{
  const ws = workspace();
  const home = temp("mem-home-");
  write(join(mem(ws), "MEMORY.md"), "already here\n");
  legacyWith(ws, home, { "MEMORY.md": "older\n" });
  const r = ensureWorkspaceMemory({ cwd: ws, cfg: {}, home });
  check("never copies over an existing index", [r.copied, readFileSync(join(mem(ws), "MEMORY.md"), "utf8")], [0, "already here\n"]);
}

// --- A linked worktree uses the main checkout's memory -------------------------------------------
{
  const main = workspace();
  const home = temp("mem-home-");
  mkdirSync(join(main, ".git", "worktrees", "wt1"), { recursive: true });
  const wt = workspace();
  write(join(wt, ".git"), `gitdir: ${join(main, ".git", "worktrees", "wt1")}\n`);
  check("worktree: memory root is the main checkout", sameDir(memoryRoot(wt), main), true);
  const r = ensureWorkspaceMemory({ cwd: wt, cfg: {}, home });
  check("worktree: pinned to the main checkout's folder", localSettings(wt).autoMemoryDirectory, slash(mem(main)));
  check("worktree: no memory folder inside the worktree", [r.state, existsSync(mem(wt))], ["switched", false]);
}

// --- The SessionStart hook says it once, on the session that switches -------------------------------
{
  const ws = workspace();
  const cfgDir = join(temp("mem-home-"), ".claude");
  const run = () =>
    execFileSync("node", [join(HERE, "session-context.mjs")], {
      input: JSON.stringify({ cwd: ws, source: "startup" }),
      env: { ...process.env, CLAUDE_CONFIG_DIR: cfgDir },
      encoding: "utf8",
    });
  const first = run();
  check("hook: announces the switch", first.includes(`Project memory now lives in ${mem(ws)}`), true);
  check("hook: writes the setting", localSettings(ws).autoMemoryDirectory, slash(mem(ws)));
  check("hook: silent once it is in place", run().includes("Project memory"), false);
}

for (const t of tmps) rmSync(t, { recursive: true, force: true });
done();
