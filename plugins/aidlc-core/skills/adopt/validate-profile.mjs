#!/usr/bin/env node
// Validate an adoption profile written by /aidlc:adopt.
//
//   node validate-profile.mjs <profile.json> [report.md]
//
// Exits 0 when the profile satisfies the contract, 1 otherwise, printing one line per
// violation. Runs offline with no dependencies — the published JSON Schema
// (docs/adoption-profile.schema.json in the AIDLC repo) is the contract for editors and
// CI; this encodes the same invariants so an installed plugin can enforce them without
// the schema file or a network fetch.
//
// It is deliberately NOT a general JSON Schema validator. It checks the load-bearing
// rules — the ones whose violation would put a guess, a leaked credential, or a silent
// coverage hole into a permanent artifact:
//
//   * every fact is one of the three legal forms, and `unknown` may not carry a value
//   * every `known`/`absent` fact carries evidence; every evidence kind carries its payload
//   * the read-only guarantee: writes[] never leaves .aidlc/adoption/
//   * no credential-shaped string appears anywhere in the profile or the report
//   * an unreachable root names its remedy, and an unsupported surface names its gap
//   * no ADR candidate carries a rationale — the scan never saw the why
//   * every auth / tenant-isolation / billing path reaches the security-review seeds
//   * a package's dependsOn resolves to siblings and the graph is acyclic
//   * a sensitive debt finding never names where the secret is — a tracker item may be public
//   * drift attributed to a human's edit is never proposed for overwrite

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

let errors = [];
let warnings = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);
const warn = (where, msg) => warnings.push(`${where}: ${msg}`);

// These mirror the enums in the published schema. They are duplicated here on purpose — the
// plugin must validate offline, without the schema file — and validate-profile.test.mjs
// cross-checks every one of them against docs/adoption-profile.schema.json when run inside
// the AIDLC repo, so the duplication cannot drift silently.
export const DEPTHS = ["quick", "standard", "deep"];
export const CONFIDENCES = ["high", "medium", "low"];
export const STATUSES = ["known", "absent", "unknown"];
export const EVIDENCE_KINDS = ["path", "command", "absence", "user"];
export const RESOLVED_FROM = ["code-workspace-file", "opened-folder", "user"];
export const SHAPES = ["single-root", "nested-multi-repo", "multi-root"];
export const TOPOLOGIES = ["single-app", "monorepo", "poly", "unknown"];
export const CLASSIFICATIONS = [
  "product-repo", "monorepo", "non-repo", "reference-only", "already-adopted", "not-cloned", "unknown",
];
export const SKIP_REASONS = [
  "vendored", "generated", "build-output", "gitignored", "lfs-pointer", "over-size", "binary",
  "unreadable", "env-file", "pii-suspect", "out-of-scope", "cap-reached",
];
export const SUPPORTS = ["supported", "partial", "unsupported", "unknown"];
export const SURFACE_KINDS = [
  "stack", "tracker", "vcs", "ci", "migration-tool", "container", "hooks", "ide",
  "release-channel", "other",
];
export const DOC_KINDS = ["adr", "rfc", "design-doc", "wiki", "readme", "other"];
export const DECLARED_BY = ["code-workspace", "folder-scan", "config", "user"];
export const GATE_STATUSES = ["present", "absent"];
export const GATE_SCOPES = ["repo", "package", "affected", "changed-paths"];
export const COMMIT_STYLES = ["conventional", "id-prefixed", "imperative-freeform", "mixed", "none"];
export const MERGE_STRATEGIES = ["merge", "squash", "rebase", "mixed"];
export const PUSH_ACCESS = ["direct", "fork-only", "unknown"];
// `project-action` covers a gap only the project can close (git init on a zip drop, adopt a
// tracker) — so "every unsupported surface names a gap" stays enforceable without pretending
// AIDLC could ship a plugin for it.
export const GAP_KINDS = ["skill", "agent", "plugin", "adapter", "project-action"];
export const TENANCY_MODELS = [
  "shared-schema", "schema-per-tenant", "database-per-tenant", "single-tenant", "not-multi-tenant",
];
export const LIVE_DATA_CONSTRAINTS = ["expand-contract", "not-required"];
export const DEPLOY_STRATEGIES = [
  "rolling", "blue-green", "canary", "recreate", "release-train", "manual", "continuous",
];
export const API_CONTRACT_KINDS = ["openapi", "graphql", "proto", "grpc", "asyncapi", "json-schema", "wsdl"];
export const ENVIRONMENT_KINDS = ["dev", "test", "staging", "production", "preview", "other"];
export const COMPLIANCE_REGIMES = ["soc2", "hipaa", "gdpr", "pci", "iso27001", "fedramp", "other"];
export const MESSAGING_KINDS = ["queue", "broker", "stream", "scheduler", "webhook"];
export const ADR_DECISION_KINDS = [
  "framework", "data-store", "auth-model", "tenancy-model", "api-style", "deployment-topology",
  "messaging", "migration-strategy", "frontend-architecture", "build-tooling", "observability", "other",
];
export const ADR_CANDIDATE_STATUSES = ["propose", "already-recorded"];
export const REVERSIBILITY_COSTS = ["high", "medium", "low"];
export const DEBT_KINDS = [
  "absent-gate", "untested-critical-path", "eol-dependency", "todo-cluster",
  "unreviewed-sensitive-path", "docs-drift", "committed-secret", "pii-in-fixtures",
  "cross-platform-hazard", "ungated-integration", "other",
];
export const DEBT_SEVERITIES = ["high", "medium", "low"];
export const DEBT_ITEM_TYPES = ["story", "task", "bug", "spike"];
export const DEBT_SIZES = ["S", "M", "L", "XL"];
export const DRIFT_BASELINE_KINDS = ["previous-profile", "config-only", "none"];
export const DRIFT_CHANGE_KINDS = [
  "root-added", "root-removed", "classification-changed", "package-added", "package-removed",
  "gate-added", "gate-removed", "gate-changed", "stack-changed", "convention-changed",
  "saas-changed", "topology-changed", "release-tooling-changed", "surface-support-changed",
  "adr-superseded", "other",
];
export const DRIFT_SOURCES = ["code", "config", "human-edit", "scan-depth", "unknown"];
export const DRIFT_ACTIONS = ["propose", "report-only", "leave-alone"];

// Tenancy models where migrations run against data real tenants already have. Not a schema enum —
// a derived set the expand/contract rule keys off.
const LIVE_TENANCY = ["shared-schema", "schema-per-tenant", "database-per-tenant"];
// A candidate may not carry the WHY in any spelling. The scan saw code, not the conversation that
// produced it, and a plausible sentence in an `accepted` ADR becomes history nobody authored.
const INVENTED_RATIONALE_FIELDS = ["rationale", "why", "because", "alternatives", "alternativesConsidered"];
const DEFAULT_ADR_CAP = 8;
// A debt finding states the debt; it never ships the change. The scan sampled the code and did not
// design the fix, and a finding carrying its own patch invites the item to be closed by applying it
// unread — which routes around the plan/implement/review/verify path the pipeline exists to run.
const INVENTED_REMEDY_FIELDS = ["fix", "remedy", "patch", "diff", "solution"];
// Kinds whose very location is the disclosure. A tracker item may be a public GitHub issue.
const SENSITIVE_DEBT_KINDS = ["committed-secret", "pii-in-fixtures"];
const DEFAULT_DEBT_CAP = 20;

