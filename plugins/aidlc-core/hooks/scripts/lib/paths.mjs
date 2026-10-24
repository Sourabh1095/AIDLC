// Path handling shared by the hooks.
//
// Two facts every path check here has to respect, and that were each re-derived (and
// sometimes missed) per script:
//   1. Windows and macOS filesystems are case-insensitive by default, so `.Claude\settings.json`
//      IS `.claude/settings.json` there. A case-sensitive check is a spelling that walks around it.
//   2. On Windows the Bash tool is Git Bash, where `/d/work/app` means `D:\work\app`. Node's
//      `resolve` reads it as `<current drive>:\d\work\app`, so an in-project delete written in
//      the Git Bash form was judged "outside" and blocked.
import { resolve } from "node:path";

export const CASE_INSENSITIVE_FS = process.platform === "win32" || process.platform === "darwin";

// Forward slashes, no trailing slash, lower-cased where the filesystem ignores case.
// For COMPARISON only — never hand the result to a command.
export function normPath(p) {
  const s = String(p).replace(/\\/g, "/").replace(/\/+$/, "");
  return CASE_INSENSITIVE_FS ? s.toLowerCase() : s;
}

// Is `child` the same as, or inside, `parent`? Both are resolved paths.
export function isWithin(child, parent) {
  const c = normPath(child);
  const p = normPath(parent);
  return c === p || c.startsWith(p + "/");
}

// A shell path as the OS will see it. On Windows, the Git Bash spellings `/c/x` and
// `/cygdrive/c/x` become `C:/x`; everywhere else the path is returned unchanged. Only
// meaningful for paths that came through the Bash tool — PowerShell reads `/c/x` as a
// path on the current drive, exactly like Node does.
export function fromShellPath(p, toolName = "Bash") {
  if (process.platform !== "win32" || toolName !== "Bash") return String(p);
  return String(p)
    .replace(/^\/cygdrive\/([a-zA-Z])(?=\/|$)/, (_, d) => `${d.toUpperCase()}:`)
    .replace(/^\/([a-zA-Z])(?=\/|$)/, (_, d) => `${d.toUpperCase()}:`);
}

// Resolve a shell path against cwd, honouring the Git Bash drive form.
export const resolveShellPath = (cwd, p, toolName) => resolve(cwd, fromShellPath(unquote(p), toolName));

// Strip one layer of surrounding quotes from a token.
export const unquote = (t) => String(t).replace(/^['"]|['"]$/g, "");
