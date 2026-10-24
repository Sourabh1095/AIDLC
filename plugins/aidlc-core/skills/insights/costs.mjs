#!/usr/bin/env node
// What each work item cost, from the ledger the aidlc-cockpit mod keeps.
//
//   node costs.mjs <workspace-root> [--json]
//
// The figure is Claude Code's own session cost (`/cost`): an API-equivalent estimate at list prices,
// or your organization's contracted rates where it sets them. On a Claude plan it is not a bill, but it
// is the best measure of how much of the plan an item used. Subagents are included.
//
// The cockpit writes one file per item per session, so parallel sprint runs never write the same file:
//
//   <main checkout>/.aidlc/logs/costs/<ITEM>--<session>.json
//   { "item": "PROJ-1", "session": "1a2b3c4d", "started": ISO, "updated": ISO,
//     "phases": { "implement": 1.234, "verify": 0.5 } }
//
// `.aidlc/logs/` is git-ignored by the project template: this is one machine's spend, not project
// history. The main checkout is used even from a sprint worktree, so a ledger outlives its worktree.
// Without the cockpit there are no files, and every reader treats that as "not measured", never as 0.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { isMain } from "../../hooks/scripts/lib/cli.mjs";

export const COST_DIR = [".aidlc", "logs", "costs"];

const num = (x) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : 0);

// One ledger file's JSON → { item, session, started, updated, phases } with the numbers checked, or null.
export function parseLedger(json) {
  if (!json || typeof json !== "object" || typeof json.item !== "string" || !json.item) return null;
  const phases = {};
  for (const [p, v] of Object.entries(json.phases && typeof json.phases === "object" ? json.phases : {})) if (num(v)) phases[p] = num(v);
  return { item: json.item, session: String(json.session ?? ""), started: json.started ?? null, updated: json.updated ?? null, phases };
}

// Every ledger under <root>/.aidlc/logs/costs, summed per item.
//   → { measured: boolean, totalUsd, byItem: { ID: { usd, phases: {p: usd}, sessions, started } } }
export function readCosts(root) {
  const dir = join(resolve(root), ...COST_DIR);
  const byItem = {};
  if (!existsSync(dir)) return { measured: false, totalUsd: 0, byItem };
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    let ledger = null;
    try {
      ledger = parseLedger(JSON.parse(readFileSync(join(dir, f), "utf8")));
    } catch {
      continue; // a half-written file is skipped, not fatal: the next write fixes it
    }
    if (!ledger) continue;
    const it = (byItem[ledger.item] ??= { usd: 0, phases: {}, sessions: 0, started: null });
    it.sessions++;
    for (const [p, v] of Object.entries(ledger.phases)) {
      it.phases[p] = (it.phases[p] ?? 0) + v;
      it.usd += v;
    }
    if (ledger.started && (!it.started || ledger.started < it.started)) it.started = ledger.started;
  }
  const totalUsd = Object.values(byItem).reduce((n, it) => n + it.usd, 0);
  return { measured: Object.keys(byItem).length > 0, totalUsd, byItem };
}

// A sub-cent amount is not $0.00: it was measured, and it was not free.
export const usd = (x) => (x == null ? "?" : x >= 10 ? `$${x.toFixed(0)}` : x > 0 && x < 0.01 ? "<$0.01" : `$${x.toFixed(2)}`);

if (isMain(import.meta.url)) {
  const argv = process.argv.slice(2);
  const root = argv.find((a) => !a.startsWith("--")) ?? process.cwd();
  const c = readCosts(root);
  if (argv.includes("--json")) console.log(JSON.stringify(c));
  else if (!c.measured) console.log("No cost ledger here — install aidlc-cockpit to measure what each item costs.");
  else {
    console.log(`Cost by item (API-equivalent, ${usd(c.totalUsd)} in all):`);
    for (const [id, it] of Object.entries(c.byItem).sort((a, b) => b[1].usd - a[1].usd))
      console.log(`  ${id.padEnd(12)} ${usd(it.usd).padStart(7)}  ${Object.entries(it.phases).map(([p, v]) => `${p} ${usd(v)}`).join(" · ")}`);
  }
}