// Credential shapes that must never reach a profile or a report. The scan is required to
// redact secret findings and to strip credentials from remote URLs; this is the backstop
// that turns "we were careful" into a check.
const SECRET_PATTERNS = [
  [/AKIA[0-9A-Z]{16}/, "AWS access key id"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key block"],
  [/\bgh[pousr]_[A-Za-z0-9]{16,}/, "GitHub token"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/, "GitHub fine-grained PAT"],
  [/\bglpat-[A-Za-z0-9_-]{16,}/, "GitLab PAT"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, "Slack token"],
  [/\bsk-[A-Za-z0-9]{32,}/, "API secret key"],
  [/\bAIza[0-9A-Za-z_-]{30,}/, "Google API key"],
  [/[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/, "credentials embedded in a URL"],
];

function scanForSecrets(text, where) {
  for (const [re, label] of SECRET_PATTERNS) {
    const m = text.match(re);
    if (m) err(where, `contains a ${label} — values must be redacted, never written (matched ${m[0].slice(0, 8)}…)`);
  }
}

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const nonEmptyStr = (v) => typeof v === "string" && v.trim() !== "";
const isAbsolute = (p) =>
  typeof p === "string" && (/^[A-Za-z]:[\\/]/.test(p) || p.startsWith("/") || p.startsWith("\\\\"));

function enumField(obj, key, allowed, where, { required = true } = {}) {
  const v = obj?.[key];
  if (v === undefined) {
    if (required) err(where, `missing \`${key}\``);
    return;
  }
  if (!allowed.includes(v)) err(where, `\`${key}\` is ${JSON.stringify(v)} — must be one of ${allowed.join(" | ")}`);
}

function checkEvidence(ev, where) {
  if (!Array.isArray(ev) || ev.length === 0) {
    err(where, "evidence must be a non-empty array — a claim without a citation is a guess");
    return;
  }
  ev.forEach((e, i) => {
    const at = `${where}.evidence[${i}]`;
    if (!isObj(e)) return err(at, "must be an object");
    enumField(e, "kind", EVIDENCE_KINDS, at);
    if (e.kind === "path" && !nonEmptyStr(e.path)) err(at, "kind=path requires `path`");
    if (e.kind === "command" && !(nonEmptyStr(e.command) && typeof e.output === "string"))
      err(at, "kind=command requires `command` and `output`");
    if (e.kind === "absence" && !nonEmptyStr(e.note))
      err(at, "kind=absence requires `note` naming what was searched and came back empty");
    if (e.line !== undefined && !(Number.isInteger(e.line) && e.line >= 1))
      err(at, "`line` must be an integer >= 1");
    if (typeof e.excerpt === "string" && e.excerpt.length > 200)
      err(at, `\`excerpt\` is ${e.excerpt.length} chars — cap is 200`);
    if (typeof e.output === "string" && e.output.length > 2000)
      err(at, `\`output\` is ${e.output.length} chars — cap is 2000 (truncate and say so)`);
  });
}

// The heart of the contract: three legal fact forms and nothing else.
function checkFact(f, where, { valueEnum = null, requireKnown = false } = {}) {
  if (f === undefined) {
    if (requireKnown) err(where, "missing — expected a fact object");
    return;
  }
  if (!isObj(f)) return err(where, "must be a fact object {status, …}");
  enumField(f, "status", STATUSES, where);

  if (f.status === "known") {
    if (f.value === undefined) err(where, "status=known requires `value`");
    checkEvidence(f.evidence, where);
    enumField(f, "confidence", CONFIDENCES, where);
    if (valueEnum && f.value !== undefined && !valueEnum.includes(f.value))
      err(where, `\`value\` is ${JSON.stringify(f.value)} — must be one of ${valueEnum.join(" | ")}`);
  } else if (f.status === "absent") {
    checkEvidence(f.evidence, where);
    if (f.value !== undefined) err(where, "status=absent must not carry a `value`");
  } else if (f.status === "unknown") {
    if (!nonEmptyStr(f.reason)) err(where, "status=unknown requires `reason` — an undocumented gap is an invisible one");
    // The failure this whole design exists to prevent: a value shipped beside "we don't know".
    if (f.value !== undefined) err(where, "status=unknown must not carry a `value` — that is the guess the contract forbids");
    if (f.confidence !== undefined) err(where, "status=unknown must not carry a `confidence`");
  }
  if (requireKnown && f.status !== "known") warn(where, `status=${f.status} — this run could not establish it`);
}

function checkDetected(d, where) {
  if (!isObj(d)) return err(where, "must be an object");
  if (!nonEmptyStr(d.name)) err(where, "missing `name`");
  checkEvidence(d.evidence, where);
  enumField(d, "confidence", CONFIDENCES, where);
  if (d.support !== undefined) enumField(d, "support", SUPPORTS, where);
  if (d.paths !== undefined && !Array.isArray(d.paths)) err(where, "`paths` must be an array");
}

// One gate. `present` carries the project's own command; `absent` is a stated coverage hole and
// cannot be `required` — a missing gate that claims to block would read as green.
function checkGate(g, where, seen) {
  if (!isObj(g)) return err(where, "must be an object");
  if (!nonEmptyStr(g.name)) err(where, "missing `name`");
  enumField(g, "status", GATE_STATUSES, where);
  enumField(g, "scope", GATE_SCOPES, where);
  if (typeof g.required !== "boolean") err(where, "missing `required` (boolean)");
  checkEvidence(g.evidence, where);
  if (g.confidence !== undefined) enumField(g, "confidence", CONFIDENCES, where);

  if (g.status === "present" && !nonEmptyStr(g.cmd))
    err(where, "status=present requires `cmd` — the command the project actually runs, verbatim");
  if (g.status === "absent") {
    if (g.cmd !== undefined) err(where, "status=absent must not carry a `cmd` — there is no command to record");
    if (g.required === true)
      err(where, "an absent gate cannot be `required: true` — a gate that does not exist cannot block, and marking it required is how a coverage hole reads as green");
  }
  if (g.scope === "package" && !nonEmptyStr(g.package))
    err(where, "scope=package requires `package` naming which one");
  if (g.timeoutMinutes !== undefined && !(Number.isInteger(g.timeoutMinutes) && g.timeoutMinutes >= 1))
    err(where, "`timeoutMinutes` must be an integer >= 1, and only when the project states one");
  if (g.environmentDependent === true && !(Array.isArray(g.services) && g.services.length))
    warn(where, "environmentDependent with no `services` listed — name them so an environment failure is diagnosable");

  // Two gates with the same name in the same scope make execution order ambiguous.
  const key = `${g.name} ${g.package ?? ""}`;
  if (seen.has(key)) err(where, `duplicate gate \`${g.name}\`${g.package ? ` for package ${g.package}` : ""} — the gate list is an ordered sequence, so names must be unique within a scope`);
  else seen.add(key);
}

function checkConventions(c, where, root) {
  if (!isObj(c)) return err(where, "must be an object");
  const enumFacts = [
    ["commitStyle", COMMIT_STYLES],
    ["mergeStrategy", MERGE_STRATEGIES],
    ["pushAccess", PUSH_ACCESS],
  ];
  for (const [k, allowed] of enumFacts)
    if (c[k] !== undefined) checkFact(c[k], `${where}.${k}`, { valueEnum: allowed });
  for (const k of ["branchPattern", "integrationBranch", "longLivedBranches", "hotfixRoute", "codeowners", "requiredReviewers", "protectedBranches"])
    if (c[k] !== undefined) checkFact(c[k], `${where}.${k}`);

  // fork-only contribution with no upstream leaves the integration path undefined — the run would
  // discover it at push time, which is the failure detecting this early is meant to prevent.
  if (c.pushAccess?.status === "known" && c.pushAccess.value === "fork-only" &&
      root?.vcs?.upstream?.status !== "known")
    err(`${where}.pushAccess`, "is `fork-only` but vcs.upstream is not established — a fork contribution path needs the upstream it targets, or the integration step has nowhere to open a PR");

  // integrationBranch exists to name a target that ISN'T the default branch. Equal to it means the
  // project is not GitFlow and the field should be absent, or one of the two was mis-derived.
  if (c.integrationBranch?.status === "known" && root?.vcs?.defaultBranch?.status === "known" &&
      c.integrationBranch.value === root.vcs.defaultBranch.value)
    err(`${where}.integrationBranch`, `equals vcs.defaultBranch (\`${c.integrationBranch.value}\`) — it exists to name a target that is NOT the default branch; omit it, or correct whichever was mis-derived`);
}

function checkCommandFact(f, where) {
  checkFact(f, where);
  if (isObj(f) && f.status === "known") {
    if (!isObj(f.value)) err(where, "status=known requires `value` to be {cmd, …}");
    else if (!nonEmptyStr(f.value.cmd)) err(where, "`value.cmd` is required and must be the command verbatim");
  }
}

// A fact whose value is a list of records. Returns the list when it is one, else records the error
// and returns [] — so callers can inspect entries without re-checking the shape.
function knownList(f, where) {
  if (!isObj(f) || f.status !== "known") return [];
  if (!Array.isArray(f.value)) {
    err(where, "status=known requires `value` to be an array");
    return [];
  }
  return f.value;
}

// A fact whose value is a list of path strings (auth paths, tenant-isolation paths, …).
function pathListFact(f, where) {
  checkFact(f, where);
  const list = knownList(f, where);
  list.forEach((p, i) => {
    if (!nonEmptyStr(p)) err(`${where}.value[${i}]`, "must be a non-empty path string");
  });
  return list.filter(nonEmptyStr);
}

// ---- ADOPT-9: the runtime constraints that change how code must be written ----
// The scan's job here is narrow: state a constraint only where the code evidences it. So most of
// this is the ordinary fact contract. Two rules are not ordinary, and both exist because their
// violation is invisible: a multi-tenant project with migrations that never answers whether
// expand/contract applies, and a path recorded as auth-critical that never reaches the seeds the
// apply step turns into securityReviewPaths.
function checkSaas(saas, where) {
  if (!isObj(saas)) return err(where, "must be an object");

  checkFact(saas.tenancy, `${where}.tenancy`, { valueEnum: TENANCY_MODELS });
  checkFact(saas.liveDataConstraint, `${where}.liveDataConstraint`, { valueEnum: LIVE_DATA_CONSTRAINTS });
  checkFact(saas.deployStrategy, `${where}.deployStrategy`, { valueEnum: DEPLOY_STRATEGIES });

  const isolation = pathListFact(saas.tenantIsolationPaths, `${where}.tenantIsolationPaths`);
  const auth = pathListFact(saas.authPaths, `${where}.authPaths`);
  const billing = pathListFact(saas.billingPaths, `${where}.billingPaths`);

  if (saas.featureFlags !== undefined) {
    checkFact(saas.featureFlags, `${where}.featureFlags`);
    if (saas.featureFlags.status === "known" && !nonEmptyStr(saas.featureFlags.value?.provider))
      err(`${where}.featureFlags`, "status=known requires `value.provider` — name the flag system (or 'homegrown'); an unnamed one cannot be briefed to the implementer");
  }
  if (saas.migrations !== undefined) {
    checkFact(saas.migrations, `${where}.migrations`);
    if (saas.migrations.status === "known" && !nonEmptyStr(saas.migrations.value?.tool))
      err(`${where}.migrations`, "status=known requires `value.tool` — the migration tool by name");
  }
  if (saas.experimentation !== undefined) checkFact(saas.experimentation, `${where}.experimentation`);

  if (saas.apiContracts !== undefined) {
    checkFact(saas.apiContracts, `${where}.apiContracts`);
    knownList(saas.apiContracts, `${where}.apiContracts`).forEach((c, i) => {
      const at = `${where}.apiContracts.value[${i}]`;
      if (!isObj(c)) return err(at, "must be {kind, path, public?}");
      if (!nonEmptyStr(c.path))
        err(at, "missing `path` — these paths ARE the contract-affecting set the run matches a diff against, so an entry without one triggers nothing");
      if (c.kind !== undefined) enumField(c, "kind", API_CONTRACT_KINDS, at);
    });
  }
  if (saas.environments !== undefined) {
    checkFact(saas.environments, `${where}.environments`);
    knownList(saas.environments, `${where}.environments`).forEach((e, i) => {
      const at = `${where}.environments.value[${i}]`;
      if (!isObj(e)) return err(at, "must be {name, kind?}");
      if (!nonEmptyStr(e.name)) err(at, "missing `name`");
      if (e.kind !== undefined) enumField(e, "kind", ENVIRONMENT_KINDS, at);
    });
  }
  if (saas.freezeWindows !== undefined) {
    checkFact(saas.freezeWindows, `${where}.freezeWindows`);
    knownList(saas.freezeWindows, `${where}.freezeWindows`).forEach((f, i) => {
      const at = `${where}.freezeWindows.value[${i}]`;
      if (!isObj(f)) return err(at, "must be {when, source}");
      if (!nonEmptyStr(f.when)) err(at, "missing `when`");
      if (!nonEmptyStr(f.source))
        err(at, "missing `source` — an unsourced freeze window is a rumour, and it would block an integration on nothing");
    });
  }
  if (saas.compliance !== undefined) {
    checkFact(saas.compliance, `${where}.compliance`);
    knownList(saas.compliance, `${where}.compliance`).forEach((c, i) => {
      const at = `${where}.compliance.value[${i}]`;
      if (!isObj(c)) return err(at, "must be {regime, signal}");
      enumField(c, "regime", COMPLIANCE_REGIMES, at);
      if (!nonEmptyStr(c.signal))
        err(at, "missing `signal` — a compliance regime raises the review cost of every future change, so the thing that evidenced it must be named");
    });
  }
  for (const [key, allowed] of [["messaging", MESSAGING_KINDS]]) {
    if (saas[key] === undefined) continue;
    checkFact(saas[key], `${where}.${key}`);
    knownList(saas[key], `${where}.${key}`).forEach((m, i) => {
      const at = `${where}.${key}.value[${i}]`;
      if (!isObj(m)) return err(at, "must be {name, kind?, paths?}");
      if (!nonEmptyStr(m.name)) err(at, "missing `name`");
      if (m.kind !== undefined) enumField(m, "kind", allowed, at);
    });
  }
  for (const key of ["observability", "integrations"]) {
    if (saas[key] === undefined) continue;
    checkFact(saas[key], `${where}.${key}`);
    knownList(saas[key], `${where}.${key}`).forEach((o, i) => {
      const at = `${where}.${key}.value[${i}]`;
      if (!isObj(o)) return err(at, "must be {name, paths?}");
      if (!nonEmptyStr(o.name)) err(at, "missing `name`");
    });
  }

  // RULE 1 — a multi-tenant project with a migration tool must ANSWER the expand/contract question.
  // Leaving it unstated disarms the destructive-migration blocker while looking like a clean profile:
  // the reviewer brief carries no constraint, so a dropped column reads as an ordinary refactor.
  const tenancyValue = saas.tenancy?.status === "known" ? saas.tenancy.value : null;
  const multiTenant = tenancyValue !== null && LIVE_TENANCY.includes(tenancyValue);
  const hasMigrations = saas.migrations?.status === "known";
  if (multiTenant && hasMigrations) {
    if (saas.liveDataConstraint?.status !== "known")
      err(`${where}.liveDataConstraint`, `tenancy is \`${tenancyValue}\` and a migration tool is recorded, so this must be answered (\`expand-contract\` or \`not-required\`, with evidence) — left unstated, the reviewer brief carries no migration constraint and a destructive migration against live tenant data reads as an ordinary refactor`);
    else if (saas.liveDataConstraint.value === "not-required")
      warn(`${where}.liveDataConstraint`, `\`not-required\` under \`${tenancyValue}\` tenancy — legitimate only for a pre-launch or upgrade-migrated deployment; the evidence must say which, because this is what switches the destructive-migration blocker off`);
  }

  // RULE 2 — AC7, mechanically. A path recorded as auth-critical, tenant-isolating or
  // revenue-critical and missing from the seeds is a path the apply step never adds to
  // securityReviewPaths: recorded as sensitive, reviewed as ordinary.
  const seeds = saas.securityReviewPathSeeds;
  const sensitive = [...isolation, ...auth, ...billing];
  if (sensitive.length) {
    if (!Array.isArray(seeds)) {
      err(`${where}.securityReviewPathSeeds`, `missing while ${sensitive.length} auth/tenant-isolation/billing path(s) are recorded — those paths must trigger security review regardless of cadence, and the seeds are how that reaches config`);
    } else {
      const have = new Set(seeds.map(String));
      const missing = [...new Set(sensitive)].filter((p) => !have.has(p));
      if (missing.length)
        err(`${where}.securityReviewPathSeeds`, `does not include ${missing.map((p) => `\`${p}\``).join(", ")} — recorded as auth/tenant-isolation/billing but never seeded, so a diff there would be reviewed on the ordinary cadence`);
    }
  }
  if (Array.isArray(seeds))
    seeds.forEach((p, i) => {
      if (!nonEmptyStr(p)) err(`${where}.securityReviewPathSeeds[${i}]`, "must be a non-empty path string");
    });
}

// ---- ADOPT-8: the package dimension ----
// Two silent failures: a dependsOn naming a package that does not exist (sequencing quietly does
// nothing) and a cycle (there is no answer to "which lands first"). Plus a package claiming its own
// release cadence with no tooling that could cut one.
function checkPackages(pkgs, where, root) {
  if (!Array.isArray(pkgs)) return err(where, "must be an array");
  const names = new Set();
  pkgs.forEach((pk, j) => {
    const at = `${where}[${j}]`;
    if (!isObj(pk)) return err(at, "must be an object");
    if (!nonEmptyStr(pk.name)) err(at, "missing `name`");
    else if (names.has(pk.name)) err(at, `duplicate package name \`${pk.name}\` — names route work items and key per-package gates`);
    else names.add(pk.name);
    if (!nonEmptyStr(pk.path)) err(at, "missing `path`");
    checkEvidence(pk.evidence, at);
    if (pk.releasable !== undefined && typeof pk.releasable !== "boolean")
      err(`${at}.releasable`, "must be a boolean");
    if (pk.dependsOn !== undefined && !Array.isArray(pk.dependsOn))
      err(`${at}.dependsOn`, "must be an array of sibling package names");
    if (pk.languages !== undefined && !Array.isArray(pk.languages))
      err(`${at}.languages`, "must be an array");
  });

  // dependsOn must resolve to siblings, or sequencing silently sequences nothing.
  pkgs.forEach((pk, j) => {
    for (const dep of Array.isArray(pk?.dependsOn) ? pk.dependsOn : []) {
      if (!names.has(dep))
        err(`${where}[${j}].dependsOn`, `\`${dep}\` is not a package in this root — a dependency that resolves to nothing sequences nothing, and cross-package ordering silently becomes arbitrary`);
      if (dep === pk.name)
        err(`${where}[${j}].dependsOn`, `\`${dep}\` depends on itself`);
    }
  });

  // Cycles: iterative DFS with a colour map. A cycle makes "which lands first" unanswerable, so it
  // must fail loudly rather than produce an arbitrary order at run time.
  const graph = new Map(pkgs.filter((p) => nonEmptyStr(p?.name)).map((p) => [p.name, (Array.isArray(p.dependsOn) ? p.dependsOn : []).filter((d) => names.has(d))]));
  const state = new Map(); // 1 = on the current path, 2 = fully explored
  const reported = new Set();
  for (const start of graph.keys()) {
    if (state.get(start) === 2) continue;
    const stack = [[start, 0]];
    const onPath = [];
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const [node, i] = frame;
      if (i === 0) {
        if (state.get(node) === 1) {
          const cycle = onPath.slice(onPath.indexOf(node)).concat(node).join(" -> ");
          if (!reported.has(cycle)) {
            reported.add(cycle);
            err(where, `dependency cycle ${cycle} — "which package lands first" has no answer, so cross-package sequencing would be arbitrary`);
          }
          stack.pop();
          continue;
        }
        if (state.get(node) === 2) { stack.pop(); continue; }
        state.set(node, 1);
        onPath.push(node);
      }
      const deps = graph.get(node) ?? [];
      if (i < deps.length) {
        frame[1] = i + 1;
        stack.push([deps[i], 0]);
      } else {
        state.set(node, 2);
        onPath.pop();
        stack.pop();
      }
    }
  }

  // A per-package release needs tooling that can cut one; otherwise /aidlc:release would promise a
  // cadence the repo cannot deliver.
  const releasable = pkgs.filter((p) => p?.releasable === true).map((p) => p?.name);
  if (releasable.length && root?.releaseTooling?.status !== "known")
    err(`${where}`, `package(s) ${releasable.map((n) => `\`${n}\``).join(", ")} are marked \`releasable\` but the root records no \`releaseTooling\` — a per-package release needs tooling that supports independent versioning, and claiming the cadence without it makes /aidlc:release fail at the cut`);
}

