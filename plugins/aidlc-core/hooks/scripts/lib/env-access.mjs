// The env-file access switch, shared by the two hooks that enforce it:
//   env-guard.mjs — the Read|Edit|Write TOOL path (the governed path)
//   guard.mjs     — the Bash path (the backstop: a shell command bypasses the tools)
//
// Two hooks are needed because they sit on different tool events; ONE resolver is
// needed because a switch that means different things on the two paths is not a
// switch. They previously held copy-pasted resolvers.
//
// Why a hook at all, rather than a static settings `deny`: a static deny ALWAYS wins
// and can never be relaxed at runtime, so a user-flippable switch has to live where
// its value can be read. Fails CLOSED — no config found, unreadable, or any value
// other than the exact string "ask" is "deny".
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

// The env-file family, by BASENAME, anywhere in the tree (mono root, poly product
// subfolders, monorepo apps/*). Matches `.env`, `.env.example`, `.env.local`,
// `.env.production.local`, … but NOT `.envrc` (direnv) or `.env-sample`.
//
// Matched case-INSENSITIVELY, because the filesystems this runs on are. Windows (NTFS)
// and macOS (APFS, by default) both open `.ENV` and `.Env.local` as the very same file
// as `.env` — so a case-sensitive test here meant the switch simply did not see them:
// no prompt, no block, the file read or written as if it were an ordinary source file.
// The gate is meant to be the one thing every env-file path goes through, and a gate
// with a spelling that walks around it is not one. Linux is the only place where `.ENV`
// is genuinely a different file, and treating it as an env file there is correct anyway.
export function isEnvFile(pathOrToken) {
  const base = String(pathOrToken)
    .replace(/^['"]|['"]$/g, "")
    .replace(/\\/g, "/")
    .split("/")
    .pop();
  return /^\.env(\.|$)/i.test(base);
}

const _cache = new Map();

// Resolve the switch by walking UP from `startDir` to the nearest
// .claude/aidlc.config.json. The FIRST config found governs, opted-in or not.
//
// The walk is anchored on the env file's own directory rather than on cwd, which is
// what lets a poly product-repo env file find the control-plane opt-in no matter
// where the session cwd sits. A cwd-anchored read missed exactly this: a tool call
// whose cwd was a product subrepo found no config there and fell back to deny,
// hard-blocking env writes in a workspace that HAD opted in (F50).
export function envFileAccess(startDir) {
  if (_cache.has(startDir)) return _cache.get(startDir);
  let access = "deny";
  let dir = startDir;
  for (;;) {
    const cfgPath = join(dir, ".claude", "aidlc.config.json");
    if (existsSync(cfgPath)) {
      try {
        const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
        if (cfg && cfg.pipeline && cfg.pipeline.envFileAccess === "ask") access = "ask";
      } catch {
        /* present but unreadable/malformed → keep deny */
      }
      break; // nearest config governs
    }
    const parent = dirname(dir);
    if (parent === dir) break; // filesystem root, no config found
    dir = parent;
  }
  _cache.set(startDir, access);
  return access;
}

// Access for a specific env path, resolved from that path's OWN directory (relative
// paths resolved against cwd). This is the form both hooks want.
export const envAccessFor = (envPath, cwd) => envFileAccess(dirname(resolve(cwd, envPath)));
