#!/usr/bin/env node
// PreCompact / Stop — run-state safety net.
// precompact: remind the model to flush in-flight run state into the run file
//             BEFORE context is compacted (the run file must outlive the context).
// stop:       if a run is mid-flight, surface a one-line status so the user
//             sees where the pipeline stands.
// Poly-aware: scans the control-plane run dir plus each declared repo's .aidlc/runs.
import { readFileSync } from "node:fs";
import { readRuns } from "./lib/run-files.mjs";

const mode = process.argv[2] || "stop";

let data = {};
try {
  data = JSON.parse(readFileSync(0, "utf8"));
} catch {
  /* empty */
}
const cwd = data.cwd || process.cwd();

// A blocked run is deliberately NOT in flight here: it is waiting on a human, so
// nagging about it at every Stop/PreCompact is noise. (session-context does surface
// blocked runs — a session opening on one is exactly when you want to see it.)
const inflight = readRuns(cwd, (r) => r.phase && !["done", "blocked"].includes(r.phase));
if (!inflight.length) process.exit(0);

const summary = inflight.map((r) => `${r.item}@${r.phase}`).join(", ");

if (mode === "precompact") {
  // stdout becomes context: instruct the model to checkpoint before compaction eats details.
  process.stdout.write(
    `AIDLC checkpoint: runs in flight (${summary}). Before continuing, flush any un-persisted ` +
      `phase state, plan progress, findings and log lines into the corresponding .aidlc/runs/<ID>.md ` +
      `file(s) — the run file must survive compaction as the single source of truth.`
  );
} else {
  process.stdout.write(`AIDLC: run(s) in flight — ${summary}. Resume with /aidlc:run <ID>; board: /aidlc:status.`);
}
process.exit(0);