// ---- ADOPT-10: retroactive ADR candidates ----
function checkAdrCandidates(list, profile) {
  if (!Array.isArray(list)) return err("adrCandidates", "must be an array");
  const rootNames = new Set(
    (Array.isArray(profile?.workspace?.roots) ? profile.workspace.roots : [])
      .map((r) => r?.name).filter(nonEmptyStr),
  );
  const kinds = new Set();
  list.forEach((c, i) => {
    const at = `adrCandidates[${i}]`;
    if (!isObj(c)) return err(at, "must be an object");
    enumField(c, "decisionKind", ADR_DECISION_KINDS, at);
    if (nonEmptyStr(c.decisionKind)) {
      if (kinds.has(c.decisionKind))
        err(at, `duplicate decisionKind \`${c.decisionKind}\` — one decision would get two ADRs, and the de-duplication that keeps re-adoption quiet keys off this field`);
      else kinds.add(c.decisionKind);
    }
    if (!nonEmptyStr(c.title))
      err(at, "missing `title` — it becomes the ADR's H1 and must state the decision, not name its topic");
    enumField(c, "status", ADR_CANDIDATE_STATUSES, at);
    enumField(c, "reversibilityCost", REVERSIBILITY_COSTS, at);
    checkEvidence(c.evidence, at);

    if (c.status === "already-recorded" && !nonEmptyStr(c.existingAdr))
      err(at, "status=already-recorded requires `existingAdr` — the ADR or doc that records it, so a reader can verify the decision really is covered");
    if (c.status === "propose" && c.existingAdr !== undefined)
      err(at, "status=propose must not carry `existingAdr` — if a doc already records it, the status is already-recorded and nothing is proposed");

    for (const field of INVENTED_RATIONALE_FIELDS)
      if (c[field] !== undefined)
        err(at, `carries \`${field}\` — the scan read code, not the conversation that produced it. The rendered ADR marks the rationale *not recorded — confirm with the team*; a plausible sentence here becomes permanent history nobody authored`);

    if (c.decidedAt !== undefined) checkFact(c.decidedAt, `${at}.decidedAt`);
    if (c.consequencesObserved !== undefined) {
      if (!Array.isArray(c.consequencesObserved)) err(`${at}.consequencesObserved`, "must be an array of strings");
      else c.consequencesObserved.forEach((s, j) => {
        if (!nonEmptyStr(s)) err(`${at}.consequencesObserved[${j}]`, "must be a non-empty string");
      });
    }
    if (c.root !== undefined && rootNames.size && !rootNames.has(c.root))
      err(`${at}.root`, `\`${c.root}\` is not a declared root — a candidate must cite the root whose code evidences it`);
  });

  // Ranked highest-reversibility-cost first: the cap must drop the decisions that are cheap to
  // change, never the one that would cost a migration to undo.
  const proposals = list.filter((c) => c?.status === "propose");
  const rank = (c) => REVERSIBILITY_COSTS.indexOf(c?.reversibilityCost);
  for (let i = 1; i < proposals.length; i++) {
    const prev = rank(proposals[i - 1]), cur = rank(proposals[i]);
    if (prev >= 0 && cur >= 0 && cur < prev) {
      err("adrCandidates", `is not ranked by reversibility cost — \`${proposals[i].decisionKind}\` (${proposals[i].reversibilityCost}) follows \`${proposals[i - 1].decisionKind}\` (${proposals[i - 1].reversibilityCost}). The cap truncates the tail, so an unranked list drops the expensive decisions first`);
      break;
    }
  }

  const cap = profile?.scan?.budget?.caps?.maxAdrCandidates ?? DEFAULT_ADR_CAP;
  if (proposals.length > cap)
    err("adrCandidates", `proposes ${proposals.length} ADRs but the cap is ${cap} — raise scan.budget.caps.maxAdrCandidates deliberately or keep the top ${cap}; an uncapped list is a review nobody finishes`);
}

