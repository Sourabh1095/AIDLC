// Tests for costs.mjs. Run: `node costs.test.mjs`.
//
// The ledger files are written by the aidlc-cockpit mod; the fixture below is that format, so a change
// on either side that breaks the other fails here.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { parseLedger, readCosts, usd } from "./costs.mjs";
import { check, done } from "../../hooks/scripts/lib/testkit.mjs";

check("a ledger parses", parseLedger({ item: "P-1", session: "abcd1234", started: "2026-10-25T10:00:00Z", phases: { implement: 1.5, verify: 0.25 } }).phases, { implement: 1.5, verify: 0.25 });
check("negative or non-numeric amounts are dropped", parseLedger({ item: "P-1", phases: { a: -1, b: "x", c: 2 } }).phases, { c: 2 });
check("no item → not a ledger", parseLedger({ phases: { a: 1 } }), null);
check("money reads like money", [usd(0.5), usd(12.4), usd(null), usd(0.0015), usd(0)], ["$0.50", "$12", "?", "<$0.01", "$0.00"]);

const ws = mkdtempSync(join(tmpdir(), "costs-"));
try {
  check("no ledger folder → not measured (never $0)", readCosts(ws), { measured: false, totalUsd: 0, byItem: {} });
  const dir = join(ws, ".aidlc", "logs", "costs");
  mkdirSync(dir, { recursive: true });
  // Two sessions worked P-1 (a sprint run, then a resume); one worked P-2.
  writeFileSync(join(dir, "P-1--aaaa1111.json"), JSON.stringify({ item: "P-1", session: "aaaa1111", started: "2026-10-25T10:00:00Z", phases: { implement: 1, verify: 0.5 } }));
  writeFileSync(join(dir, "P-1--bbbb2222.json"), JSON.stringify({ item: "P-1", session: "bbbb2222", started: "2026-10-26T09:00:00Z", phases: { verify: 0.25, pr: 0.25 } }));
  writeFileSync(join(dir, "P-2--cccc3333.json"), JSON.stringify({ item: "P-2", session: "cccc3333", started: "2026-10-25T11:00:00Z", phases: { design: 2 } }));
  writeFileSync(join(dir, "broken.json"), "{ half-writ");
  const c = readCosts(ws);
  check("sessions of one item add up", [c.byItem["P-1"].usd, c.byItem["P-1"].sessions], [2, 2]);
  check("phases add up across sessions", c.byItem["P-1"].phases, { implement: 1, verify: 0.75, pr: 0.25 });
  check("an item starts at its earliest session", c.byItem["P-1"].started, "2026-10-25T10:00:00Z");
  check("a broken file is skipped, the rest still count", [c.measured, c.totalUsd], [true, 4]);

  const cli = join(dirname(fileURLToPath(import.meta.url)), "costs.mjs");
  check("CLI --json is the same reading", JSON.parse(execFileSync("node", [cli, ws, "--json"], { encoding: "utf8" })).totalUsd, 4);
} finally {
  rmSync(ws, { recursive: true, force: true });
}

done();
