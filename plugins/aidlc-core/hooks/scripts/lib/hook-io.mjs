// Hook input and output, shared by every AIDLC hook script.
//
// Each hook used to carry its own stdin reader and its own copy of the permission-decision
// JSON, with different failure behaviour in each: an unreadable tool call exited 0 in one
// hook and was "fail CLOSED" by comment only in another, and an uncaught exception exited
// 1 — which Claude Code treats as a non-blocking error, so the tool call simply ran. For a
// guard, "I crashed" silently meant "allowed".
//
// The rule this module encodes: a SECURITY hook that cannot decide does not allow. It
// asks. Not deny — a bug in a guard must not brick every Bash call in the session — but
// never a silent pass either. `runGuard` is the wrapper that makes that true for any
// failure, including ones nobody anticipated.
import { readFileSync } from "node:fs";

// The parsed hook payload, or null when stdin is not a JSON object.
export function readInput() {
  try {
    const data = JSON.parse(readFileSync(0, "utf8"));
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  }
}

// A string field, or "" — tool_input values are untrusted shapes, and a non-string where a
// path was expected used to throw a TypeError out of the hook (exit 1 → allowed).
export const str = (v) => (typeof v === "string" ? v : "");

// The session cwd from the payload, falling back to the process cwd.
export const cwdOf = (data) => str(data && data.cwd) || process.cwd();

// Emit a PreToolUse "ask": the call proceeds only if the user approves it.
export function ask(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: reason,
      },
    }),
  );
}

// Refuse the call. Exit 2 blocks it and shows stderr to the model.
export function block(prefix, reason) {
  process.stderr.write(`${prefix}: ${reason}`);
  process.exit(2);
}

// Run a security hook's body so that no failure can turn into an allow. Unreadable input
// and any thrown error both become an "ask" naming the hook, so the user sees that the
// check did not run rather than assuming it passed.
export function runGuard(name, main) {
  const data = readInput();
  if (!data) {
    ask(`AIDLC ${name}: could not read this tool call, so it was not checked. Approve only if you know it is safe.`);
    process.exit(0);
  }
  try {
    main(data);
  } catch (e) {
    ask(
      `AIDLC ${name} failed internally (${(e && e.message) || e}) and could not check this call. ` +
        `Approve only if you know it is safe, and report it with /aidlc:dogfood.`,
    );
    process.exit(0);
  }
}