// ---- ADOPT-11: debt findings, the backlog seed ----
// Three failures here are invisible rather than loud. A sensitive finding that names its location
// becomes a public tracker item disclosing an unfixed credential. An absent-gate finding for a gate
// the project actually has discredits the whole backlog on the first item somebody checks. And an
// unranked list under a cap drops an unreviewed auth path to keep a formatting nit.
function checkDebtFindings(list, profile) {
  if (!Array.isArray(list)) return err("debtFindings", "must be an array");
  const roots = Array.isArray(profile?.workspace?.roots) ? profile.workspace.roots : [];
  const byName = new Map(roots.filter((r) => nonEmptyStr(r?.name)).map((r) => [r.name, r]));

  list.forEach((f, i) => {
    const at = `debtFindings[${i}]`;
    if (!isObj(f)) return err(at, "must be an object");
    enumField(f, "kind", DEBT_KINDS, at);
    enumField(f, "severity", DEBT_SEVERITIES, at);
    if (!nonEmptyStr(f.title))
      err(at, "missing `title` — it becomes the item's title and must state the OUTCOME ('Add a typecheck gate to the payments service'), not the symptom");
    checkEvidence(f.evidence, at);
    if (f.confidence !== undefined) enumField(f, "confidence", CONFIDENCES, at);
    if (f.suggestedType !== undefined) enumField(f, "suggestedType", DEBT_ITEM_TYPES, at);
    if (f.suggestedSize !== undefined) enumField(f, "suggestedSize", DEBT_SIZES, at);

    for (const field of INVENTED_REMEDY_FIELDS)
      if (f[field] !== undefined)
        err(at, `carries \`${field}\` — a finding states the debt, never the change. The scan sampled this code; it did not design the fix, and a remedy shipped with the finding invites the item to be closed by applying it unread`);

    // The disclosure rule. `sensitive` means naming the location IS the leak.
    const mustBeSensitive = SENSITIVE_DEBT_KINDS.includes(f.kind);
    if (mustBeSensitive && f.sensitive !== true)
      err(at, `kind=${f.kind} must set \`sensitive: true\` — a tracker item may be a public issue, and one naming where an unfixed credential or a PII fixture lives turns adoption into a disclosure`);
    if (f.sensitive === true) {
      if (!nonEmptyStr(f.trackerSafeTitle))
        err(at, "sensitive findings require `trackerSafeTitle` — the title that goes on the item, disclosing nothing and pointing at the adoption report, which stays in the repo");
      if (f.paths !== undefined)
        err(at, "sensitive findings must not carry `paths` — the location is the disclosure; it belongs in the report, not in an item that may be world-readable");
    } else if (f.paths !== undefined && !Array.isArray(f.paths)) {
      err(`${at}.paths`, "must be an array");
    } else if (!Array.isArray(f.paths) && f.kind !== "absent-gate" && f.kind !== "ungated-integration") {
      warn(at, "carries neither `paths` nor `sensitive` — an item with no location is one nobody can start");
    }

    // An absent-gate finding must correspond to a gate the root really lacks.
    if (f.kind === "absent-gate") {
      if (!nonEmptyStr(f.gate)) {
        err(at, "kind=absent-gate requires `gate` naming which one");
      } else if (nonEmptyStr(f.root) && byName.has(f.root)) {
        const gates = Array.isArray(byName.get(f.root).gates) ? byName.get(f.root).gates : [];
        const match = gates.find((g) => g?.name === f.gate);
        if (match && match.status !== "absent")
          err(at, `proposes adding the \`${f.gate}\` gate but root \`${f.root}\` records it as status=${match.status} — the project already has it, and a backlog whose first item is provably wrong is one nobody reads twice`);
        else if (!match && gates.length)
          warn(at, `\`${f.gate}\` is not among root \`${f.root}\`'s recorded gates — say in the evidence what was searched, or the finding is unverifiable`);
      }
    }

    if (nonEmptyStr(f.root) && byName.size && !byName.has(f.root))
      err(`${at}.root`, `\`${f.root}\` is not a declared root — the finding's root resolves to the item's repo, so a name that matches nothing routes nowhere`);
    if (nonEmptyStr(f.package) && nonEmptyStr(f.root) && byName.has(f.root)) {
      const pkgs = Array.isArray(byName.get(f.root).packages) ? byName.get(f.root).packages : [];
      if (pkgs.length && !pkgs.some((pk) => pk?.name === f.package))
        err(`${at}.package`, `\`${f.package}\` is not a package in root \`${f.root}\` — it resolves to the item's package, which scopes the gate and the PR label`);
    }
  });

  // Ranked by severity, highest first — the cap must drop hygiene, never an unreviewed auth path.
  const rank = (f) => DEBT_SEVERITIES.indexOf(f?.severity);
  for (let i = 1; i < list.length; i++) {
    const prev = rank(list[i - 1]), cur = rank(list[i]);
    if (prev >= 0 && cur >= 0 && cur < prev) {
      err("debtFindings", `is not ranked by severity — \`${list[i].kind}\` (${list[i].severity}) follows \`${list[i - 1].kind}\` (${list[i - 1].severity}). The cap truncates the tail, so an unranked list drops the findings that matter first`);
      break;
    }
  }

  const cap = profile?.scan?.budget?.caps?.maxDebtFindings ?? DEFAULT_DEBT_CAP;
  if (list.length > cap)
    err("debtFindings", `carries ${list.length} findings but the cap is ${cap} — raise scan.budget.caps.maxDebtFindings deliberately or keep the top ${cap}; an uncapped debt list is a triage nobody finishes`);
}

