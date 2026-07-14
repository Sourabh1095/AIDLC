# SDLC Plugin — Dogfood Findings

**LIVING DOCUMENT.** Log plugin findings here as dogfooding proceeds, then design + implement them
together as a batch through the normal branch → version → merge flow. When a cycle's batch ships,
archive this file (e.g. `dogfood-findings-archive.md`) and reset it fresh for the next cycle.

**Severity:** 🔴 blocks/confuses a core flow · 🟠 friction/manual workaround · 🟡 polish.

> **Prior cycles:** Cycle 1 (**F1–F16**, Epic-1 scaffolding) shipped in marketplace **0.14.0** —
> full record in `dogfood-findings-archive.md`, per-finding change list in the CHANGELOG.

---

## Open findings (to implement at the end)

_(Numbering continues from Cycle 1's F1–F16 — see `dogfood-findings-archive.md`.)_

### F17 🟡 — Scaffold ships no `.gitattributes` (eol=lf) → Windows CRLF/LF churn + agents mis-diagnose line endings
**Symptom.** On AUTH-8420 the implementer logged a **CRLF finding that was wrong** — the files are LF —
costing a correction cycle. Separately, git emits `LF will be replaced by CRLF` on nearly every file
touch across these repos (and the plugin repo). There is no line-ending normalization anywhere.
**Root cause.** The stack-web tooling scaffold ships a hardened `.gitignore` (F14) but **no
`.gitattributes`**. On Windows, without `* text=auto eol=lf`, working-tree endings churn and agents
misattribute genuine-or-phantom format differences to line endings.
**Proposed modification.** Ship a `.gitattributes` (`* text=auto eol=lf` + sensible `-text` binary
rules) in `sdlc-stack-web/templates/tooling/` and add it to the repo-scaffold checklist (sibling of
F14). Optionally, a one-line agent note: verify LF vs CRLF via `git ls-files --eol` before ever logging
a line-ending finding.

### F18 🟡 — Scaffolded repos merged with a failing `prettier --check` (format not enforced repo-wide at scaffold)
**Symptom.** ~17 files from the AUTH-8416 scaffold fail `prettier --check` (genuinely unformatted — not
line-endings) yet were merged; the dirt surfaced only when a later story (AUTH-8420) ran format
repo-wide. The scaffold "merged never-clean."
**Root cause.** The scaffold didn't leave the repos format-clean, and/or the deterministic gate's
**format** step wasn't enforced **repo-wide** during scaffolding, so format-dirty files passed the
merge gate (no CI in local mode to catch it either).
**Proposed modification.** (a) Scaffold should run `prettier --write .` (or the gate should run
`prettier --check .` and block) so a freshly scaffolded repo is format-clean at first merge; (b) confirm
`init`/scaffold wires a `format:check` (prettier) into the enforced gate, not just eslint. **Verify at
implementation time** whether the shipped template files themselves are prettier-clean under the shipped
`.prettierrc.json`. (Project-side: the ~17 dirty files are a `prettier --write .` maintenance item, not
a plugin change.)

### F19 🟡 — Parent Feature/Epic isn't rolled up to in_progress when its first child story starts (drift left for `/sdlc:status` to reconcile)
**Symptom.** On the Authentication board, `/sdlc:status` ground-truth reconciliation flagged parents
8414 (Epic) and 8415 (Feature) as still `New` while their child stories were already in
progress/closed (AUTH-8420 done, 8425 ready). Between story-start and the next status run, the board
transiently misrepresents parent state.
**Root cause.** `/sdlc:run` transitions the **story** it runs but does not proactively transition the
parent Feature/Epic from a todo state → in_progress when the **first** child enters in_progress. The
drift is only caught later by **F15** ground-truth reconciliation in `/sdlc:status` (which correctly
detected and *proposed* the fix — the safety net works; this is its proactive complement, not a
replacement).
**Proposed modification.** When `/sdlc:run` moves a story to in_progress, if the parent is still in a
todo state, roll the parent up to in_progress via the adapter (respect `statusMap`; guard: only
todo→in_progress, only when no sibling is already in progress, never touch a parent already in a later
state). Keep F15 reconciliation as the backstop for mixed/edge cases. **Verify at implementation time**
against ADO's own parent-rollup config so the pipeline doesn't fight team-configured rollup rules. See
`skills/run/SKILL.md` (story-transition step) + `skills/work-items/SKILL.md` (transition op) and mirror
in `wi-ado`.

### F20 🟠 — ADO statusMap is flat, but working-state names are per-work-item-type (Epic = "In Progress", Story/Feature = "Development in Progress")
**Symptom.** Rolling Epic 8414 to in_progress via the config statusMap (`in_progress → "Development in
Progress"`) targeted a state that **doesn't exist for the Epic type** — Epics use "In Progress". It was
only handled by picking the nearest legal per-type state at runtime (and saving that to memory); the
`statusMap` in config is still wrong, and any future flat transition to an Epic hits the same wall.
**Root cause.** ADO state names are scoped **per work-item-type** (and per state *category*). `statusMap`
holds one state *name* per canonical status, so a name valid for Story/Feature ("Development in
Progress") is invalid for Epic. **F7** self-heal doesn't catch it because F7 only checks whether a state
exists **on the board at all** — not whether it's legal for *this item's type* — so a state that exists
for some types slips through. (Complements **F15**, which made *terminal* states per-type but left the
non-terminal working states flat.)
**Proposed modification.** Make `wi-ado` transitions **type-aware**: resolve a canonical status to the
target state via the item type's ADO **state category** (Proposed / InProgress / Resolved / Completed /
Removed) instead of a hardcoded global name; extend the F7/F15 self-heal to key on `(type → category →
real state name)`. Optionally, `/sdlc:init` should sample states **per type** when populating `statusMap`
(or emit a per-type map) so the Epic/Story divergence is captured up front. **Verify at implementation
time** via the ADO work-item-type states API (each state carries a `category`). See `skills/wi-ado/SKILL.md`
(transition + statusMap self-heal) and `skills/init/SKILL.md` (statusMap population).

### F21 🟡 — Stack-web scaffold ships no pre-commit hooks (husky/lint-staged) → local enforcement needs a manual hardening pass
**Symptom.** A whole hardening story (AUTH-8669) existed solely to add husky v9 + lint-staged to the six
freshly scaffolded repos. The scaffold ships tsconfig/eslint/prettier/`.gitignore`/`.editorconfig`/`.npmrc`
but **no git pre-commit hooks**, so mis-formatted/lint-broken code isn't caught locally until a later
story wires husky in.
**Root cause.** The `sdlc-stack-web/templates/tooling/` baseline enforces standards at the **CI/merge
gate** (and, per F18, ideally at scaffold) but installs nothing at **commit time**. Local enforcement is
absent by default. (Sibling to **F18**: F18 = repo-wide format at the *merge gate*; F21 = the *local
pre-commit* layer.)
**Proposed modification.** Ship an optional husky + lint-staged baseline in the tooling template (a
`prepare: husky` script + `.husky/pre-commit` running `lint-staged`, with a lint-staged config running
eslint --fix + prettier --write on staged files). Gate it behind an init prompt (some teams decline git
hooks) so it stays opinionated-but-optional. In poly, the shared-config repo can own a `lint-staged`
preset the others extend (exactly the pattern AUTH-8671 landed). **Verify at implementation time** that
husky v9's `prepare`-based install works under the shipped `.npmrc`/CI — and make `prepare` **CI-safe**
(`husky || true`, or skip when `CI` is set / no `.git`), since `prepare` runs on every `npm ci` and husky
exits **127** in a checked-out sibling or CI container that lacks it (observed on AUTH-8679).

### F22 🟠 — Remote-mode ADO: merging a PR doesn't auto-close the linked work item — every run needs a manual post-merge close + rollup
**Symptom.** After 8672–8676's PRs merged, **none** of the linked items transitioned — the agent closed
each via REST in a manual "post-merge cleanup," then hand-rolled the parents (8669→Closed, 8415→Closed,
8414 left In Progress). It **saved this to memory as a standing per-run step**, i.e. the plugin didn't
tell it — it rediscovered the behavior.
**Root cause.** In ADO, linking a work item to a PR does **not** transition it on merge unless branch
policy is configured to. The plugin's remote-mode `/sdlc:run` ends at "PR opened → item in_review"; the
DONE transition (+ parent rollup) has **no encoded post-merge trigger**, so it relies on an agent
noticing the merge. Left unhandled, items stay open silently.
**Proposed modification.** Encode a **post-merge close** step in the remote-mode run/close flow: on merge
detection, transition the linked item → done via the adapter and run the F19-style parent rollup.
Belt-and-suspenders: confirm `/sdlc:status` F15 reconciliation flags "PR merged but item still open" and
surfaces the close. Document in the run skill that ADO PR-merge is **not** auto-closing (unlike some
GitHub setups). See `skills/run/SKILL.md` (close phase) + `skills/status/SKILL.md` (reconciliation) +
`skills/wi-ado/SKILL.md`.

### F23 🟡 — Poly + remote: per-repo run files ride into `main` via the PR but can't be archived without a forbidden direct-to-main commit
**Symptom.** Each repo's `.sdlc/runs/<id>.md` was committed on its feature branch and rode into `main`
via the PR, but stayed in the active `runs/` dir (not `runs/archive/`). Archiving them now would mean
committing directly to `main` — which the git-workflow rule forbids — so they linger and show as
completed runs in `/sdlc:status`. Harmless, but it recurs every run. (The control-plane coordination
file archived fine — this is only the per-repo run files.)
**Root cause.** The run skill archives run files at close, but in remote+poly the close is relative to a
branch that's already merged; there's **no pre-merge archive step**, so archiving can only happen via a
forbidden post-merge `main` commit.
**Proposed modification.** Either (a) move the run file into `runs/archive/` **on the branch before the
PR is finalized**, so it rides into `main` already archived; or (b) keep per-repo run state **out of the
product repos entirely** — persist run files only in the control-plane `.sdlc/` (the coordination file
already archives correctly there) and don't commit per-repo run files into product `main`. (b) is cleaner
if run files are pure SDLC metadata. Decide at implementation. See `skills/run/SKILL.md` +
`skills/run-state/SKILL.md`.

### F24 🟠 — Remote mode implies PR-gated merges, but the plugin neither scaffolds a CI gate nor warns when none exists — repos operate silently ungated
**Symptom.** All six `bee-auth-*` repos ran on `git.mode: remote` yet had **no CI**, so AUTH-8669's six
PRs merged with the deterministic gate (lint/type/test/dependency-boundaries) having run **only locally
during each run** — never as a required PR check. The gap surfaced by luck (an agent aside *after* the
merges), not from any plugin warning.
**Root cause.** `/sdlc:init`/scaffold provisions the local tooling baseline and sets `git.mode: remote`
per repo, but nothing links "remote mode" to "an enforced PR gate must exist." No CI template ships, and
neither `init` nor `/sdlc:status` flags a remote repo that has no CI / no required-check branch policy.
Remote mode's core promise — CI enforces the gate before a human merges — is silently unmet.
**Proposed modification.** Graduated; do at least the first:
- **Minimum (cheap, high-value):** `/sdlc:init` and `/sdlc:status` **warn** when a `mode: remote` repo
  has no detectable CI / required PR-check policy — "remote PRs will merge ungated until a CI gate lands."
- **Better:** ship a CI template in `sdlc-stack-web` (`templates/ci/azure-pipelines.yml` + a GitHub
  Actions sibling) running the **same** deterministic gate the local run uses, and have `init` offer to
  scaffold it per remote repo (like the tooling baseline), wired to the existing `ci-cd` skill.
- Org-level bits (service connection, agent pool, actually *setting* branch policy — needs permissions)
  may legitimately stay a tracked devops task, but the plugin should get ~90% there and **never leave it
  silent**.
See `skills/init/SKILL.md`, `skills/status/SKILL.md`, `skills/ci-cd/SKILL.md`, and `sdlc-stack-web`.

### F25 🟠 — ci-cd defaults to Microsoft-hosted `vmImage` with no warning that new ADO orgs lack the parallelism grant (pipelines silently can't run)
**Symptom.** On this org the Microsoft-hosted pool was offline (`resourceLimit: null` — new-org grant
unrequested), so **every `vmImage` pipeline couldn't run at all**; it was saved only by a pre-existing
self-hosted agent (1 concurrent job org-wide). Separately, a brand-new pipeline can stall on
`Checkpoint.Authorization` — sometimes a benign ~2.5-min first-run wait, but on 8679 it **hung until a
missing `pipelinePermissions` grant was added at the _queue_ id (774), not the pool id (19)** — distinct
from the repository grant. "Wait it out" is wrong advice when it's actually a missing queue authorization.
**Root cause.** `skills/ci-cd/SKILL.md` recommends `vmImage: ubuntu-latest` (Microsoft-hosted) and says
nothing about: (a) new Azure DevOps orgs get **no free hosted-parallelism grant** by default (must
request via https://aka.ms/azpipelines-parallelism-request, ~2–3 business days); (b) the self-hosted
`pool:` fallback; (c) the normal first-run authorization stall. An agent authoring CI on a fresh org
produces pipelines that silently never run.
**Proposed modification.** In `ci-cd`: (a) when targeting Azure Pipelines, **check/warn** on hosted
parallelism (`resourceLimit`) and surface the request link; (b) support a self-hosted `pool:` parameter
in the template and document hosted-vs-self-hosted choice; (c) document `Checkpoint.Authorization`:
**first authorize the pipeline at the queue id** (`pipelinePermissions/queue/<id>`, distinct from the
pool id and the repo grant) — only then treat a residual ~2.5-min stall as benign. Tie to **F24** (the
proposed CI template should carry the pool choice).

### F26 🟠 — Shipped dependency-cruiser base profiles omit `enhancedResolveOptions` → false-positive on `exports` subpath maps
**Symptom.** The shipped depcruise profiles false-positived on ESM `exports`-map subpaths; the analyst
had to add `enhancedResolveOptions: { exportsFields: ["exports"], conditionNames: ["import"] }` centrally.
This bites the **poly shared-package pattern the plugin itself promotes** (consumers importing e.g.
`@beelogical/dev-config/lint-staged` via an `exports` subpath).
**Root cause.** All three shipped configs (`.dependency-cruiser.{nestjs,next-app,rtk-spa}.cjs`) set
`doNotFollow`/`tsConfig`/`includeOnly` but **no `enhancedResolveOptions`** (verified — the option string
appears nowhere in `plugins/`), so dependency-cruiser's enhanced-resolve can't follow `exports`-map
subpaths and flags them as unresolvable/violations.
**Proposed modification.** Add `options.enhancedResolveOptions: { exportsFields: ["exports"],
conditionNames: ["import","require"] }` (plus `mainFields` if needed) to all three shipped profiles.
**Verify at implementation** against a package that uses an `exports` map. See
`sdlc-stack-web/templates/structure/dependency-cruiser/`.

### F27 🟠 — Shipped eslint config can't lint `.cjs` files in an ESM package — and the plugin's own `.cjs` configs would fail it
**Symptom.** `.cjs` files fail the shipped eslint baseline: `no-undef` on `module`/`require`/`exports`/
`__dirname`, and `@typescript-eslint/no-require-imports` on `require()`. The analyst had to add CommonJS
globals + a require-rule exception for `**/*.cjs`. **Self-inconsistency:** the plugin ships
`.dependency-cruiser.*.cjs` files (CommonJS `module.exports`) that would fail its own shipped baseline.
**Root cause.** `templates/tooling/eslint.config.mjs`'s config-files block (`files:
["**/*.{js,cjs,mjs}"]`) only applies `disableTypeChecked`. That drops *type-aware* rules but leaves (a)
`no-undef` from `js.configs.recommended` firing on CommonJS globals (no Node globals declared), and (b)
`@typescript-eslint/no-require-imports` (non-type-aware → not disabled) firing on `require()`.
**Proposed modification.** Split the override: for `**/*.cjs`, set `languageOptions: { sourceType:
"commonjs", globals: { ...globals.node } }` (add the `globals` devDep, or inline `module`/`require`/
`__dirname`/`process` as readonly) and turn off `@typescript-eslint/no-require-imports` +
`@typescript-eslint/no-var-requires`; leave `.mjs`/`.js` as-is. **Verify** by linting the shipped
depcruise `.cjs` configs against the baseline — they must pass. See
`sdlc-stack-web/templates/tooling/eslint.config.mjs`.

### F28 🔴 — Poly shared-package dependency (`file:../sibling`) doesn't resolve in isolated CI, and the shared-repo pilot never exercises it (false-green pilot)
**Symptom.** All five consumers (8679–8683) consume the shared config via `file:../bee-auth-dev-config`
— an unpublished sibling-directory link. It resolves in the local multi-repo workspace, but **CI checks
out only one repo**, so the sibling is absent and every dev-config-sourced config (eslint, prettier,
tsconfig, lint-staged, depcruise) fails: `Cannot find package '@beelogical/dev-config'`. Blocks 8679–8683
→ therefore 8425. **Worse:** the 8678 pilot went green because dev-config validates *itself* via relative
imports — it **never exercises the `file:` dependency** the consumers rely on, so "pilot proven" was false
confidence for the fan-out.
**Root cause.** Two plugin-level gaps. (1) The plugin promotes a poly **shared-package** pattern (one
repo's package consumed by the others) but gives **no guidance and no CI scaffolding** for how a
cross-repo dependency resolves under isolated single-repo checkout — verified: `ci-cd` only ever describes
a single "that repo's checkout"; `project-structure` says nothing about `file:`/publish/shared
consumption; `work-items` models cross-repo *sequencing* (`dependsOn`) but not cross-repo *package*
dependency. The natural local-dev choice (`file:../`) silently can't survive CI. (2) The poly **"pilot the
shared repo first, then fan out"** guidance has a blind spot: piloting the *dependency* repo doesn't cover
the *consumers'* resolution path, so it green-lights a broken pattern.
**Proposed modification.** (a) **Consumption guidance** in `project-structure`/`ci-cd`: in poly+remote a
cross-repo dependency must be either **published** (private registry / Azure Artifacts — matches the
config's stated "published @beelogical/dev-config" intent) **or** resolved via **multi-repo checkout**
(`resources.repositories` + a second `checkout:`); flag that unpublished `file:` sibling links are
**local-only** and fail isolated CI. (b) The CI template (F24/F25) should support a **multi-repo-checkout
parameter** as a first-class option — and note it must **`npm ci` the checked-out sibling** (its exported
configs need their own deps) and guard `prepare` (see F21). **Scope limit (from web/admin):** multi-checkout
is workable for a *leaf* config dep (api/sdk-nest/sdk-next, dev-config only), but degrades badly with
**transitive/built** cross-repo deps — web/admin consume dev-config *and* a **built** sdk-next, needing two
sibling checkouts + building sdk-next for type-check; there **publishing is effectively required**, not
optional. (c) **Pilot-guidance fix** in `run`/`sprint`: when the piloted repo
is a *shared dependency*, "proven" requires validating **at least one true consumer's** CI before
declaring the pattern ready to fan out — the dependency repo's own green is necessary but not sufficient.
See `skills/ci-cd/SKILL.md`, `sdlc-stack-web/skills/project-structure/SKILL.md`, `skills/run/SKILL.md`
(poly pilot).

### F29 🟠 — Lockfile generated on the scaffolding OS (Windows) fails `npm ci` on Linux CI
**Symptom.** api's `package-lock.json` (generated on Windows at scaffold) pinned `@emnapi/core@1.10.0`
nested; Linux `npm ci` needs `1.11.2` top-level → CI failed until the lock was regenerated in a `node:22`
Docker container. Will recur on every repo (dev is Windows, CI is Linux).
**Root cause.** `/sdlc:init`/scaffold installs devDeps and commits the resulting `package-lock.json` **on
the developer's OS**. npm resolves platform-specific optional deps (`@emnapi/*`, esbuild/swc/rollup
natives) per OS/arch, so a Windows-generated lock can be unsatisfiable by Linux `npm ci` (exact-lock, no
resolution).
**Proposed modification.** Generate/refresh the committed lockfile in a **Linux context** (the image CI
uses — e.g. `node:22` Docker) so `npm ci` is reproducible on the CI OS; or document this as a required
step when scaffolding on Windows/macOS for Linux CI. Optionally the gate runs `npm ci` early and fails
loud with this hint. See `skills/init/SKILL.md` + `skills/ci-cd/SKILL.md`.

### F30 🟠 — Plugin adds `dependency-cruiser` with no version floor → a `<17` install silently no-ops on `.ts` (false-green boundary gate)
**Symptom.** The terminal had to pin `dependency-cruiser@17.4.3` because **16.x silently no-ops on `.ts`**
— it runs, reports zero violations, gate passes **green while enforcing nothing**. This is the exact
"looks enforced but isn't" failure the plugin warns about elsewhere (project-structure §"silently inert").
**Root cause.** `init`, `project-structure`, and `nestjs` all say to add **`dependency-cruiser`** to
devDeps with **no version constraint** (verified — bare package name everywhere), so resolution can land a
`<17` that doesn't analyze TypeScript and defeats the gate silently.
**Proposed modification.** Pin a floor everywhere the plugin adds it — `dependency-cruiser@^17` (or the
tested exact version) — and state *why* (TS analysis). Belt-and-suspenders: the `ci-cd` gate should assert
a **non-empty module graph** (fail if depcruise analyzed 0 `.ts` files) so a future silent no-op can't
pass. See `skills/init/SKILL.md`, `sdlc-stack-web/skills/project-structure/SKILL.md` + `nestjs`,
`skills/ci-cd/SKILL.md`.

### F31 🟡 — No guidance to reproduce CI locally in the CI container → agents burn slow serial remote cycles
**Symptom.** Getting api's consumer gate green took **four cascading fixes discovered one-at-a-time**,
each costing a full slow serial CI cycle (single self-hosted agent, remote). The agent only sped up after
switching to **reproducing the CI checkout/sibling layout in a local `node:22` Docker container** —
validating the final fix green *before* touching CI.
**Root cause.** Neither `ci-cd` (failure diagnosis) nor `debugging` tells an agent to reproduce a CI
failure **in the CI image** (`docker run` the CI runtime, replicate the isolated single-repo checkout +
`npm ci` layout). So the default loop is push → wait for remote CI → read log → repeat — punishing when
serialized on one runner.
**Proposed modification.** Add to `ci-cd`/`debugging`: when a CI failure doesn't reproduce in the normal
workspace, **reproduce it in the CI container image** with the same checkout/install layout — especially
for poly isolated-checkout + `file:` sibling issues and cross-platform lock issues (ties to F28/F29).
Prescribe this *before* iterating through remote CI. See `skills/ci-cd/SKILL.md`, `skills/debugging/SKILL.md`.

### F32 🟠 — Doc-verifying subagents (architect/researcher/security) aren't granted the bundled Context7 MCP → they fall back to WebSearch/registry
**Symptom.** On 8425 the architect couldn't call Context7 inside the subagent and verified `oidc-provider`
versions via npm registry + upstream docs instead — reported as a "harness rough edge." It's actually a
plugin tool-grant gap.
**Root cause.** The plugin **bundles Context7** as an MCP specifically for library/API/version doc
verification, and its own guidance leans on it — but the agents whose job *is* that verification don't
list the Context7 tools: verified `agents/sdlc-architect.md` grants only `Read/Grep/Glob/Bash/WebSearch`;
`sdlc-researcher` (tech selection) and `sdlc-security` (dependency audit) are likewise Context7-less (no
`mcp__…context7…` tools; the architect also lacks `WebFetch`). So the bundled MCP is effectively usable
only from the main thread, and every subagent doc-check degrades to WebSearch/registry.
**Proposed modification.** Add the bundled Context7 tools (`…context7…query-docs` / `resolve-library-id`)
to the tool grants of `sdlc-architect`, `sdlc-researcher`, and `sdlc-security` (and `WebFetch` to the
architect so it can read a cited page). Confirm subagents can resolve the plugin-scoped MCP tool name at
runtime; if the harness genuinely can't pass MCP tools to subagents, **document** that limitation and
sanction the WebSearch/registry fallback explicitly. See `agents/sdlc-architect.md`,
`agents/sdlc-researcher.md`, `agents/sdlc-security.md`.

### F33 🟡 — Web-stack testing guidance is silent on ESM-only deps consumed via `import()` (jest needs `--experimental-vm-modules`)
**Symptom.** 8426 consumes ESM-only `oidc-provider` from a CommonJS repo via the `nest-oidc-provider`
`import()` wrapper (the plugin-endorsed interop, ADR 0002). Jest couldn't execute the wrapper's dynamic
ESM import until the implementer added `--experimental-vm-modules` (and the e2e file had to be named to
match the repo's `testRegex`).
**Root cause.** The plugin endorses "keep the repo CommonJS, consume ESM-only deps via `import()`" but its
testing/nestjs guidance says nothing about the jest consequence (verified — no `experimental-vm-modules`/
ESM mention anywhere in `sdlc-stack-web/skills`). ESM-only libraries are increasingly common, so any
web-stack repo consuming one hits this silently.
**Proposed modification.** Add a short note to `sdlc-stack-web/skills/nestjs` (and/or testing guidance):
when a CJS repo consumes an ESM-only dep via `import()`, jest needs `NODE_OPTIONS=--experimental-vm-modules`
(or equivalent config) to run the dynamic import in tests. Optionally the recommended Nest jest config sets
it. See `sdlc-stack-web/skills/nestjs/SKILL.md`.

## Validated — working as designed (no change needed)

- ✅ **Economical cadence held on a real feature story (AUTH-8420, size L):** the per-epic **security**
  pass was correctly **deferred** (owed at Feature 8415 / Epic 8414 close), not skipped — cadence
  working as designed; the deterministic gate independently re-verified green (type-check/lint/test
  9/9) and 7 assumptions were logged. First non-scaffold story delivered through the pipeline.
- ✅ **Poly predecessor-link gating held (AUTH-8669 pilot):** the pipeline **paused fan-out** to the 5
  consumer repos before the shared-config pilot (8671 / PR #1754) merged, and surfaced it for review —
  the exact merge-ordering hazard flagged as a "watch" for F19's neighbor **did not materialize**. The
  cross-repo dependency (dev-config → 5 consumers) was modeled correctly.
- ✅ **Re-decompose + supersede on a real cross-repo story (AUTH-8669):** split into 6 per-repo tasks,
  superseded the 2 per-concern tasks (Close + AC-coverage comment, since Tasks have no Removed state),
  all original ACs mapped — F15 machinery working end-to-end.
- ✅ **Rollup-on-close correct + doesn't over-close (AUTH-8669 close):** story closed when all 6 children
  done; Feature 8415 rolled up to Closed (8416 + 8420 + 8669 all done); **Epic 8414 correctly left In
  Progress** (Features 8424/8432/8440 remain) — F15 close-time reconciliation rolled up the finished
  parent without force-closing the still-open Epic.
- ✅ **F20 per-type-state workaround holding:** the Epic's working state rendered as "In Progress" (the
  legal per-type state), not the flat-map "Development in Progress" — the nearest-legal-per-type pick is
  stable. (Underlying flat-statusMap bug still tracked as F20 for the real fix.)
- ✅ **CI/devops path stood up a REAL blocking gate on a live ADO org (AUTH-8678):** pipeline def +
  `blocking=true` branch policy on `refs/heads/main`, proven **red→green pre-merge** (run 779 rejected →
  merge blocked; run 780 approved → unblocked). The `sdlc-devops` + `ci-cd` capability works end-to-end —
  **F24's remediation approach is viable**; F25/F26/F27 are the rough edges to smooth, not blockers. Bonus:
  the `typecheck`/`type-check` naming heads-up was heeded (no `typecheck` left in the tree).
- ✅ **"Lead with api first" caught the blast radius early + the pipeline stopped clean (AUTH-8679):**
  running one true consumer before fan-out surfaced three consumer-wide gotchas (queue auth, cross-platform
  lockfile, depcruise version) **and** the `file:` blocker (F28) **before** they hit the other four — and
  the pipeline **halted at the blocker rather than thrash or silently re-architect the merged template**,
  leaving 8680–8683 untouched. The sequencing advice and the stop-and-flag behavior both worked. (The
  underlying issues are F28–F30 + the F25 correction.)
- ✅ **api consumer gate proven end-to-end on a REAL consumer (AUTH-8679):** 798 clean → 799 boundary
  violation → PR policy **rejected/blocking** → 800 green post-revert → **approved**. This is the
  true-consumer proof **F28(c)** demanded — the gate blocks a red *consumer* PR and unblocks on fix, not
  just the dev-config pilot. F24 remediation is now validated on a consumer.
- ✅ **Boundary gate shaped the design at design time (AUTH-8425):** the dependency-cruiser gate forced
  adding `users`/`applications` barrels + a real `ApplicationsModule` (was entity-only) so the OIDC module
  imports via barrels — the gate enforcing clean module boundaries *before* code is written, exactly as
  intended (project-structure).
- ✅ **Architect + ADRs + dependency vetting on the hardest item (AUTH-8425):** `architectThreshold` (M)
  correctly triggered the architect (opus) + three ADRs (0002 ESM interop / 0003 Redis+Postgres split /
  0004 JWKS rotation), grounded in repo + current upstream docs; the dependency policy caught the AC's
  **EOL `oidc-provider@v8`** (current v9.9.1) and recommended the latest-stable pin. Design cadence working
  as designed on the security-critical core. (The doc-check fell back off Context7 — that's F32.)
- ✅ **Checkpoint-after-8426 paid off + F31 technique self-adopted (AUTH-8426):** the risky ESM-interop
  foundation (ADR 0002) was proven working by e2e — discovery lists the right endpoints, `/oidc/jwks`
  exposes **public key material only**, `response_types` is `["code"]` (implicit/hybrid off), userinfo
  returns RFC 6750 errors, endpoints proxy-aware — **39/39 green in a node:22 CI-mirror container** before
  persistence/JWKS layered on. The Option-2 pacing recommendation validated; the F31 local-CI-container
  repro was adopted proactively (plugin default still owed).
- ✅ **Clean scope/AC-boundary flagging on a security slice (AUTH-8426):** the implementer surfaced the
  confidential-client data-model boundary (one-way `clientSecretHash` → public/PKCE-only clients,
  `token_endpoint_auth_method: none`) and the issuer-from-`OIDC_ISSUER` nuance rather than silently faking
  either — assume-and-log / scope-flagging working exactly as intended.

## Append log

- 2026-07-12 — Cycle 2 opened. From AUTH-8420 (identity schema, first non-scaffold story): logged
  **F17** (missing `.gitattributes`/eol → CRLF mis-diagnosis) and **F18** (scaffold merged
  prettier-dirty). Deferred per-epic security = working-as-designed (not a finding). Separately: the six
  `bee-auth-*` repos were pushed to Azure Repos and the workspace flipped to `git.mode: remote` — the
  remote/PR integration path is now first under test (watch the next `/sdlc:run` for remote-mode
  findings).
- 2026-07-12 — From an Authentication `/sdlc:status`: logged **F19** (parent Feature/Epic not rolled up
  to in_progress at first-child-start; drift caught only by F15 status reconciliation). F15 detecting +
  proposing the rollup = working-as-designed; F19 is the proactive complement. Unsized-backlog flag from
  the same status = `/sdlc:groom` working correctly, not a finding.
- 2026-07-13 — From the AUTH-8669 pilot (bee-auth-dev-config / PR #1754): logged **F20** (flat statusMap
  vs per-type ADO working-state names — Epic "In Progress" ≠ Story/Feature "Development in Progress";
  F7 self-heal isn't type-aware) and **F21** (scaffold ships no husky/lint-staged pre-commit layer;
  sibling to F18). Validated working-as-designed: poly predecessor-link gating paused fan-out before the
  pilot merged; re-decompose 8669 → 6 per-repo tasks + supersede 8667/8670 = F15 on a real story.
- 2026-07-13 — From AUTH-8669 full close (5 consumer PRs merged): logged **F22** (remote-mode ADO
  PR-merge doesn't auto-close linked items → manual post-merge close+rollup every run; agent had to save
  it to memory) and **F23** (poly+remote per-repo run files ride into `main` but can't be archived without
  a forbidden direct-to-main commit). Validated: F15 rollup-on-close closed 8669 + 8415 and correctly
  **left Epic 8414 open**; F20 per-type-state workaround held (Epic = "In Progress"). Candidate promoted
  to **F24** — reframed from the contestable "init must build CI" to its defensible core: remote mode
  operates *silently* ungated, so the plugin should at minimum warn (ideally ship a CI template); full
  branch-policy wiring may stay a tracked devops task.
- 2026-07-13 — From AUTH-8678 (CI foundation predecessor, PR #1760 — first ci-cd/devops run on this
  project): logged **F25** (hosted-parallelism/`vmImage` gotcha on new ADO orgs + first-run auth stall),
  **F26** (depcruise profiles miss `enhancedResolveOptions` → `exports`-map false positives), **F27**
  (eslint baseline can't lint `.cjs` — including the plugin's *own* shipped `.cjs` configs). All three
  verified against the shipped templates. Validated: devops/ci-cd stood up a real blocking branch policy,
  proven red→green pre-merge — **F24 remediation is viable**. Sequencing note reinforces **F24** (not a
  new finding): a bare `/sdlc:next` would grab P1 8425 before api's gate 8679 exists → ungated PR; the
  *terminal* reasoned that out — exactly the warning F24 says the *plugin* should surface.
- 2026-07-13 — From AUTH-8679 (api, first true consumer): logged **F28 🔴** (poly `file:../sibling`
  shared-config can't resolve in isolated CI + the shared-repo pilot never exercises it → false-green
  pilot), **F29** (Windows-generated lockfile fails Linux `npm ci`), **F30** (no `dependency-cruiser`
  version floor → `<17` false-green gate); **corrected F25** (the `Checkpoint.Authorization` stall was a
  real missing `pipelinePermissions` *queue* grant, not always benign). Validated: "lead with api" caught
  all four before fan-out and the pipeline stopped cleanly at the blocker (8680–8683 untouched). **Decision
  pending from user:** multi-repo checkout vs publish-to-Artifacts for shared-config consumption (F28).
- 2026-07-13 — From AUTH-8679 green (api consumer gate proven end-to-end). The four cascading fixes all map
  to logged findings — cross-platform lock (F29), queue-vs-pool auth (F25), `file:` isolated-CI (F28), and
  husky `prepare` 127 + sibling deps → **refined F21** (CI-safe `prepare`) + **refined F28** (multi-checkout
  must `npm ci` the sibling, and doesn't scale to transitive/built deps — web/admin need 2 siblings + build
  sdk-next). Logged **F31 🟡** (prescribe local CI-container repro before slow serial remote cycles — the
  agent's own process win). Validated: api gate blocks a red consumer PR / unblocks on fix (true-consumer
  proof for F28(c)). Decision pending: web/admin CI — defer to Artifacts 8713 vs push multi-repo vs pivot
  to Artifacts now.
- 2026-07-13 — From AUTH-8425 design phase (plan + ADRs 0002/0003/0004): logged **F32 🟠**
  (architect/researcher/security subagents lack the bundled Context7 tool grant → fall back to
  WebSearch/registry; verified in `agents/*.md`). Validated: boundary gate shaped the module design
  (barrels + `ApplicationsModule`); `architectThreshold` triggered architect + 3 ADRs on the
  security-critical core; dependency policy caught the AC's EOL `oidc-provider@v8` → recommend `^9`.
  Decision pending: confirm `^9` pin + build pacing (all-now vs checkpoint-after-8426).
- 2026-07-13 — From AUTH-8426 checkpoint (OIDC foundation slice, 39/39 green in a CI-mirror container):
  logged **F33 🟡** (web-stack testing guidance silent on ESM-only deps via `import()` → jest needs
  `--experimental-vm-modules`; verified absent in stack-web skills). Validated: checkpoint-after-8426
  proved the ESM-interop foundation (ADR 0002) before layering persistence/JWKS — Option-2 pacing paid off;
  F31 CI-mirror technique self-adopted; implementer flagged the confidential-client + issuer boundaries
  cleanly (assume-and-log). Decisions (user's call): approve + continue to 8427/8428; defer confidential
  clients to Feature 8440 (recommended).
- 2026-07-14 — **Cycle 2 batch F17–F33 designed + implemented together** (marketplace → **0.15.0**:
  `sdlc` 0.14.0→0.15.0, `sdlc-stack-web` 0.8.0→0.9.0, `sdlc-ux` unchanged). Per-finding change list in
  the CHANGELOG. New this cycle: `sdlc-stack-web/templates/ci/` (Azure + GitHub CI templates), a
  `.gitattributes` baseline (+ plugin-repo root), an optional husky/lint-staged layer, depcruise
  `enhancedResolveOptions` + `@^17` floor + non-empty-graph assertion, eslint `.cjs` support; ADO board
  fidelity (F19 parent rollup, F20 type-aware state-category transitions, F22 post-merge close, F23
  pre-merge run-file archiving); remote-mode CI warnings + F25/F28/F29/F31 in `ci-cd`; Context7 grants
  to architect/researcher/security. **Verified at implementation:** F27 proven load-bearing (old eslint
  errored `'module' is not defined`, fixed passes) and F26/F27 re-checked against a real
  dependency-cruiser@17.4.3 + eslint9 harness; F18 templates now `prettier --check`-clean; CI YAMLs
  parse. **Honest note (F26):** depcruise 17.4.3 defaults already resolve `exports` subpaths, so the
  option is a robustness/explicitness fix (needs the `>=17` floor), not a flip of a reproducible failure
  on current versions — comments/CHANGELOG say so. Ready for the branch → merge step (not yet committed).
