// Keep Claude Code's auto memory for an AIDLC workspace inside the workspace.
//
// Auto memory is what Claude Code carries between sessions on its own: what it learned about the
// project, the user's corrections, decisions it was asked to remember. By default it lives in
// ~/.claude/projects/<slug>/memory/ — outside the workspace, on one machine, invisible to anyone
// looking at the project. The setting that moves it, `autoMemoryDirectory`, takes only an absolute
// path, so it cannot go in the committed .claude/settings.json; it goes in .claude/settings.local.json,
// which is per machine and gitignored. The SessionStart hook calls ensureWorkspaceMemory() on every
// session, which also repairs the path after the folder is moved or cloned somewhere else.
//
// Measured, not assumed: Claude Code reads settings before SessionStart hooks run, so a switch takes
// effect from the NEXT session. The session that makes it is told, through the hook's context, to use
// the new folder itself — otherwise its memories land in the old place after the copy was taken.
//
// The folder carries its own `.gitignore` (`*`): auto memory holds one developer's notes and
// corrections, and a MEMORY.md index every teammate rewrites would conflict on every merge. What the
// team shares already has committed homes — decisions in docs/adr/, operational truths in
// .aidlc/facts.md, history in .aidlc/journal.md. Deleting that one file shares the folder instead.
import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { normPath } from "./paths.mjs";
import { patchJsonText } from "../../../skills/upgrade/json-edit.mjs";

const GITIGNORE =
  "# Claude Code's auto memory for this workspace: one developer's notes, kept out of git.\n" +
  "# Team decisions belong in docs/adr/ and .aidlc/facts.md. Delete this file to commit the folder anyway.\n" +
  "*\n";

// Where Claude Code keeps its own state: CLAUDE_CONFIG_DIR when set, else ~/.claude.
export const claudeDir = (home = homedir()) => process.env.CLAUDE_CONFIG_DIR || join(home, ".claude");

// Claude Code names a project's folder after its path with every non-alphanumeric character turned
// into "-": D:\RTO Tool → D--RTO-Tool.
export const projectSlug = (dir) => resolve(dir).replace(/[^A-Za-z0-9]/g, "-");

// The folder Claude Code uses when nothing sets autoMemoryDirectory.
export const defaultMemoryDir = (root, home) => join(claudeDir(home), "projects", projectSlug(root), "memory");

export const sameDir = (a, b) => normPath(resolve(a)) === normPath(resolve(b));

export const countFiles = (dir) =>
  readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).length;

// The workspace whose memory this is. A linked git worktree's `.git` is a file,
// `gitdir: <main>/.git/worktrees/<name>`, and its memory belongs to the main checkout — Claude Code
// shares auto memory across a repo's worktrees too, and a worktree is deleted when its PR merges.
export function memoryRoot(cwd) {
  try {
    if (!statSync(join(cwd, ".git")).isFile()) return cwd;
    const gitdir = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(join(cwd, ".git"), "utf8"))?.[1];
    const main = gitdir && /^(.*)[\\/]\.git[\\/]worktrees[\\/][^\\/]+$/.exec(resolve(cwd, gitdir))?.[1];
    return main && existsSync(join(main, ".claude", "aidlc.config.json")) ? main : cwd;
  } catch {
    return cwd;
  }
}

export const workspaceMemoryDir = (cwd) => join(memoryRoot(cwd), ".aidlc", "memory");

// { text, value } for a settings file; null when absent; undefined when it does not parse.
function readSettings(file) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  try {
    return { text, value: JSON.parse(text) };
  } catch {
    return undefined;
  }
}

// The settings files that can carry the memory keys, highest precedence first. Managed policy can
// too, and wins over all of them; a workspace cannot change that.
function firstSetting(cwd, home, key, type) {
  for (const f of [
    join(cwd, ".claude", "settings.local.json"),
    join(cwd, ".claude", "settings.json"),
    join(claudeDir(home), "settings.json"),
  ]) {
    const v = readSettings(f)?.value?.[key];
    if (typeof v === type) return v;
  }
  return undefined;
}

// Auto memory switched off stores nothing anywhere, so there is nothing to move.
export function autoMemoryOff(cwd, home = homedir()) {
  const env = process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY;
  if (env === "1") return true;
  if (env === "0") return false;
  return firstSetting(cwd, home, "autoMemoryEnabled", "boolean") === false;
}

const expandHome = (p, home) => (/^~[\\/]/.test(p) ? join(home, p.slice(2)) : p);

// The folder Claude Code reads this workspace's auto memory from right now.
export function currentMemoryDir(cwd, home = homedir()) {
  const set = firstSetting(cwd, home, "autoMemoryDirectory", "string");
  return set ? resolve(expandHome(set, home)) : defaultMemoryDir(memoryRoot(cwd), home);
}

// Point this workspace's auto memory at <memory root>/.aidlc/memory and keep it there. Returns null
// when there is nothing to do (opted out, or auto memory is off), else { state, target, … }:
//   ok         — already in the workspace
//   switched   — written now ({ from, copied }); Claude Code follows it from the next session
//   unreadable — .claude/settings.local.json does not parse, so it was left untouched
export function ensureWorkspaceMemory({ cwd, cfg, home = homedir() }) {
  if (cfg?.memory?.inWorkspace === false || autoMemoryOff(cwd, home)) return null;
  const target = workspaceMemoryDir(cwd);
  const localFile = join(cwd, ".claude", "settings.local.json");
  const local = readSettings(localFile);
  if (local === undefined) return { state: "unreadable", target };

  mkdirSync(target, { recursive: true });
  if (!existsSync(join(target, ".gitignore"))) writeFileSync(join(target, ".gitignore"), GITIGNORE);
  const pinned = local?.value?.autoMemoryDirectory;
  if (typeof pinned === "string" && sameDir(expandHome(pinned, home), target)) return { state: "ok", target };

  // Bring what Claude Code already knows along — but never into a folder with its own index: that
  // workspace's memory moved before, and merging two MEMORY.md files is a judgment call, not a copy.
  const from = currentMemoryDir(cwd, home);
  let copied = 0;
  if (!sameDir(from, target) && existsSync(from) && !existsSync(join(target, "MEMORY.md"))) {
    copied = countFiles(from);
    cpSync(from, target, { recursive: true, force: false, errorOnExist: false });
  }
  const next = { ...(local?.value ?? {}), autoMemoryDirectory: target.replace(/\\/g, "/") };
  writeFileSync(localFile, local ? patchJsonText(local.text, next) : JSON.stringify(next, null, 2) + "\n");
  return { state: "switched", target, from, copied };
}