// ---- ADOPT-12: drift on re-adoption ----
// The comparison is three-way and two of the three legs must be handled in opposite directions.
// Code that moved is drift to propose; a config value a HUMAN changed after adoption is intent the
// scan cannot see. Proposing to "fix" the second is how a re-adoption reverts a hand-tuned gate with
// a diff that looks like routine convergence — which is why source=human-edit is pinned to
// action=leave-alone here rather than left to the apply step's judgement.
function checkDrift(d, profile) {
  if (!isObj(d)) return err("drift", "must be an object");

  const b = d.baseline;
  if (!isObj(b)) {
    err("drift.baseline", "missing — a drift report must say what it compared itself against, or its changes are unattributable");
  } else {
    enumField(b, "kind", DRIFT_BASELINE_KINDS, "drift.baseline");
    if (b.depth !== undefined) enumField(b, "depth", DEPTHS, "drift.baseline");
    if (b.scannedAt !== undefined && Number.isNaN(Date.parse(b.scannedAt)))
      err("drift.baseline.scannedAt", "not an ISO-8601 timestamp");
  }

  const changes = d.changes;
  if (changes !== undefined && !Array.isArray(changes)) return err("drift.changes", "must be an array");
  const list = Array.isArray(changes) ? changes : [];

  // No baseline, no drift. Reporting a whole project as "new" on first contact is noise that teaches
  // people to skip the section — and then the one real change later goes unread.
  if (b?.kind === "none" && list.length)
    err("drift.changes", `baseline.kind is "none" but ${list.length} change(s) are recorded — with nothing to compare against there is no drift; on a first adoption this section is empty and the profile itself is the baseline for next time`);

  // A depth change explains most apparent movement. Unlabelled, it buries the real drift.
  const scanDepth = profile?.scan?.depth;
  if (nonEmptyStr(b?.depth) && nonEmptyStr(scanDepth) && b.depth !== scanDepth && d.depthChanged !== true)
    err("drift.depthChanged", `must be true — the baseline ran at depth \`${b.depth}\` and this run at \`${scanDepth}\`, so facts that were never sampled before now read as changes. Unlabelled, that buries the differences that really are drift`);

  const comparedConfig = d.comparedAgainstConfig === true;
  const unmanaged = Array.isArray(d.unmanaged) ? d.unmanaged.filter(nonEmptyStr) : [];
  const rootNames = new Set(
    (Array.isArray(profile?.workspace?.roots) ? profile.workspace.roots : [])
      .map((r) => r?.name).filter(nonEmptyStr),
  );

  list.forEach((c, i) => {
    const at = `drift.changes[${i}]`;
    if (!isObj(c)) return err(at, "must be an object");
    enumField(c, "kind", DRIFT_CHANGE_KINDS, at);
    enumField(c, "source", DRIFT_SOURCES, at);
    enumField(c, "action", DRIFT_ACTIONS, at);
    if (!nonEmptyStr(c.surface))
      err(at, "missing `surface` — name the thing the way config names it (`repos[].api…verify.steps.test`); drift a reader cannot locate is a rumour");

    // THE rule: a human's deliberate edit is reported, never proposed for overwrite.
    if (c.source === "human-edit" && c.action !== "leave-alone")
      err(at, `source=human-edit with action=${JSON.stringify(c.action)} — a value somebody changed by hand after adoption carries intent the scan cannot see. It must be \`leave-alone\`: a diff that reverts a deliberate edit is indistinguishable from routine convergence in review`);

    // Code drift needs a citation, exactly as every other derived claim does.
    if (c.source === "code") checkEvidence(c.evidence, at);
    else if (c.evidence !== undefined) checkEvidence(c.evidence, at);

    // Classifying a difference as config-side or hand-authored requires having read the config.
    if (!comparedConfig && (c.source === "config" || c.source === "human-edit"))
      err(at, `source=${c.source} while drift.comparedAgainstConfig is not true — the config was never read, so this difference cannot be attributed to it. Record it as \`unknown\` and say the config was unreadable`);

    if (c.was !== undefined && c.now !== undefined && JSON.stringify(c.was) === JSON.stringify(c.now))
      err(at, "`was` equals `now` — that is not drift, and a no-op entry inflates the section until nobody reads it");

    // An unmanaged surface is reported once, never re-proposed. That is what makes a pilot quiet.
    const touchesUnmanaged = unmanaged.some((u) => u === c.root || u === c.package || u === c.surface ||
      (nonEmptyStr(c.surface) && c.surface.includes(u)));
    if (touchesUnmanaged && c.action === "propose")
      err(at, `proposes a change to \`${c.surface}\`, which adoption.unmanaged deliberately excludes — an unmanaged surface is reported once as unmanaged, not re-proposed every scan; that difference is what separates "not adopted" from "missed"`);

    if (nonEmptyStr(c.root) && rootNames.size && c.kind !== "root-removed" && !rootNames.has(c.root))
      err(`${at}.root`, `\`${c.root}\` is not a declared root in this profile`);
  });
}

