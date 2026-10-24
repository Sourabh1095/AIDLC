// The env-file access switch, shared by the two hooks that enforce it:
//   env-guard.mjs — the Read/Edit/Write/Grep/NotebookEdit TOOL path (the governed path)
//   guard.mjs     — the shell path (the backstop: a shell command bypasses the tools)
//
// Two hooks are needed because they sit on different tool events; ONE resolver is
// needed because a switch that means different things on the two paths is not a
// switch. They previously held copy-pasted resolvers.
//
// Why a hook at all, rather than a static settings `deny`: a static deny ALWAYS wins
// and can never be relaxed at runtime, so a user-flippable switch has to live where
// its value can be read. Fails CLOSED — no config found, unreadable, or any value
// other than the exact string "ask" is "deny".
import { dirname, resolve } from "node:path";
import { findConfig } from "./config.mjs";

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

// Resolve the switch by walking UP from `startDir` to the nearest
// .claude/aidlc.config.json. The FIRST config found governs, opted-in or not.
//
// The walk is anchored on the env file's own directory rather than on cwd, which is
// what lets a poly product-repo env file find the control-plane opt-in no matter
// where the session cwd sits. A cwd-anchored read missed exactly this: a tool call
// whose cwd was a product subrepo found no config there and fell back to deny,
// hard-blocking env writes in a workspace that HAD opted in (F50).
export function envFileAccess(startDir) {
  const { cfg } = findConfig(startDir);
  return cfg && cfg.pipeline && cfg.pipeline.envFileAccess === "ask" ? "ask" : "deny";
}

// Access for a specific env path, resolved from that path's OWN directory (relative
// paths resolved against cwd). This is the form both hooks want.
export const envAccessFor = (envPath, cwd) => envFileAccess(dirname(resolve(cwd, envPath)));
