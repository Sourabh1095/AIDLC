// Config-shape migration, as a function rather than a procedure to follow.
//
// Two callers: `/aidlc:upgrade` (a project catching up with the plugin) and
// `/aidlc:adopt-apply` §2.1 (which must resolve the version BEFORE merging derived
// values, or it writes a file that is half one contract and half another). Both used to
// need the same reasoning; only one of them had it written down.
//
// The rule that governs every migration here: **relocate, never rewrite.** A migration
// moves a key to where the current contract reads it and changes NO value a human
// authored. If a genuine value change looks unavoidable, that is not a migration — it is
// a conflict for a human to resolve, and this module reports it rather than deciding.
//
// The migration set is deliberately small because `configVersion` is still 1: it is
// bumped only when a key CHANGES MEANING or is REMOVED, and additive keys never bump it
// (which is why the schema allows additional properties everywhere). A long migration
// list here would mean the contract had been churning; a short one is the system working.

/** The contract version this plugin writes. Bump only on a breaking key change. */
export const CURRENT_CONFIG_VERSION = 1;

/**
 * What shape is this config in?
 *   "current"  — stamped at CURRENT_CONFIG_VERSION, nothing to do
 *   "legacy"   — unstamped; classified BY SHAPE, because a stamp cannot be applied
 *                retroactively to the files already in the wild
 *   "older"    — stamped, but below CURRENT_CONFIG_VERSION
 *   "newer"    — stamped ABOVE it: this plugin is older than the config. Never migrate
 *                downward; say so and stop.
 * `signals` names the evidence, so the report can say WHY rather than asserting.
 */
export function classify(cfg = {}) {
  const v = cfg.configVersion;
  const signals = [];
  if (typeof v === "number") {
    if (v > CURRENT_CONFIG_VERSION) return { shape: "newer", version: v, signals: ["configVersion is ahead of this plugin"] };
    if (v < CURRENT_CONFIG_VERSION) return { shape: "older", version: v, signals: [`configVersion ${v} < ${CURRENT_CONFIG_VERSION}`] };
    // Stamped current, but a stamped file can still carry a pre-0.31 gates block if it
    // was stamped by a version that did not migrate it. Check the shape anyway.
    if (hasLegacyGates(cfg)) {
      signals.push("pipeline.gates holds steps/repos directly (pre-0.31 spelling)");
      return { shape: "legacy", version: v, signals };
    }
    return { shape: "current", version: v, signals: [] };
  }
  if (hasLegacyGates(cfg)) signals.push("pipeline.gates holds steps/repos directly (pre-0.31 spelling)");
  if (!cfg.adoption && cfg.architecture?.resolvedBy === "codebase-scan") signals.push("derived config with no adoption block");
  signals.push("no configVersion stamp");
  return { shape: "legacy", version: null, signals };
}

const hasLegacyGates = (cfg) => {
  const g = cfg?.pipeline?.gates;
  return !!g && typeof g === "object" && !g.verify && ("steps" in g || "repos" in g);
};

const clone = (o) => JSON.parse(JSON.stringify(o));

/**
 * Migrate a config to the current shape.
 * Returns { config, changes, conflicts, shape }. `changes` are human-readable one-liners
 * naming the key that moved. `conflicts` are things a human must decide — never applied.
 * Pure: the input object is not modified.
 */
export function migrateConfig(input = {}, { pluginVersion = null } = {}) {
  const { shape, version, signals } = classify(input);
  const cfg = clone(input);
  const changes = [];
  const conflicts = [];

  if (shape === "newer") {
    conflicts.push(
      `configVersion ${version} was written by a NEWER plugin than the one installed. Migrating downward would ` +
        `silently drop keys this plugin does not know about. Update the plugin instead (/plugin marketplace update).`,
    );
    return { config: input, changes, conflicts, shape, signals };
  }

  // --- pipeline.gates.{steps,repos} → pipeline.gates.verify.{…} (pre-0.31) ------------
  // `ambiguousRequirements` STAYS PUT: it is a requirements-phase policy that has always
  // lived at pipeline.gates, and `run` §4 reads that original path. Moving it under
  // `verify` would silently disable the requirements gate — a migration that breaks the
  // thing it is tidying.
  if (hasLegacyGates(cfg)) {
    const g = cfg.pipeline.gates;
    g.verify = g.verify ?? {};
    for (const key of ["steps", "repos", "packages", "maxItemMinutes"]) {
      if (key in g) {
        g.verify[key] = g[key];
        delete g[key];
        const n = Array.isArray(g.verify[key]) ? `${g.verify[key].length} entr${g.verify[key].length === 1 ? "y" : "ies"}` : "unchanged";
        changes.push(`pipeline.gates.${key} → pipeline.gates.verify.${key} (${n}, values verbatim)`);
      }
    }
    if ("ambiguousRequirements" in g) changes.push("pipeline.gates.ambiguousRequirements — left in place (run §4 reads this path)");
  }

  // --- Stamps ---------------------------------------------------------------------------
  if (cfg.configVersion !== CURRENT_CONFIG_VERSION) {
    changes.push(`configVersion ${version ?? "absent"} → ${CURRENT_CONFIG_VERSION}`);
    cfg.configVersion = CURRENT_CONFIG_VERSION;
  }
  if (pluginVersion && cfg.aidlcVersion !== pluginVersion) {
    changes.push(`aidlcVersion ${cfg.aidlcVersion ?? "absent"} → ${pluginVersion}`);
    cfg.aidlcVersion = pluginVersion;
  }

  // --- Provenance -------------------------------------------------------------------------
  // Recorded so that six months from now somebody can see which keys moved without
  // diffing releases. Only written when something actually moved — a pure re-stamp is not
  // an upgrade worth a log entry.
  if (changes.some((c) => c.includes("→ pipeline.gates.verify"))) {
    cfg.adoption = cfg.adoption ?? {};
    cfg.adoption.upgrades = Array.isArray(cfg.adoption.upgrades) ? cfg.adoption.upgrades : [];
    cfg.adoption.upgrades.push({
      from: version === null ? "unstamped" : String(version),
      to: String(CURRENT_CONFIG_VERSION),
      aidlcVersion: pluginVersion ?? null,
      changes: changes.filter((c) => c.includes("→")),
    });
  }

  return { config: cfg, changes, conflicts, shape, signals };
}
