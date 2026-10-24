// The assertion harness the plugin's *.test.mjs suites share.
//
// Twelve suites carried a byte-identical copy of these lines — the duplication `dup-check.mjs` flags,
// in the repo whose job is to stop it. Dependency-free on purpose, like everything that ships in a
// plugin: `scripts/run-tests.mjs` runs each suite as a plain `node` process and reads its exit code.
//
//   import { check, done } from "<…>/hooks/scripts/lib/testkit.mjs";
//   check("label", actual, expected);   // deep equality via JSON
//   done();                             // prints "n/m passed, f failed" and exits 1 on any failure
//   hookOutcome(script, payload)        // "block" | "ask" | "allow" | "exitN" for a PreToolUse hook

import { execFileSync } from "node:child_process";

let n = 0;
let fails = 0;

export function check(label, actual, expected) {
  n++;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`ok    ${label}`);
    return true;
  }
  fails++;
  console.log(`FAIL  ${label}\n      expected ${e}\n      actual   ${a}`);
  return false;
}

export function done() {
  console.log(`\n${n - fails}/${n} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
}

// What a PreToolUse hook decided for one payload: "block" (exit 2), "ask" (a permissionDecision "ask"),
// "allow" (exit 0, no decision) or "exitN" for anything else — a crash shows up as exit1, which Claude
// Code would let through. `payload` is the hook's stdin: an object, or a raw string to test bad input.
export function hookOutcome(scriptPath, payload) {
  let code = 0;
  let out = "";
  try {
    out = execFileSync("node", [scriptPath], {
      input: typeof payload === "string" ? payload : JSON.stringify(payload),
      stdio: ["pipe", "pipe", "pipe"],
    }).toString();
  } catch (e) {
    code = typeof e.status === "number" ? e.status : -1;
    out = (e.stdout || "").toString();
  }
  if (code === 2) return "block";
  if (code !== 0) return `exit${code}`;
  try {
    if (JSON.parse(out)?.hookSpecificOutput?.permissionDecision === "ask") return "ask";
  } catch {
    /* no JSON → no decision */
  }
  return "allow";
}
