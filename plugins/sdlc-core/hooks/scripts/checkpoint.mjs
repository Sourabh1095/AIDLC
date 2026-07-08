#!/usr/bin/env node
// PreCompact / Stop — run-state safety net.
// precompact: remind the model to flush in-flight run state into the run file
//             BEFORE context is compacted (the run file must outlive the context).
// stop:       if a run is mid-flight, surface a one-line status so the user
//             sees where the pipeline stands.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const mode = process.argv[2] || "stop";

let data = {};
try {
  data = JSON.parse(readFileSync(0, "utf8"));
} catch {
  /* empty */
}
const cwd = data.cwd || process.cwd();

let runsDir;
try {
  runsDir = join(cwd, ".sdlc", "runs");
  if (!existsSync(runsDir)) process.exit(0);
} catch {
  process.exit(0);
}

function frontmatter(file) {
  try {
    const m = readFileSync(file, "utf8").match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!m) return null;
    const fm = {};
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
      if (kv) fm[kv[1]] = kv[2].trim();
    }
    return fm;
  } catch {
    return null;
  }
}

let inflight = [];
try {
  inflight = readdirSync(runsDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => frontmatter(join(runsDir, f)))
    .filter(Boolean)
    .filter((r) => r.phase && !["done", "blocked"].includes(r.phase));
} catch {
  process.exit(0);
}

if (!inflight.length) process.exit(0);

const summary = inflight.map((r) => `${r.item}@${r.phase}`).join(", ");

if (mode === "precompact") {
  // stdout becomes context: instruct the model to checkpoint before compaction eats details.
  process.stdout.write(
    `SDLC checkpoint: runs in flight (${summary}). Before continuing, flush any un-persisted ` +
      `phase state, plan progress, findings and log lines into the corresponding .sdlc/runs/<ID>.md ` +
      `file(s) — the run file must survive compaction as the single source of truth.`
  );
} else {
  process.stdout.write(`SDLC: run(s) in flight — ${summary}. Resume with /sdlc:run <ID>; board: /sdlc:status.`);
}
process.exit(0);
