#!/usr/bin/env node
// Allocate the next markdown-backlog id, safely.
//
//   node next-id.mjs <workspace-root> <PROJECT_KEY>    → prints e.g. PROJ-42
//
// `create` used to be prose: read backlog/.sequence, write n+1. Two things went wrong with that,
// both silently:
//   - Under /aidlc:sprint (mono) every item runs in its own git WORKTREE, and each worktree has its
//     own copy of backlog/.sequence. Two runs that split a story both read 41 and both wrote PROJ-41.
//   - Even in one checkout, two concurrent headless runs could interleave the read and the write.
// So: always allocate in the MAIN worktree (the one the control plane lives in), under an exclusive
// lock file, and never hand out an id at or below one that already exists as a file — a .sequence
// that fell behind (a merge, a hand edit) must not reissue an id.
import { readFileSync, writeFileSync, existsSync, openSync, closeSync, unlinkSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isMain as isEntry } from "../../hooks/scripts/lib/cli.mjs";
import { samePath } from "../../hooks/scripts/lib/paths.mjs";

// The main worktree of the repo at `dir`, or `dir` itself when it is not a linked worktree.
export function mainWorktree(dir) {
  try {
    const out = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: dir, stdio: ["ignore", "pipe", "ignore"] }).toString();
    const first = out.split(/\r?\n/).find((l) => l.startsWith("worktree "));
    return first ? resolve(first.slice(9).trim()) : resolve(dir);
  } catch {
    return resolve(dir);
  }
}

// Highest numeric id among backlog/items/*.md and backlog/epics/*.md files named `<KEY>-<n>…`.
export function highestExisting(root, key) {
  let max = 0;
  const re = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)\\b`, "i");
  for (const sub of ["items", "epics"]) {
    const d = join(root, "backlog", sub);
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d)) {
      const m = f.match(re);
      if (m) max = Math.max(max, Number(m[1]));
    }
  }
  return max;
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export function allocate(workspace, key, { timeoutMs = 10000 } = {}) {
  const root = mainWorktree(workspace);
  const seqPath = join(root, "backlog", ".sequence");
  const lock = seqPath + ".lock";
  const start = Date.now();
  let fd;
  for (;;) {
    try {
      fd = openSync(lock, "wx");
      break;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      // A lock older than the timeout belongs to a run that died holding it.
      try {
        if (Date.now() - statSync(lock).mtimeMs > timeoutMs) unlinkSync(lock);
      } catch {
        /* gone already */
      }
      if (Date.now() - start > timeoutMs) throw new Error(`could not lock ${lock} within ${timeoutMs}ms`);
      sleep(50);
    }
  }
  try {
    let seq = 1;
    try {
      seq = Number(readFileSync(seqPath, "utf8").trim()) || 1;
    } catch {
      /* no sequence yet */
    }
    const n = Math.max(seq, highestExisting(root, key) + 1);
    writeFileSync(seqPath, `${n + 1}\n`);
    return { id: `${key}-${n}`, root };
  } finally {
    closeSync(fd);
    try {
      unlinkSync(lock);
    } catch {
      /* already gone */
    }
  }
}

if (isEntry(import.meta.url)) {
  const [ws, key] = process.argv.slice(2);
  if (!ws || !key) {
    console.error("usage: node next-id.mjs <workspace-root> <PROJECT_KEY>");
    process.exit(2);
  }
  try {
    const { id, root } = allocate(resolve(ws), key);
    console.log(id);
    // git names the main worktree by its real path; `ws` may be a symlinked or short-name spelling.
    if (!samePath(root, ws)) console.error(`(allocated in the main worktree: ${root} — create the item file there)`);
  } catch (e) {
    console.error(`next-id: ${e.message}`);
    process.exit(1);
  }
}