function validate(p, profileText) {
  // ---- version ----
  if (p.profileVersion !== 1)
    err("profileVersion", `is ${JSON.stringify(p.profileVersion)} — this validator knows version 1 only`);

  // ---- scan ----
  const s = p.scan;
  if (!isObj(s)) {
    err("scan", "missing — a profile with no provenance cannot be compared against a later one");
  } else {
    if (!nonEmptyStr(s.scannedAt) || Number.isNaN(Date.parse(s.scannedAt)))
      err("scan.scannedAt", "missing or not an ISO-8601 timestamp");
    enumField(s, "depth", DEPTHS, "scan");
    if (s.commit !== undefined) checkFact(s.commit, "scan.commit");

    const cp = s.controlPlane;
    if (!isObj(cp)) err("scan.controlPlane", "missing");
    else {
      if (!isAbsolute(cp.path)) err("scan.controlPlane.path", "must be an absolute path");
      enumField(cp, "resolvedFrom", RESOLVED_FROM, "scan.controlPlane");
      checkEvidence(cp.evidence, "scan.controlPlane");
    }

    const b = s.budget;
    if (!isObj(b)) err("scan.budget", "missing — the report must state what the scan cost");
    else {
      if (!Number.isInteger(b.filesInspected) || b.filesInspected < 0)
        err("scan.budget.filesInspected", "must be a non-negative integer");
      if (typeof b.durationSeconds !== "number" || b.durationSeconds < 0)
        err("scan.budget.durationSeconds", "must be a non-negative number");
      if (isObj(b.caps) && b.caps.hitCap === true && !Array.isArray(s.skipped))
        err("scan.skipped", "a cap was hit but nothing is recorded as skipped — say what was left unread");
    }

    if (s.skipped !== undefined) {
      if (!Array.isArray(s.skipped)) err("scan.skipped", "must be an array");
      else s.skipped.forEach((k, i) => {
        const at = `scan.skipped[${i}]`;
        if (!nonEmptyStr(k?.path)) err(at, "missing `path`");
        enumField(k ?? {}, "reason", SKIP_REASONS, at);
      });
    }

    if (isObj(s.sampling) && s.sampling.applied === true) {
      if (!nonEmptyStr(s.sampling.strategy))
        err("scan.sampling.strategy", "sampling was applied — the strategy must be stated");
      const c = s.sampling.coveragePercent;
      if (typeof c !== "number" || c < 0 || c > 100)
        err("scan.sampling.coveragePercent", "sampling was applied — coverage must be a number 0–100");
    }

    // The read-only guarantee, mechanically.
    const w = s.writes;
    if (!isObj(w) || !Array.isArray(w.paths)) {
      err("scan.writes.paths", "missing — the read-only claim must be recorded, not assumed");
    } else {
      for (const path of w.paths) {
        const norm = String(path).replace(/\\/g, "/");
        if (!norm.includes(".aidlc/adoption/"))
          err("scan.writes.paths", `\`${path}\` is outside .aidlc/adoption/ — adopt writes nothing else`);
      }
      if (w.sessionOnly === true && w.paths.length > 0)
        err("scan.writes", "sessionOnly=true but paths[] is non-empty — a session-only run persists nothing");
      if (w.sessionOnly !== true && w.paths.length === 0)
        err("scan.writes.paths", "empty without sessionOnly=true — either files were written or the run was session-only");
    }

    if (isObj(s.network) && s.network.sourceTransmitted !== undefined && s.network.sourceTransmitted !== false)
      err("scan.network.sourceTransmitted", "must be false — no source leaves the machine");
  }

  // ---- workspace ----
  const ws = p.workspace;
  if (!isObj(ws)) {
    err("workspace", "missing");
  } else {
    checkFact(ws.shape, "workspace.shape", { valueEnum: SHAPES });
    if (ws.codeWorkspaceFile !== undefined) checkFact(ws.codeWorkspaceFile, "workspace.codeWorkspaceFile");
    checkFact(ws.topology, "workspace.topology", { valueEnum: TOPOLOGIES });

    if (!Array.isArray(ws.roots) || ws.roots.length === 0) {
      err("workspace.roots", "must be a non-empty array — a scan that found no root profiled nothing");
    } else {
      const names = new Set();
      ws.roots.forEach((r, i) => {
        const at = `workspace.roots[${i}]`;
        if (!isObj(r)) return err(at, "must be an object");
        if (!nonEmptyStr(r.name)) err(at, "missing `name`");
        else if (names.has(r.name)) err(at, `duplicate root name \`${r.name}\` — names route work items`);
        else names.add(r.name);
        if (!nonEmptyStr(r.path)) err(at, "missing `path`");
        if (!isAbsolute(r.absolutePath))
          err(`${at}.absolutePath`, "must be absolute — it is the authoritative locator for a root that may sit on another drive or a UNC share");
        if (r.nestedUnderControlPlane !== undefined && typeof r.nestedUnderControlPlane !== "boolean")
          err(`${at}.nestedUnderControlPlane`, "must be a boolean");
        if (r.declaredBy !== undefined) enumField(r, "declaredBy", DECLARED_BY, at);
        if (r.docs !== undefined) {
          if (!Array.isArray(r.docs)) err(`${at}.docs`, "must be an array");
          else r.docs.forEach((d, j) => {
            const dat = `${at}.docs[${j}]`;
            if (!nonEmptyStr(d?.location)) err(dat, "missing `location`");
            enumField(d ?? {}, "kind", DOC_KINDS, dat);
          });
        }

        checkFact(r.classification, `${at}.classification`, { valueEnum: CLASSIFICATIONS });

        if (!isObj(r.reachable) || typeof r.reachable.value !== "boolean") {
          err(`${at}.reachable`, "missing — a root that was never proven readable must not be reported as profiled");
        } else if (r.reachable.value === false && !nonEmptyStr(r.reachable.remedy)) {
          err(`${at}.reachable.remedy`, "unreachable root must name its exact remedy (e.g. --add-dir \"<abs path>\")");
        }

        if (isObj(r.trust)) {
          if (r.trust.trusted !== undefined) checkFact(r.trust.trusted, `${at}.trust.trusted`);
          if (r.trust.pluginEnabled !== undefined) checkFact(r.trust.pluginEnabled, `${at}.trust.pluginEnabled`);
        }

        if (isObj(r.vcs)) {
          for (const [k, v] of Object.entries(r.vcs)) {
            if (k === "support") enumField(r.vcs, "support", SUPPORTS, `${at}.vcs`);
            else if (v !== undefined) checkFact(v, `${at}.vcs.${k}`);
          }
        }

        if (r.enclosingRepo !== undefined) {
          checkFact(r.enclosingRepo, `${at}.enclosingRepo`);
          // A root inside someone else's repo is not itself a git repo. Claiming both means the
          // VCS facts were read from the ancestor — the confidently-wrong profile this guards.
          if (r.enclosingRepo.status === "known" && r.vcs?.system?.status === "known" && r.vcs.system.value === "git")
            err(`${at}.vcs.system`, "is `git` while `enclosingRepo` is set — a root inside another repo is not its own repo root; these VCS facts describe the ancestor");
        }

        for (const key of ["languages", "packageManagers", "frameworks", "ci", "hooks", "migrationTools", "containers"]) {
          const arr = r[key];
          if (arr === undefined) continue;
          if (!Array.isArray(arr)) err(`${at}.${key}`, "must be an array");
          else arr.forEach((d, j) => checkDetected(d, `${at}.${key}[${j}]`));
        }

        if (isObj(r.entryPoints))
          for (const [k, v] of Object.entries(r.entryPoints))
            if (v !== undefined) checkCommandFact(v, `${at}.entryPoints.${k}`);

        if (r.workspaceTooling !== undefined) checkFact(r.workspaceTooling, `${at}.workspaceTooling`);

        if (r.gates !== undefined) {
          if (!Array.isArray(r.gates)) err(`${at}.gates`, "must be an array — and its ORDER is the execution order");
          else {
            const seenGates = new Set();
            r.gates.forEach((g, j) => checkGate(g, `${at}.gates[${j}]`, seenGates));
          }
        }
        if (r.conventions !== undefined) checkConventions(r.conventions, `${at}.conventions`, r);

        if (r.packages !== undefined) checkPackages(r.packages, `${at}.packages`, r);
        if (r.classification?.value === "monorepo" && !(Array.isArray(r.packages) && r.packages.length))
          warn(`${at}.packages`, "root is classified monorepo but lists no packages — expected at a depth above quick");
        if (r.releaseTooling !== undefined) checkFact(r.releaseTooling, `${at}.releaseTooling`);
        if (r.saas !== undefined) checkSaas(r.saas, `${at}.saas`);

        if (isObj(r.coverage) && r.coverage.sampled === true) {
          const c = r.coverage.coveragePercent;
          if (typeof c !== "number" || c < 0 || c > 100)
            err(`${at}.coverage.coveragePercent`, "root was sampled — coverage must be a number 0–100");
        }
      });
    }
  }

  // ---- surfaces + gaps: honest degradation ----
  const gapSurfaces = new Set(
    (Array.isArray(p.gaps) ? p.gaps : []).map((g) => g?.surface).filter(nonEmptyStr),
  );
  if (p.surfaces !== undefined) {
    if (!Array.isArray(p.surfaces)) err("surfaces", "must be an array");
    else p.surfaces.forEach((sf, i) => {
      const at = `surfaces[${i}]`;
      if (!isObj(sf)) return err(at, "must be an object");
      enumField(sf, "kind", SURFACE_KINDS, at);
      if (!nonEmptyStr(sf.detected)) err(at, "missing `detected`");
      enumField(sf, "support", SUPPORTS, at);
      if (!nonEmptyStr(sf.consequence))
        err(at, "missing `consequence` — a gap with no stated consequence reads as a footnote instead of a decision");
      if (sf.support === "unsupported" && !gapSurfaces.has(sf.detected) && !gapSurfaces.has(sf.kind))
        err(at, `support=unsupported but no gaps[] entry references it (\`${sf.detected}\` or \`${sf.kind}\`) — an unsupported surface must be recorded as a capability gap`);
      if (sf.evidence !== undefined) checkEvidence(sf.evidence, at);
    });
  }
  if (p.gaps !== undefined) {
    if (!Array.isArray(p.gaps)) err("gaps", "must be an array");
    else p.gaps.forEach((g, i) => {
      const at = `gaps[${i}]`;
      if (!nonEmptyStr(g?.name)) err(at, "missing `name`");
      enumField(g ?? {}, "kind", GAP_KINDS, at);
      if (!nonEmptyStr(g?.surface)) err(at, "missing `surface`");
      if (!nonEmptyStr(g?.why)) err(at, "missing `why`");
    });
  }

  // ---- retroactive ADR candidates ----
  if (p.adrCandidates !== undefined) checkAdrCandidates(p.adrCandidates, p);

  // ---- debt findings (the backlog seed) and drift (re-adoption) ----
  if (p.debtFindings !== undefined) checkDebtFindings(p.debtFindings, p);
  if (p.drift !== undefined) checkDrift(p.drift, p);
  else if (p.scan?.controlPlane?.alreadyAdopted === true)
    err("drift", "scan.controlPlane.alreadyAdopted is true but there is no `drift` block — a re-scan of an adopted workspace that reports no comparison leaves the reader to diff two large profiles by eye. An unchanged project produces a drift block with an empty changes[], which is the observable proof of idempotency, not the absence of the block");

  // ---- safety ----
  const sf = p.safety;
  if (isObj(sf)) {
    (sf.envFiles ?? []).forEach((e, i) => {
      const at = `safety.envFiles[${i}]`;
      if (!nonEmptyStr(e?.path)) err(at, "missing `path`");
      if (typeof e?.contentsRead !== "boolean") err(at, "missing `contentsRead`");
      if (e?.contentsRead !== true && e?.variableNames !== undefined)
        err(at, "variableNames present while contentsRead is not true — names may only be recorded from an approved read");
      if (e?.value !== undefined || e?.values !== undefined || e?.contents !== undefined)
        err(at, "carries env file content — only paths and (when approved) variable NAMES may be recorded");
    });
    (sf.secretFindings ?? []).forEach((f, i) => {
      const at = `safety.secretFindings[${i}]`;
      if (!nonEmptyStr(f?.location)) err(at, "missing `location`");
      if (!nonEmptyStr(f?.type)) err(at, "missing `type`");
      if (f?.redacted !== true) err(at, "`redacted` must be true — the value is never recorded");
      if (f?.value !== undefined || f?.secret !== undefined || f?.match !== undefined)
        err(at, "carries the secret value — record location and type only");
    });
    (sf.piiSuspects ?? []).forEach((f, i) => {
      const at = `safety.piiSuspects[${i}]`;
      if (!nonEmptyStr(f?.path)) err(at, "missing `path`");
      if (!nonEmptyStr(f?.signal)) err(at, "missing `signal`");
      if (f?.quotedInReport === true) err(at, "quotedInReport must be false — PII-suspect content is excluded from the report");
      if (f?.sample !== undefined || f?.rows !== undefined)
        err(at, "carries sample data — record the signal, never a row");
    });
  }

  // ---- the backstop ----
  scanForSecrets(profileText, "profile.json");
}

