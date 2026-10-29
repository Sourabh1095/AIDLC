// Tests for session-context.mjs — the lines a session starts with. The brain's own lines are also
// covered in skills/brain/brain.test.mjs; these are the ones a plain workspace with no brain sees.
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { check, done } from "./lib/testkit.mjs";

const HOOK = join(dirname(fileURLToPath(import.meta.url)), "session-context.mjs");
const tmps = [];
const workspace = (files) => {
  const root = mkdtempSync(join(tmpdir(), "session-"));
  tmps.push(root);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), typeof content === "string" ? content : JSON.stringify(content));
  }
  return root;
};
const hook = (cwd) => {
  const home = mkdtempSync(join(tmpdir(), "session-home-"));
  tmps.push(home);
  return execFileSync("node", [HOOK], {
    input: JSON.stringify({ cwd, source: "startup" }),
    env: { ...process.env, CLAUDE_CONFIG_DIR: join(home, ".claude") },
    encoding: "utf8",
  });
};
const CFG = { project: { key: "P" } };

{
  const out = hook(workspace({ ".claude/aidlc.config.json": CFG }));
  check("no brain yet: one line says how it starts", /Project brain: not started\..*\/aidlc:learn --map/.test(out), true);
}
{
  const out = hook(workspace({ ".claude/aidlc.config.json": { ...CFG, brain: { enabled: false } } }));
  check("…and nothing when the brain is switched off", out.includes("Project brain"), false);
}
{
  const out = hook(workspace({ ".claude/aidlc.config.json": CFG, ".aidlc/runs/local-fix-enum.md": "---\nphase: implement\n---\n" }));
  check("a run file with no item: is named by its file, never `undefined`", [out.includes("- local-fix-enum [implement]"), out.includes("undefined")], [true, false]);
}
{
  const PR = "https://github.com/o/r/pull/9";
  const out = hook(
    workspace({
      ".claude/aidlc.config.json": CFG,
      ".aidlc/runs/P-9.md": `---\nitem: P-9\nphase: review-pending\npr: ${PR}\n---\n`,
      ".aidlc/logs/pr-state.json": { [PR]: { state: "closed", item: "P-9" } },
    }),
  );
  check("a run whose PR closed says so, and how to clear it", /- P-9 \[review-pending\].*PR closed, \/aidlc:status cleans it up/.test(out), true);
}

for (const t of tmps) rmSync(t, { recursive: true, force: true });
done();
