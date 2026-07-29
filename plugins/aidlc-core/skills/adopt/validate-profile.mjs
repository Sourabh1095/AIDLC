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

        if (r.packages !== undefined) {
          if (!Array.isArray(r.packages)) err(`${at}.packages`, "must be an array");
          else r.packages.forEach((pk, j) => {
            const pat = `${at}.packages[${j}]`;
            if (!nonEmptyStr(pk?.name)) err(pat, "missing `name`");
            if (!nonEmptyStr(pk?.path)) err(pat, "missing `path`");
            checkEvidence(pk?.evidence, pat);
          });
        }
        if (r.classification?.value === "monorepo" && !(Array.isArray(r.packages) && r.packages.length))
          warn(`${at}.packages`, "root is classified monorepo but lists no packages — expected at a depth above quick");

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

function validateReport(text) {
  const lower = text.toLowerCase();
  for (const [phrase, why] of REQUIRED_REPORT_PHRASES)
    if (!lower.includes(phrase)) err("report.md", `missing "${phrase}" — ${why}`);
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
  if (reportText !== undefined) validateReport(reportText);
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