// ---- report checks (optional second arg) ----
const REQUIRED_REPORT_PHRASES = [
  ["not determined", "the section listing every unknown fact with its reason"],
  ["scan budget", "what the scan cost"],
  ["skipped", "the explicit list of what was not looked at"],
  ["supported", "the supported / partial / unsupported matrix"],
];

// Sections required only when the profile actually carries the block. A report that derived runtime
// constraints or ADR candidates and then never showed them leaves the human approving the apply step
// blind to the two findings that most change how their code must be written.
const CONDITIONAL_REPORT_PHRASES = [
  [
    (p) => (p?.workspace?.roots ?? []).some((r) => isObj(r?.saas)),
    "runtime constraints",
    "the section stating the SaaS constraints the agent briefs will carry (tenancy, flags, migrations, contracts)",
  ],
  [
    (p) => Array.isArray(p?.adrCandidates) && p.adrCandidates.length > 0,
    "no adr",
    "the section listing decisions the code embeds with no ADR recording them",
  ],
  [
    (p) => (p?.workspace?.roots ?? []).some((r) => Array.isArray(r?.packages) && r.packages.length > 0),
    "package",
    "the per-root package list — routing, gates and release all key off it",
  ],
  [
    (p) => Array.isArray(p?.debtFindings) && p.debtFindings.length > 0,
    "debt",
    "the section listing what the scan found that is WORK rather than a fact, and the /aidlc:adopt-backlog door for it",
  ],
  [
    (p) => isObj(p?.drift),
    "drift",
    "the re-adoption comparison — including when nothing moved, since \"no drift\" is the result a reader came for",
  ],
];

