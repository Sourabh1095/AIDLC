// Tests for lib/cli.mjs. Run: `node cli.test.mjs`.
//
// The entry-point check is what decides whether a resolver prints its schedule at all. Exact path
// comparison made scripts do nothing — exit 0, no output — when launched through a directory junction
// or symlink, or with a drive letter in a different case. These rows launch real scripts those ways.
import { execFileSync } from "node:child_process";
import { mkdtempSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./lib/cli.mjs";
import { check, done } from "./lib/testkit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILLS = resolve(HERE, "..", "..", "skills");


// A resolver run with no arguments prints its usage line on stderr and exits 2 — IF it recognised
// itself as the entry point. A script that did not would exit 0 and print nothing.
function usageFrom(scriptPath) {
  try {
    execFileSync("node", [scriptPath], { stdio: ["ignore", "pipe", "pipe"] });
    return "exit 0 (nothing ran)";
  } catch (e) {
    return /usage:/.test(String(e.stderr)) ? "usage" : `exit ${e.status}`;
  }
}

const gate = join(SKILLS, "run", "resolve-gate.mjs");
check("direct launch runs the CLI", usageFrom(gate), "usage");

if (process.platform === "win32") {
  const swapped = gate[0] === gate[0].toUpperCase() ? gate[0].toLowerCase() + gate.slice(1) : gate[0].toUpperCase() + gate.slice(1);
  check("a drive letter in the other case still runs it", usageFrom(swapped), "usage");
}

const tmp = mkdtempSync(join(tmpdir(), "cli-"));
let linked = false;
try {
  symlinkSync(join(SKILLS, "run"), join(tmp, "run-link"), process.platform === "win32" ? "junction" : "dir");
  linked = true;
} catch {
  console.log("skip  symlink/junction rows (cannot create one here)");
}
if (linked) check("a launch through a junction/symlink still runs it", usageFrom(join(tmp, "run-link", "resolve-gate.mjs")), "usage");
rmSync(tmp, { recursive: true, force: true });

const p = parseArgs(["root", "--json", "--plugin-root", "/x", "--since=2026-01-01", "extra"], ["--plugin-root"]);
check("parseArgs: value flags, bare flags, = form, positionals", p, {
  flags: { "--json": true, "--plugin-root": "/x", "--since": "2026-01-01" },
  positional: ["root", "extra"],
});

done();
