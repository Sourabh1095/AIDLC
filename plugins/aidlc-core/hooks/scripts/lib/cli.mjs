// Command-line plumbing shared by every AIDLC script that can be run directly.
//
// Each script had its own copy of three things, and the copies disagreed:
//   - "am I the script node was started with?" was answered four different ways. Two compared
//     `fileURLToPath(import.meta.url) === process.argv[1]` exactly, so a drive letter in a different
//     case (`d:\` vs `D:\`) or a launch through a symlink or junction made the script do NOTHING and
//     exit 0 — a resolver that silently prints no schedule. Two matched on the file name alone.
//   - a `--flag value` parser, byte-identical in doctor and upgrade;
//   - "read this JSON file or exit 2 with a message", in five resolvers.
//
// It lives in hooks/scripts/lib on purpose: that folder is guard-protected (lib/protected-paths.mjs),
// and the hooks import from it, so shared code there cannot be rewritten by the pipeline it guards.
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CASE_INSENSITIVE_FS } from "./paths.mjs";

const canonical = (p) => {
  let s = resolve(p);
  try {
    s = realpathSync(s);
  } catch {
    /* a path that does not exist compares lexically */
  }
  return CASE_INSENSITIVE_FS ? s.toLowerCase() : s;
};

// True when the module whose `import.meta.url` is passed is the script node was started with.
export function isMain(metaUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return canonical(fileURLToPath(metaUrl)) === canonical(entry);
  } catch {
    return false;
  }
}

// `--flag value` / `--flag` / positionals. `valueFlags` names the flags that take a value.
// Returns { flags: { "--name": value | true }, positional: [...] }.
export function parseArgs(argv, valueFlags = []) {
  const takes = new Set(valueFlags);
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (takes.has(a)) flags[a] = argv[++i];
    else if (a.startsWith("--") && a.includes("=")) flags[a.slice(0, a.indexOf("="))] = a.slice(a.indexOf("=") + 1);
    else if (a.startsWith("--")) flags[a] = true;
    else positional.push(a);
  }
  return { flags, positional };
}

// Parsed JSON from `path`, or null when it is missing or unreadable.
export function tryJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

// Parsed JSON from `path`, or exit 2 (bad input) naming the file and the reason.
export function readJsonOrExit(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    console.error(`cannot read ${path}: ${e.message}`);
    process.exit(2);
  }
}