function validateReport(text, profile) {
  const lower = text.toLowerCase();
  for (const [phrase, why] of REQUIRED_REPORT_PHRASES)
    if (!lower.includes(phrase)) err("report.md", `missing "${phrase}" — ${why}`);
  for (const [applies, phrase, why] of CONDITIONAL_REPORT_PHRASES)
    if (applies(profile) && !lower.includes(phrase))
      err("report.md", `missing "${phrase}" — ${why}. The profile carries it, so the report must show it`);
  scanForSecrets(text, "report.md");
}

// ---- programmatic API (Phase 2 writes profiles; it should check them the same way) ----
// Returns {errors, warnings} — arrays of strings. Never throws on invalid content; a parse
// failure comes back as an error like any other violation.
export function validateProfileText(profileText, reportText) {
  errors = [];
  warnings = [];
  let parsed;
  try {
    parsed = JSON.parse(profileText);
  } catch (e) {
    return { errors: [`profile.json: not valid JSON: ${e.message}`], warnings: [] };
  }
  validate(parsed, profileText);
  if (reportText !== undefined) validateReport(reportText, parsed);
  return { errors: [...errors], warnings: [...warnings] };
}

// ---- CLI ----
const isMain =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const [profilePath, reportPath] = process.argv.slice(2);
  if (!profilePath) {
    console.error("usage: node validate-profile.mjs <profile.json> [report.md]");
    process.exit(2);
  }

  let profileText;
  try {
    profileText = readFileSync(profilePath, "utf8");
  } catch (e) {
    console.error(`cannot read ${profilePath}: ${e.message}`);
    process.exit(2);
  }

  let reportText;
  if (reportPath) {
    try {
      reportText = readFileSync(reportPath, "utf8");
    } catch (e) {
      console.error(`cannot read ${reportPath}: ${e.message}`);
      process.exit(2);
    }
  }

  const result = validateProfileText(profileText, reportText);
  for (const w of result.warnings) console.log(`warn  ${w}`);
  for (const e of result.errors) console.log(`ERROR ${e}`);
  console.log(
    result.errors.length
      ? `\n${result.errors.length} violation(s) — this profile does not satisfy the adoption contract.`
      : `\nprofile OK${result.warnings.length ? ` (${result.warnings.length} warning(s))` : ""}.`,
  );
  process.exit(result.errors.length ? 1 : 0);
}
