# /aidlc:adopt — 10 · Write the profile

Part of the adopt skill: this step, moved out so the skill fits in one read. Read it in full when the scan
reaches this step; every rule in `SKILL.md` (the five rules, the safety contract) still applies here.

Write `.aidlc/adoption/profile.json` with `profileVersion: 1` and `$schema` set to the published URL
above. This is the shape — every leaf fact is one of the three `fact` forms, and there is no fourth:

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/bee-logical/AIDLC/main/docs/adoption-profile.schema.json",
  "profileVersion": 1,
  "scan": {
    "scannedAt": "<UTC ISO-8601>", "aidlcVersion": "<plugin version>", "depth": "standard",
    "commit": { /* fact */ },
    "controlPlane": { "path": "<abs>", "resolvedFrom": "code-workspace-file|opened-folder|user",
                      "evidence": [ /* … */ ], "isWorkspaceRoot": true, "alreadyAdopted": false },
    "budget": { "filesInspected": 0, "directoriesInspected": 0, "durationSeconds": 0,
                "caps": { "maxFiles": 0, "maxFileBytes": 0, "maxDepth": 0, "hitCap": false } },
    "skipped": [ { "path": "…", "reason": "vendored|generated|build-output|gitignored|lfs-pointer|over-size|binary|unreadable|env-file|pii-suspect|out-of-scope|cap-reached", "note": "…" } ],
    "sampling": { "applied": false, "strategy": "…", "coveragePercent": 100 },
    "writes": { "paths": [".aidlc/adoption/profile.json", ".aidlc/adoption/report.md"], "sessionOnly": false },
    "network": { "sourceTransmitted": false, "hostApiCalls": [], "offline": false }
  },
  "workspace": {
    "shape":    { /* fact → "single-root" | "nested-multi-repo" | "multi-root" */ },
    "codeWorkspaceFile": { /* fact → abs path, or status "absent" */ },
    "topology": { /* fact → "single-app" | "monorepo" | "poly" | "unknown" — evidence NAMES the deciding signal */ },
    "roots": [ {
      "name": "…", "path": "<as declared>", "absolutePath": "<abs>",
      "nestedUnderControlPlane": true, "declaredBy": "code-workspace|folder-scan|config|user",
      "classification": { /* fact → product-repo|monorepo|control-plane|non-repo|reference-only|already-adopted|not-cloned|unknown */ },
      "reachable": { "value": true, "remedy": "…" },
      "trust": { "trusted": { /* fact */ }, "pluginEnabled": { /* fact */ }, "remedy": "…" },
      "vcs": { "system": { /* fact */ }, "support": "supported|partial|unsupported|unknown",
               "defaultBranch": {}, "currentBranch": {}, "remotes": {}, "upstream": {},
               "shallow": {}, "submodules": {}, "worktrees": {}, "lfs": {}, "sizeBytes": {} },
      "languages": [ /* detected */ ], "packageManagers": [], "frameworks": [],
      "ci": [], "hooks": [], "migrationTools": [], "containers": [],
      "entryPoints": { "install": {}, "build": {}, "dev": {}, "test": {}, "lint": {},
                       "typecheck": {}, "format": {}, "migrate": {} },
      "packages": [ { "name": "<as the package's own manifest declares it>", "path": "…", "role": "…",
                      "labels": [], "languages": [], "stack": { "frontend": null, "backend": null, "databases": [] },
                      "dependsOn": ["<sibling package name>"], "releasable": false,
                      "entryPoints": {}, "evidence": [] } ],
      "workspaceTooling": { /* fact — note if it is an affected-graph runner */ },
      "releaseTooling":   { /* fact → {tool, independentVersioning} — or absent */ },
      /* Every entry below is a `fact`. These are the VALUE shapes, which the skeleton has to spell
         out because this skill may not fetch the published schema — the enums especially, since a
         plausible spelling like "SOC 2" is a violation where `soc2` is the legal value. */
      "saas": {
        "tenancy":     { /* fact → "shared-schema" | "schema-per-tenant" | "database-per-tenant" | "single-tenant" | "not-multi-tenant" */ },
        "tenantKey":   { /* fact → "tenant_id" — the column or claim name itself */ },
        "tenantIsolationPaths": { /* fact → ["acme/tenancy/"] */ },
        "authPaths":   { /* fact → ["acme/accounts/"] */ },
        "billingPaths":{ /* fact → ["acme/billing/"] */ },
        "featureFlags":{ /* fact → {provider, paths[], required?} */ },
        "migrations":  { /* fact → {tool, directories[]} */ },
        "liveDataConstraint": { /* fact → "expand-contract" | "not-required" */ },
        "apiContracts":{ /* fact → [{path, kind: "openapi"|"graphql"|"proto"|"grpc"|"asyncapi"|"json-schema"|"wsdl", public}] */ },
        "environments":{ /* fact → [{name, kind?: "dev"|"test"|"staging"|"production"|"preview"|"other"}] */ },
        "deployStrategy": { /* fact → "rolling" | "blue-green" | "canary" | "recreate" | "release-train" | "manual" | "continuous" */ },
        "freezeWindows":  { /* fact → [{when, source}] — `source` because an unsourced freeze blocks an integration on a rumour */ },
        "compliance":  { /* fact → [{regime: "soc2"|"hipaa"|"gdpr"|"pci"|"iso27001"|"fedramp"|"other", signal}] — LOWERCASE slugs, not "SOC 2" */ },
        "messaging":   { /* fact → [{name, kind: "queue"|"broker"|"stream"|"scheduler"|"webhook", paths[]}] */ },
        "observability": { /* fact → [{name, paths[]}] */ },
        "integrations":  { /* fact → [{name, paths[], credentialShape?}] */ },
        "experimentation": { /* fact → [{name, paths[]}] */ },
        "securityReviewPathSeeds": [ /* union of the isolation/auth/billing/compliance paths above */ ]
      },
      "gates": [ { "name": "test", "status": "present|absent|not-applicable", "cmd": "<verbatim; forbidden unless present>",
                   "cwd": "…", "source": "package.json scripts.test", "required": true,
                   "scope": "repo|package|affected|changed-paths", "package": "…",
                   "timeoutMinutes": 20, "environmentDependent": true, "services": ["postgres"],
                   "providedByHook": "husky", "alsoInCi": true, "evidence": [], "confidence": "high" } ],
      "conventions": { "branchPattern": {}, "commitStyle": {}, "mergeStrategy": {},
                       "integrationBranch": {}, "longLivedBranches": {}, "hotfixRoute": {},
                       "codeowners": {}, "requiredReviewers": {}, "protectedBranches": {},
                       "pushAccess": {} },
      "agentConfigs": [ { "path": "…", "tool": "…", "humanAuthored": true } ],
      "docs": [ { "location": "…", "kind": "adr|rfc|design-doc|wiki|readme|other", "external": false } ],
      "coverage": { "filesInspected": 0, "sampled": false, "coveragePercent": 100 }
    } ]
  },
  "surfaces": [ { "kind": "stack|tracker|vcs|ci|migration-tool|container|hooks|ide|release-channel|other",
                  "detected": "…", "root": "…",
                  "support": "supported|partial|unsupported|unknown|not-present", "providedBy": "…",
                  "consequence": "<one line — required>", "evidence": [] } ],
  "gaps":     [ { "name": "…", "kind": "skill|agent|plugin|adapter|project-action", "surface": "…", "why": "…", "workaround": "…" } ],
  "debtFindings": [ { "kind": "absent-gate|untested-critical-path|eol-dependency|todo-cluster|unreviewed-sensitive-path|docs-drift|committed-secret|pii-in-fixtures|cross-platform-hazard|ungated-integration|other",
                      "title": "<the work as an OUTCOME>", "severity": "high|medium|low",
                      "root": "…", "package": "…", "gate": "<required iff kind=absent-gate>",
                      "paths": ["…"], "suggestedType": "story|task|bug|spike", "suggestedSize": "S|M|L|XL",
                      "sensitive": false, "trackerSafeTitle": "<required iff sensitive>",
                      "evidence": [], "confidence": "…", "note": "<what still needs confirming>"
                      /* NO fix/remedy/patch/diff/solution — state the debt, not the change */ } ],
  "drift": { /* re-adoption only */
    "baseline": { "kind": "previous-profile|config-only|none", "path": "…", "scannedAt": "…",
                  "commit": "…", "profileVersion": 1, "depth": "standard", "appliedAt": "…" },
    "depthChanged": false, "comparedAgainstConfig": true, "unmanaged": ["…"],
    "changes": [ { "kind": "root-added|root-removed|classification-changed|package-added|package-removed|gate-added|gate-removed|gate-changed|stack-changed|convention-changed|saas-changed|topology-changed|release-tooling-changed|surface-support-changed|adr-superseded|other",
                   "surface": "repos[].api…verify.steps.test", "root": "…",
                   "package": "…", "was": "…", "now": "…",
                   "source": "code|config|human-edit|scan-depth|unknown",
                   "action": "propose|report-only|leave-alone", "evidence": [], "note": "…" } ]
  },
  "adrCandidates": [ { "decisionKind": "framework|data-store|auth-model|tenancy-model|api-style|deployment-topology|messaging|migration-strategy|frontend-architecture|build-tooling|observability|other",
                       "title": "<the decision as a statement>",
                       "status": "propose|already-recorded", "existingAdr": "<required iff already-recorded>",
                       "reversibilityCost": "high|medium|low", "root": "…", "decidedAt": { /* fact */ },
                       "consequencesObserved": ["<observation, never judgement>"], "evidence": []
                       /* NO rationale/why/because/alternatives — the scan never saw the why */ } ],
  "safety": {
    "envFiles":       [ { "path": "…", "contentsRead": false, "gitTracked": false } ],
    "secretFindings": [ { "location": "path:line | history: <commit> <path>", "type": "…", "inHistory": false, "redacted": true } ],
    "piiSuspects":    [ { "path": "…", "signal": "<why — never a sample row>", "quotedInReport": false } ]
  }
}
```

The three `fact` forms, and nothing else:

```jsonc
{ "status": "known",   "value": <any>, "evidence": [ … ], "confidence": "high|medium|low" }
{ "status": "absent",  "evidence": [ { "kind": "absence", "note": "<what you searched, came back empty>" } ] }
{ "status": "unknown", "reason": "<why it could not be established>" }
```

`evidence[]` entries are `{kind: "path", path, line?, excerpt?}` · `{kind: "command", command, output}` ·
`{kind: "absence", note}` · `{kind: "user", note}`. A `commandFact`'s `value` is
`{cmd, cwd?, source, environmentDependent?}`. A `detected` entry (language, framework, CI, hook,
migration tool, container) is `{name, version?, paths[], evidence[], confidence, support?}`.

Then **prove the profile conforms — do not eyeball it.** This skill ships a validator beside it:

```
node "<this skill's directory>/validate-profile.mjs" .aidlc/adoption/profile.json .aidlc/adoption/report.md
```

It runs offline with no dependencies and exits non-zero with one line per violation. It enforces exactly
the rules that matter: the three legal fact forms (and that an `unknown` fact carries **no value** — the
guess this whole design exists to prevent), evidence on every `known` and `absent` fact, the payload each
evidence kind requires, `writes[]` never leaving `.aidlc/adoption/`, an unreachable root naming its
remedy, an unsupported surface naming its gap, redaction invariants on secret/PII findings, the required
report sections — and, as a backstop, that **no credential-shaped string appears anywhere in either
file**. It also enforces the rules that would otherwise fail invisibly: **no ADR candidate carries a
rationale** in any spelling, **every auth / tenant-isolation / billing path reaches
`securityReviewPathSeeds`**, a **multi-tenant root with migrations answers the expand/contract
question**, a **`sensitive` debt finding never carries the location** that a public tracker item would
publish, and **drift attributed to a human's edit is never proposed for overwrite** — plus that
candidates and findings are ranked and capped, and that a package's `dependsOn` resolves to siblings
with no cycle. A profile that does not pass is not a profile: fix it and re-run, and never
report a scan as complete over a failing validation. (If the validator is missing — an unusual install —
say so, and fall back to re-reading and `JSON.parse`ing the file, the F49 floor.)

Populate `scan.writes.paths` with the two files you wrote — and then verify the read-only claim instead
of asserting it: `git status --porcelain` at the control plane **and at every reachable root** (nested or
not) must show nothing but those two paths. If it shows anything else, say so in the report; do not
quietly move on.

Both files are meant to be **tracked**, and §9 depends on it: the profile is the baseline every later
drift scan compares against, so it needs history. Say so when you write it — an untracked profile
silently degrades the next re-adoption from a diff to a guess.

**Converge; do not churn.** Because the profile is a tracked baseline, rewriting it on every scan would
put a timestamp-only commit in front of the team each time and, worse, move the baseline the *next* scan
compares against. So compare what you are about to write against what is already there, **excluding the
inherently variable fields** (`scan.scannedAt`, `scan.budget.durationSeconds`, and `drift`, which merely
echoes this comparison) — **and excluding `scan.commit` when, and only when, the commits differ by
adoption artifacts alone:**

```
node "<this skill's directory>/converged.mjs" <existing profile.json> <candidate profile.json> [changed-paths-file]
```

where the changed-paths file is

```
git -C "<control plane>" diff --name-only <recorded scan.commit>..HEAD -- . ':(exclude).aidlc/adoption/'
```

That `scan.commit` carve-out is not a nicety — without it the profile can **never** converge, because
this section requires the profile be *tracked* and committing it is what moves HEAD. Scan at `A`, commit
the profile, HEAD is `B`; the next scan records `B`, so it rewrites; you commit that, HEAD is `C`; and so
on forever on a project that never changed. Each rewrite also moves the baseline the next scan compares
against, which is the precise failure this rule exists to prevent.

The carve-out is deliberately **evidence-based rather than blanket**. A project that really moved must
record the commit it was actually read at, so `scan.commit` is ignored only when the diff between the
recorded commit and HEAD touches nothing outside `.aidlc/adoption/`. When it is ignored, say so in one
line — *"the recorded commit is 3 behind HEAD, all of them adoption artifacts"* — so a reader is never
left wondering whether the profile is stale. When the paths are unknown, keep `scan.commit` in the
comparison: the conservative answer is to write.

Then, on the comparison itself:

- **Nothing else differs ⇒ write neither file.** Report *"no drift — this profile already describes the
  workspace at `<commit>`"*, and leave `git status` clean. The artifacts describe **state**, not events;
  a scan that found nothing new has nothing to record. This is the same rule `/aidlc:adopt-apply` §3.5
  applies to `appliedAt`, and it is what makes two consecutive runs produce a literally empty diff
  rather than an almost-empty one.
- **Something differs ⇒ write both**, with the drift section naming what moved.
