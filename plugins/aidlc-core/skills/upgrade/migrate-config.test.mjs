// Tests for migrate-config.mjs. Run: `node migrate-config.test.mjs`.
//
// The property that matters most here is the negative one: a migration must change NO
// value a human authored. Several cases below assert exactly that — the gate commands
// come out the other side verbatim — because a migration that quietly rewrites a
// command produces a project that verifies against something nobody chose.
import { migrateConfig, classify, CURRENT_CONFIG_VERSION } from "./migrate-config.mjs";

let fails = 0;
let n = 0;
function check(label, cond) {
  n++;
  if (cond) console.log(`ok    ${label}`);
  else {
    fails++;
    console.log(`FAIL  ${label}`);
  }
}

const legacyGates = () => ({
  project: { key: "P", name: "P" },
  workItems: { source: "markdown" },
  pipeline: {
    gates: {
      ambiguousRequirements: "assume-and-log",
      steps: [{ name: "test", cmd: "pytest -q" }],
      repos: { api: { steps: [{ name: "lint", cmd: "ruff check ." }] } },
    },
  },
});

// --- classify -------------------------------------------------------------------------
check("a stamped current config is 'current'", classify({ configVersion: CURRENT_CONFIG_VERSION }).shape === "current");
check("an unstamped config is 'legacy'", classify({}).shape === "legacy");
check("a legacy gates block is detected", classify(legacyGates()).shape === "legacy");
check(
  "a legacy gates block is detected even when stamped",
  classify({ ...legacyGates(), configVersion: CURRENT_CONFIG_VERSION }).shape === "legacy",
);
check("a config from a newer plugin is 'newer'", classify({ configVersion: CURRENT_CONFIG_VERSION + 5 }).shape === "newer");
check("classification names its evidence", classify({}).signals.includes("no configVersion stamp"));
check(
  "the gates signal is named",
  classify(legacyGates()).signals.some((s) => s.includes("pre-0.31")),
);
check(
  "gates already under verify is NOT legacy-by-shape",
  classify({ configVersion: CURRENT_CONFIG_VERSION, pipeline: { gates: { verify: { steps: [] } } } }).shape === "current",
);
check(
  "an ambiguousRequirements-only gates block is not legacy",
  classify({ configVersion: CURRENT_CONFIG_VERSION, pipeline: { gates: { ambiguousRequirements: "ask-human" } } }).shape === "current",
);

// --- the gates relocation ----------------------------------------------------------------
{
  const { config, changes } = migrateConfig(legacyGates(), { pluginVersion: "0.46.0" });
  check("steps move under verify", config.pipeline.gates.verify.steps?.[0]?.cmd === "pytest -q");
  check("repos move under verify", config.pipeline.gates.verify.repos?.api?.steps?.[0]?.cmd === "ruff check .");
  check("the old flat keys are gone", !("steps" in config.pipeline.gates) && !("repos" in config.pipeline.gates));
  check(
    "ambiguousRequirements STAYS at pipeline.gates — run §4 reads that path",
    config.pipeline.gates.ambiguousRequirements === "assume-and-log" && !("ambiguousRequirements" in config.pipeline.gates.verify),
  );
  check(
    "the report says ambiguousRequirements was left alone",
    changes.some((c) => c.includes("ambiguousRequirements") && c.includes("left in place")),
  );
  check("every move is reported", changes.some((c) => c.includes("pipeline.gates.steps → pipeline.gates.verify.steps")));
}

// --- relocate, never rewrite ---------------------------------------------------------------
{
  const before = legacyGates();
  const cmd = before.pipeline.gates.steps[0].cmd;
  const { config } = migrateConfig(before, { pluginVersion: "0.46.0" });
  check("the gate command survives verbatim", config.pipeline.gates.verify.steps[0].cmd === cmd);
  check("the input object is not mutated", "steps" in before.pipeline.gates);
  check("unrelated keys are preserved", config.project.key === "P" && config.workItems.source === "markdown");
}

// --- stamps ---------------------------------------------------------------------------------
{
  const { config, changes } = migrateConfig({ project: {}, workItems: {} }, { pluginVersion: "0.46.0" });
  check("configVersion is stamped", config.configVersion === CURRENT_CONFIG_VERSION);
  check("aidlcVersion is stamped", config.aidlcVersion === "0.46.0");
  check("the stamp is reported", changes.some((c) => c.includes("configVersion")));
  check("a stamp with no pluginVersion leaves aidlcVersion alone", !("aidlcVersion" in migrateConfig({}).config));
}

// --- provenance --------------------------------------------------------------------------------
{
  const { config } = migrateConfig(legacyGates(), { pluginVersion: "0.46.0" });
  const up = config.adoption.upgrades[0];
  check("an upgrade is recorded in adoption.upgrades", !!up);
  check("provenance records the origin as unstamped", up.from === "unstamped");
  check("provenance records the plugin version", up.aidlcVersion === "0.46.0");
  check("provenance lists the moves", up.changes.some((c) => c.includes("verify.steps")));
}
{
  // A pure re-stamp is not an upgrade and must not litter the provenance log.
  const { config } = migrateConfig({ project: {}, workItems: {} }, { pluginVersion: "0.46.0" });
  check("a stamp-only migration writes no upgrades entry", !config.adoption?.upgrades);
}
{
  // An existing log is appended to, never replaced.
  const seeded = { ...legacyGates(), adoption: { upgrades: [{ from: "older", to: "1" }] } };
  const { config } = migrateConfig(seeded, { pluginVersion: "0.46.0" });
  check("an existing upgrades log is appended to", config.adoption.upgrades.length === 2);
}

// --- idempotence ---------------------------------------------------------------------------------
{
  const once = migrateConfig(legacyGates(), { pluginVersion: "0.46.0" }).config;
  const twice = migrateConfig(once, { pluginVersion: "0.46.0" });
  check("re-running reports no changes", twice.changes.length === 0);
  check("re-running does not append a second provenance entry", twice.config.adoption.upgrades.length === 1);
  check("re-running is byte-identical", JSON.stringify(twice.config) === JSON.stringify(once));
}

// --- never migrate downward -------------------------------------------------------------------------
{
  const ahead = { configVersion: CURRENT_CONFIG_VERSION + 3, project: {}, workItems: {} };
  const r = migrateConfig(ahead, { pluginVersion: "0.46.0" });
  check("a newer config yields a conflict, not a migration", r.conflicts.length === 1 && r.changes.length === 0);
  check("a newer config is returned untouched", r.config === ahead);
  check("the conflict says to update the plugin", r.conflicts[0].includes("marketplace update"));
}

// --- shape tolerance ----------------------------------------------------------------------------------
check("an empty object does not throw", migrateConfig({}).config.configVersion === CURRENT_CONFIG_VERSION);
check("no arguments does not throw", migrateConfig().changes.length >= 1);
check(
  "a config with no pipeline block is fine",
  migrateConfig({ project: {}, workItems: {} }, { pluginVersion: "1.0.0" }).conflicts.length === 0,
);
check(
  "a gates block that is not an object is ignored rather than crashing",
  migrateConfig({ pipeline: { gates: "nope" } }).conflicts.length === 0,
);

console.log(`\n${n - fails}/${n} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
