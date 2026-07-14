# Changelog

All notable changes to the Bee-Logical Claude SDLC marketplace.

## [0.15.0] — 2026-07-14

### Dogfood batch F17–F33 (Authentication / Identity Platform, Cycle 2)

Seventeen findings from continued dogfooding on the same polyrepo + Azure DevOps build, now first
exercising the **remote/PR** integration path (the six `bee-auth-*` repos flipped to `git.mode:
remote`) plus real CI, a shared-config poly pattern, and the first security-critical design phase.
Designed and implemented together. Versions: `sdlc` 0.14.0 → **0.15.0**, `sdlc-stack-web` 0.8.0 →
**0.9.0**, `sdlc-ux` unchanged (**0.3.0**), marketplace → **0.15.0**. Full record:
`docs/dogfood-findings.md`.

#### `sdlc-stack-web` — tooling baseline & templates

- **F17 — the tooling baseline now ships a `.gitattributes`** (`* text=auto eol=lf` + binary rules).
  Stops CRLF/LF churn on Windows checkouts and keeps a Windows dev byte-identical to a Linux CI runner,
  so Prettier's `endOfLine: lf` no longer misreports CRLF as a diff (the false "files are CRLF" finding
  that cost a correction cycle). Added to the tooling README, `init` Step 4.5, and the
  `project-structure` repo-scaffold checklist (sibling of F14). The plugin repo itself also gains a
  root `.gitattributes`. Agent note added (`debugging`, checklist): confirm with `git ls-files --eol`
  before ever logging a line-ending finding.
- **F18 — shipped templates are now Prettier-clean, and scaffolds start format-clean.** Reformatted the
  template code files that genuinely failed `prettier --check` (long comments/calls prettier wraps);
  `init` and the repo-scaffold checklist now run `prettier --write .` **repo-wide** at scaffold so a
  fresh repo passes its own `format` gate at first merge; the enforced gate is stated as
  `prettier --check .` (repo-wide, not just `src/`), and must include the format step, not only eslint.
- **F21 — optional husky v9 + lint-staged pre-commit layer.** New `templates/tooling/husky/pre-commit`
  + `lint-staged.config.mjs` (eslint `--fix` + prettier `--write` on staged files). Gated behind an
  `init` prompt (opinionated-but-optional). `prepare` documented **CI-safe** (`husky || true`) because
  bare `husky` exits **127** on `npm ci` in a CI container or a `file:../` sibling checkout that lacks
  it. Poly pattern documented: the shared-config repo owns the preset, the others re-export it.
- **F26 — the three dependency-cruiser profiles set `enhancedResolveOptions`** (`exportsFields` +
  `conditionNames: [import, require]` + `mainFields`) so ESM `exports`-map subpaths (the poly
  shared-config pattern, `@beelogical/dev-config/lint-staged`) resolve deterministically across
  versions/conditions. *Verified:* dependency-cruiser 17.4.3's defaults already resolve the common
  case, so this is a robustness/explicitness fix (requires the `>= 17` floor, F30), not a change that
  flips a reproducible failure on current versions — framed accordingly in the profile comments.
- **F27 — the eslint baseline can now lint `.cjs` in an ESM package.** Split the config-files override:
  `**/*.cjs` gets `sourceType: "commonjs"` + Node globals and the require-style rules off, so
  `module`/`require`/`__dirname` no longer trip `no-undef`/`no-require-imports`. *Verified* end-to-end:
  the plugin's own shipped `.dependency-cruiser.*.cjs` now pass the baseline (the old config errored
  `'module' is not defined`).
- **F28 (design-time) — `project-structure` documents cross-repo dependency consumption.** In
  poly+remote a shared package must be **published** (required for transitive/built deps) or resolved
  via **multi-repo checkout** (leaf config deps only); an unpublished `file:../sibling` link is
  local-only and fails isolated single-repo CI.
- **F30 (floor) — `dependency-cruiser` is pinned `@^17`** everywhere the plugin adds it
  (`project-structure`, `nestjs`, `init`), with the why: `< 17` silently no-ops on `.ts` and passes the
  gate green while enforcing nothing.
- **F33 — `nestjs` testing guidance covers ESM-only deps consumed via `import()`.** A CJS repo needs
  `NODE_OPTIONS=--experimental-vm-modules` (cross-platform via `cross-env`) for jest to execute the
  dynamic ESM import, plus the `testRegex`-match gotcha for new e2e files.

#### `sdlc-stack-web` — CI templates (new)

- **F24 (templates) — new `templates/ci/`**: `azure-pipelines.yml` + `github-actions-ci.yml` (+ README)
  running the **same** deterministic gate as the local run (typecheck → lint → format → boundaries →
  build → test). Parameterized for a **self-hosted pool** (F25), **cross-platform lockfile** guidance
  (F29), a **non-empty-graph assertion** (F30), and a commented **multi-repo-checkout** block (F28).

#### `sdlc` — board fidelity (ADO)

- **F19 — parents roll up to in_progress at first-child-start.** `run` §3 transitions a still-`todo`
  parent Feature/Epic → in_progress when its first child starts (guards: only todo→in_progress, never
  pull back a later state, one tier per run, respect tracker rollup automation). Documented in
  `work-items` → *Parent rollup*; the proactive complement to F15 close-time reconciliation.
- **F20 — ADO transitions are type-aware via state category.** `wi-ado` resolves a canonical status to
  the target state through the item type's ADO **state category** (Proposed/InProgress/Resolved/
  Completed/Removed) rather than a flat global name, fixing the Epic ("In Progress") vs Story/Feature
  ("Development in Progress") divergence; the F7/F15 self-heal now keys on `(type → category → real
  state name)`; `init` populates a **per-type** `statusMap` from the work-item-type states API.
- **F22 — remote-mode ADO gets an encoded post-merge close.** ADO does **not** auto-close a linked item
  on PR merge — so `status` post-merge cleanup transitions the item → done + type-aware parent rollup,
  the ground-truth reconciliation flags "**PR merged but item still open**", and `run` §10 + `wi-ado`
  document that the DONE transition is a required post-merge step, not rediscovered per run.
- **F23 — poly+remote per-repo run files archive on the branch pre-merge.** `run` §10 `git mv`s the
  completed per-repo run file into `runs/archive/` as the final branch commit so it rides into `main`
  **already archived** — avoiding the forbidden post-merge direct-to-`main` commit that left run files
  lingering as "active." `run-state` documents the mode/layout matrix; `status` surfaces
  done-but-awaiting-merge archived runs.

#### `sdlc` — remote mode, CI & shared-package poly

- **F24 (warn) — remote mode is never silently ungated.** `init` (Step 4.7) and `status` (Step 1.6)
  warn when a `mode: remote` repo has no detectable CI / required-check policy, and `init` offers to
  scaffold the matching CI template per remote repo — remote mode's promise (CI enforces the gate
  before merge) is otherwise silently unmet.
- **F25 — `ci-cd` documents the fresh-org Azure gotchas.** Hosted parallelism can be unavailable on a
  new org (`resourceLimit: null` → `vmImage` pipelines can't run) with the request link and a
  self-hosted `pool:` fallback; `Checkpoint.Authorization` may be a missing `pipelinePermissions` grant
  at the **queue** id (distinct from pool/repo) — not always a benign wait.
- **F28 (CI + pilot) — `ci-cd` documents cross-repo package resolution under isolated CI** (publish vs
  multi-repo-checkout; `file:` siblings are local-only) and `run` (poly pilot) requires validating **at
  least one true consumer's** CI before fanning a shared-dependency pattern out — the dependency repo's
  own green never exercises the consumers' resolution path (the false-green pilot).
- **F29 — cross-platform lockfile.** `ci-cd` diagnosis + `init` prescribe generating/refreshing the
  committed `package-lock.json` in the **Linux context CI uses** (a `node:22` container), since a
  Windows/macOS-generated lock can be unsatisfiable by Linux `npm ci` (platform-specific optional deps).
- **F30 (assertion) — the CI gate asserts a non-empty module graph** (fails if depcruise analyzed 0
  `.ts` files), so a future silent no-op can't pass green. Carried by both CI templates and documented
  in `ci-cd`.
- **F31 — reproduce CI failures in the CI image before iterating.** `ci-cd` + `debugging` prescribe
  `docker run`-ing the CI runtime with the isolated single-repo checkout + `npm ci` layout to validate
  a fix green **before** slow serial remote cycles — essential for poly `file:`-sibling (F28) and
  cross-platform-lock (F29) failures that never reproduce in the local workspace.
- **F32 — doc-verifying subagents get the bundled Context7 MCP.** `sdlc-architect`, `sdlc-researcher`
  and `sdlc-security` now list the plugin-scoped Context7 tools (`resolve-library-id`, `query-docs`) —
  and `WebFetch` — in their tool grants, with an explicit sanctioned fallback documented if the harness
  can't pass the MCP through to a subagent at runtime, so version/API checks stop degrading to
  registry-only.

## [0.14.0] — 2026-07-12

### Dogfood batch F1–F16 (Authentication / Identity Platform, Epic 1)

Sixteen findings from a real end-to-end dogfood on a polyrepo + Azure DevOps + local-git-mode build,
designed and implemented together. Versions: `sdlc` 0.13.1 → **0.14.0**, `sdlc-stack-web` 0.7.1 →
**0.8.0**, `sdlc-ux` 0.2.1 → **0.3.0**, marketplace → **0.14.0**. Full design record:
`docs/dogfood-findings-archive.md`.

#### `sdlc` — poly workspace modeling

- **F1 — cross-repo work is modeled at authoring time, not improvised at run time.** `intake`, `groom`
  and `planning` now enforce the poly invariant *1 story = 1 repo*: a story/task spanning repos is
  authored as a **Feature → per-repo child Stories** (Feature-tier preferred because ADO forbids
  Story→Story parenting). `run` §2.5 formalizes the run-time safety net (decompose-and-run /
  decompose-defer / single-repo-subset) with the ADO hierarchy constraint spelled out.
- **F2 — undeclared repos get declared, not mis-routed.** New **`/sdlc:repo add <name>`** command
  declares a repo in `repos[]` **and** bootstraps the folder (`git init` + base commit + optional
  tooling/structure baseline). `work-items` routing and `run` §2.5 now offer to declare an undeclared
  repo instead of silently folding the work into another one.
- **F3 — `init` asks mono-vs-poly explicitly.** Auto-detect is a *proposal* only; a greenfield poly
  workspace (no sub-repos yet) no longer silently collapses to mono.
- **F4 — `init` bootstraps greenfield repos.** Poly `init` offers to `git init -b <default>` + base-
  commit each declared repo so the pipeline can branch into it immediately (the "first story creates
  the repos" chicken-and-egg), or documents the exact commands if skipped. Shared with `/sdlc:repo`.
- **F8 — `control-plane` is a first-class routing target.** Workspace-level items (README, cross-repo
  docs, control-plane config) resolve deterministically to the workspace root instead of ad-hoc.

#### `sdlc` — tracker robustness

- **F5 — ADO "connected" ≠ "authenticated".** `wi-ado` documents the launch-env root cause
  (`ADO_MCP_ORG` + `az login` must be present in the shell that *launches* Claude Code; mid-session
  installs need a relaunch); `status` adds a **tracker doctor** that distinguishes "MCP process up" from
  "ADO reachable + authenticated" and prints the remediation; the adoption guide gains a callout.
- **F7 — `init` populates ADO `statusMap` from the board's real states** (customized boards like
  *Development in Progress / Ready for QA*), instead of assuming Agile defaults or leaving it empty.
- **F15 — re-decomposition no longer drops requirements or orphans originals.** `work-items` gains a
  **Re-decomposition & supersession** contract: an **AC coverage map (old→new)** flags any uncovered
  criterion; superseded originals are linked + moved to a **type-appropriate terminal state** (probe
  per work-item type — `Removed` may exist for a Story but not a Task — never hard-code); no silent
  retype (create-new + link, or umbrella parent); AC field is Story-tier in ADO. `status` adds a
  **ground-truth reconciliation** step (board vs run files vs disk/git) run at epic/story close.
- **F16 — adapter writes are read-back-verified.** Every mutation (`transition`/`create`/`comment`/
  `link`/`updateAC`) must fetch the item back and assert the change landed before recording success,
  **tolerating eventual consistency** (retry/backoff, not hard-fail on first mismatch) and raising a
  hard error on persistent divergence. Stated in the `work-items` contract so it binds all trackers;
  `wi-ado` calls out the flaky `az.cmd` write that caused the live board/run-file divergence.

#### `sdlc` — gating & render defaults

- **F6 — `init` normalizes the control-plane branch** to the configured default (no `master` control
  plane while every repo says `main`).
- **F11 — the design-pod scaffold gate is deterministic in headless/sprint mode.** `run` §2 defines a
  scaffold-vs-real-UI classifier (scaffold/skeleton scope → `ui:false`, jury skipped, even in a UI
  repo; ambiguity errs to `ui:true`); `sprint` applies it with no prompt so a batched sprint never
  burns a full design run on an empty shell.
- **F13 — the render URL is resolved from the repo, not a stale config default** (see `sdlc-ux`);
  `run` §6 has the scaffold write its chosen dev-server port back to `ux.renderBaseUrl` and flag
  cross-repo port collisions; `init` derives/asks the UX dev port instead of defaulting every repo to
  :3000.

#### `sdlc-stack-web` — scaffold-template completeness

- **F9 — the dependency-cruiser boundary gate ships with every scaffold.** `project-structure` replaces
  the init-only note with a mandatory **repo-scaffold checklist** (applies to `/sdlc:init` *and* any
  `/sdlc:run` scaffold task) so `.dependency-cruiser.cjs` + `depcruise` are never silently omitted.
- **F10 — the shared/base tsconfig is documented as strictness-only** in `coding-standards-ts`
  (`moduleResolution`/`baseUrl`/`target` belong in each repo's own tsconfig) — the template was already
  clean; the principle was unstated. Enforced by the F9 checklist.
- **F12 — a pre-composed Next.js ESLint overlay** (`templates/tooling/next/`) ships the four
  ESLint-10 / Turbopack / `file:../`-monorepo reconciliations pre-solved (dedupe the `@typescript-
  eslint` plugin registration, pin `react.version`, map `.js/.cjs/.mjs` to `disableTypeChecked`,
  `turbopack.root` snippet) so every Next repo stops re-deriving them. Pins verified against the
  registry + Context7 (2026-07-12): `eslint-config-next@16.2.10` (peerDep `eslint >=9`, accepts
  ESLint 10), `react@19.2.7`; `eslint-plugin-react` rides transitively at `7.37.5` — the `react.version`
  pin (workaround #2) is required precisely because no stable `eslint-plugin-react` yet declares native
  ESLint-10 support (documented, with a "drop the pin when it does" note). Overlay README instructs
  adopters to confirm with `eslint --print-config` per repo.
- **F14 — a hardened `.gitignore`** (`templates/tooling/.gitignore`) ignores `.env*` with a
  `!.env.example` allow-exception — secret hygiene by default, a real concern for auth/identity repos.

#### `sdlc-ux` — jury render resolution & scope gate

- **F11 — pod-scope gate** in `design` mirrors the core scaffold-vs-UI classifier so the pod
  self-applies skeleton-only when invoked standalone on a scaffold scope.
- **F13 — the jury resolves the render URL from the repo's actual `dev`/`start` port** at render time
  (parsed from `package.json`), using `ux.renderBaseUrl` only as a fallback, preferring the derived
  port on mismatch, and **failing loud on a non-UI response** (JSON/404) so a wrong-server render can
  never silently score. Mirrored across `design`, `design-jury` and the `sdlc-ux-jury` agent.

## [0.13.1] — 2026-07-11

### Added

- **ADO Feature handling in `wi-ado` (`sdlc`).** Azure DevOps nests Epic → Feature → User Story →
  Task/Bug, but the canonical schema has no `feature` tier. The adapter now maps **both Epic and
  Feature → canonical `epic`** (decomposable parents), preserving the real ADO type in
  `sourceRaw.adoType` so writes never convert one into the other. `query` excludes Features as well
  as Epics from ready work; decomposition creates User Story children parented under the Feature
  (or under an Epic per the project's convention). Previously a Feature could surface in ready-work
  queries and fail to classify. Version: `sdlc` 0.13.0 → **0.13.1**, marketplace → **0.13.1**.

## [0.13.0] — 2026-07-11

### Changed — per-agent verification cadence; economical defaults (`sdlc`)

- `pipeline.verification` moves from a global `mode`/`scope` + on/off toggles to **per-agent
  cadence**: `reviewer`, `qa` and `security` each take `off | on-demand | per-item | per-epic`
  (security also `risk-based`), plus `securityConfirm`. The old global `scope` field is removed
  (folded into per-agent cadence).
- **New defaults are economical** — `reviewer: on-demand`, `qa: on-demand`, `security: per-epic`
  (`securityConfirm: true`). A typical item now runs **no LLM verification agent**: you invoke
  reviewer/QA on demand (re-run and ask), and security runs once per epic **after you confirm**. The
  deterministic CI gate (lint/format/typecheck/boundaries/tests) + the implementer's own test run are
  the per-item floor, and the bug failing-repro-test still runs at implement. (Previous default:
  reviewer + QA on every item + risk-based security — thorough, but the biggest recurring token/time cost.)
- Wired through `run` §7 (verify) and §2 (epic consolidation runs the per-epic agents; security
  confirmed), the config schema, both scaffolded configs, `init` (Economical / Balanced / Thorough /
  Manual profiles) and the user guide. Teams wanting the old behavior set all three to `per-item`.
- Version: `sdlc` 0.12.2 → **0.13.0**, marketplace → **0.13.0**.

## [0.12.2] — 2026-07-11

### Added

- `sdlc:intake` now stamps **provenance** on every item it creates — an `unplanned` label plus a
  `Provenance: created via /sdlc:intake on <date> — "<ask>"` note in the description — so
  request-born work (asked for directly, outside the planned backlog) stays queryable later. It's
  tracker-agnostic via the adapter contract: the label maps to markdown frontmatter, Jira labels or
  ADO `System.Tags` identically, and the note goes in `description` everywhere. Filter on `unplanned`
  to see everything that entered outside planning. Version: `sdlc` 0.12.1 → **0.12.2**, marketplace → **0.12.2**.

## [0.12.1] — 2026-07-11

### Changed

- `sdlc-researcher` agent runs on **Opus** (was Sonnet). Spikes are high-stakes technology-selection
  decisions that downstream stories build on; the deeper tier is worth it. Behavior/protocol
  unchanged — it still blends codebase + Context7 + WebSearch + a scratchpad PoC and delivers a cited,
  date-stamped decision report. Version: `sdlc` 0.12.0 → **0.12.1**, marketplace → **0.12.1**.

## [0.12.0] — 2026-07-11

### Added — dependency policy, vetted at install time (`sdlc`)

- New `dep-vet` PreToolUse hook gates package-ADD commands (`npm i <pkg>`, `npm install <pkg>`,
  `pnpm|yarn|bun add …`) and asks the operator to vet the package **before** it's installed and coded
  against — so a bad/stale/incompatible choice is caught early, not reworked in verify. Bare lockfile
  installs (`npm ci`, `npm install`, `pnpm i`) and `npm run` scripts are untouched. Ships
  `dep-vet.test.mjs` (21-case detection matrix).
- `sdlc:security` §4 is now the canonical **Dependency policy** — deliberately *not* an allow-list
  (that would handcuff projects): any package is fine if it clears three tests — **safe** (maintained,
  no typosquat, clean license/scripts, no open CVEs), **latest stable** (current stable version,
  verified via Context7/registry, no prereleases), and **compatible** (satisfies peerDependencies +
  `engines`; never `--legacy-peer-deps`/`--force` to silence a peer conflict). `coding-standards-ts`
  (add-time) and `maintenance` (bump-time) cross-link it.
- Version bumps: `sdlc` 0.11.0 → **0.12.0**, marketplace → **0.12.0**, `sdlc-stack-web` 0.7.0 →
  **0.7.1** (coding-standards pointer). `sdlc-ux` (0.2.1) unchanged.

## [0.11.0] — 2026-07-11

### Added — enterprise project structure, scaffolded + boundary-gated (`sdlc-stack-web`, `sdlc`)

- New `sdlc-stack-web:project-structure` skill — the canonical enterprise folder trees: NestJS
  backend (`modules/<feature>` + `common/{filters,guards,interceptors,pipes,decorators,constants}`,
  thin controller → service → repository) and **two frontend flavors** — `next-app` (App-Router-first,
  server components own data, RTK for client state) and `rtk-spa` (RTK Query as the primary data
  layer) — with layering rules, RTK/RTK Query conventions, `components/{ui,features}` + custom-hooks
  taxonomy, and a centralized `common/constants/{http-status,messages}` module (no inline strings).
- Ships `templates/structure/`: three `dependency-cruiser` boundary configs (backend / next-app /
  rtk-spa) and canonical reference files (NestJS exception filter mapping to the api-design error
  shape + constants; RTK `store/{index,hooks,api/base-api}`).
- `/sdlc:init` asks the frontend flavor and scaffolds the matching skeleton per TS repo (per-repo in
  poly, merge-aware, skips non-TS); `sdlc:ci-cd` runs `depcruise` in the PR gate so layering
  violations (feature→feature internals, controller→repository, `ui`→`store`) fail the build
  regardless of `verification.mode`. `nestjs`/`nextjs` skills cross-link the structure; Next adopts
  the RTK/RTK Query state stance.
- Version bumps: `sdlc-stack-web` 0.6.0 → **0.7.0**, `sdlc` 0.10.0 → **0.11.0**, marketplace → **0.11.0**.

## [0.10.0] — 2026-07-11

### Added — strict web-stack tooling baseline (`sdlc-stack-web`, `sdlc`)

- `sdlc-stack-web` now ships a **deterministic quality baseline** in `templates/tooling/`:
  `tsconfig.base.json` (strict — `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, unused
  locals/params, …), `eslint.config.mjs` (flat, type-aware: `typescript-eslint` strict-type-checked
  + stylistic, `no-explicit-any`, `consistent-type-imports`, Prettier last), `.prettierrc.json`,
  `.editorconfig`, `.npmrc` (`engine-strict` + `save-exact`), and a README with the exact devDeps +
  scripts.
- `/sdlc:init` scaffolds the baseline into every TypeScript repo (per-repo in poly; **merge-aware** —
  never clobbers configs you already have; skips non-TS repos); `sdlc:ci-cd` runs
  `typecheck → lint → format → build → test` as a **hard PR gate that holds even when the reviewer is
  toggled off**. `coding-standards-ts` now states the division of labour: tools own the mechanical
  rules, the reviewer owns judgment (validate-at-edge, state modelling, dependency choice).
- Rationale: the coding standards were previously enforced mainly by the LLM reviewer and assumed a
  strict project config existed. This shifts the mechanical half to tooling that runs on every commit
  and in CI — "the code can't just work however it's written."
- Version bumps: `sdlc-stack-web` 0.5.0 → **0.6.0**, `sdlc` 0.9.1 → **0.10.0**, marketplace → **0.10.0**.

## [0.9.1] — 2026-07-11

### Fixed

- **Bash guard hook false-tripped on tokens inside commit messages (`sdlc`).** The push guard
  flagged any command that merely contained the words `git` … `push`, so a legitimate
  `git commit -m "…push…"` on `main` was blocked; the same class hit commit messages mentioning
  `TRUNCATE TABLE`, `git filter-branch`, `prod`/`psql`, `id_rsa` or `rm -rf /`. The guard now
  inspects the command being executed, not free text: quoted argument text is stripped before
  command-identity detection, `git push` is matched as an actual subcommand, and the DB/prod/
  credential/rm content checks are skipped for `git` segments (git runs none of those) while
  cross-pipe `.env` exfil still scans the whole command. Adds `guard.test.mjs`, a 33-case
  block/allow regression matrix. Version: `sdlc` 0.9.0 → **0.9.1**, marketplace → **0.9.1**.

## [0.9.0] — 2026-07-11

### Added — local git mode (no remote required) (`sdlc`)

- New `git.mode` (`remote` default | `local`) — per-repo in poly, top-level in mono. Lets a project
  run the full pipeline **before it has a git remote**: no push, no PR. After green verify the
  pipeline shows the commits + diffstat and integrates via a **user-confirmed local `--no-ff` merge**
  into the default branch — the framework's one mandatory human gate is relocated (PR review →
  merge approval), never removed. Non-interactive/declined → parks at `review-pending` with
  instructions, never merges unattended. Default `remote` = existing push+PR behavior, unchanged.
- Repo-aware across `git-workflow` (new *Local mode* section), `run` §8 (integrate = PR or local
  merge), `init` (detects a missing remote and proposes `local`), `status` (PR column shows
  `local-merge:<sha>`), `release` (tags locally, skips publish), the always-on git-workflow rule,
  the config schema + scaffolded template. Flip `git.mode: remote` once an origin exists.
- Version bumps: `sdlc` 0.8.0 → **0.9.0** (minor — new feature), marketplace 0.8.0 → **0.9.0**.
  `sdlc-ux` (0.2.1) and `sdlc-stack-web` (0.5.0) unchanged.

## [0.8.0] — 2026-07-11

### Added — polyrepo (multi-repo) support (`sdlc`)

- A workspace can now hold **many git repos** (e.g. `backend/`, `frontend/`, `website/`, `mobile/`),
  not just one. **Mono is unchanged and remains the default** — an empty `repos[]` behaves exactly as
  before, so existing projects need zero migration.
- New config: `workspace.layout` (`mono` | `poly`) + `repos[]` (per-repo `name`, `path`, `host`,
  `remote`, `defaultBranch`, `branchPattern`, `stack`, `labels`, optional per-repo `ux`, `default`).
  The control plane (`.claude/`, `backlog/`, `.sdlc/`) lives at the workspace root; product repos are
  subfolders. Ships `.claude/sdlc.config.poly.example.json` and the previously-missing
  `docs/sdlc.config.schema.json` (validates both shapes).
- **Orchestrator-driven routing.** You describe a requirement in plain language; the orchestrator
  grounds it against the actual repos and routes each item to one repo (explicit `repo` → label →
  default → ground → ask). Cross-repo features become an **epic** whose child stories each target one
  repo, sequenced by a new `dependsOn` field; a control-plane coordination file rolls them up.
- **Invariant: 1 run = 1 item = 1 repo = 1 branch = 1 PR** — every PR stays small and independently
  reviewable, and each child run is atomic and resumable.
- Repo-aware across the pipeline: `run`, `git-workflow`, `ci-cd` (host from the resolved repo),
  `work-items` schema + all three adapters (markdown/Jira/ADO map `repo` + `dependsOn`), `intake`,
  `groom`, `next` + `status` (multi-location run-file scan; unified board + Repo column + epic
  rollup), `sprint` (worktrees per target repo), `release` (per-repo), `init` (poly setup), the
  `sdlc-ux:design` pod (operates in the resolved frontend repo and reads its own `ux`), and the
  `session-context` / `checkpoint` hooks (scan every repo's run dir).
- Version bumps: `sdlc` 0.7.4 → **0.8.0** (minor — new feature), `sdlc-ux` 0.2.0 → **0.2.1**
  (poly-aware design handoff), marketplace 0.7.4 → **0.8.0**. `sdlc-stack-web` unchanged (0.5.0).

## [0.7.4] — 2026-07-09

### Fixed

- **Duplicate hooks-file load error (`sdlc` → 0.7.3).** Current Claude Code auto-loads a plugin's
  standard `hooks/hooks.json`, so the manifest must not also point at it. Removed
  `"hooks": "./hooks/hooks.json"` from `plugins/sdlc-core/.claude-plugin/plugin.json`; the hooks
  still load automatically from the standard path. Fixes: *"Failed to load hooks … Duplicate hooks
  file detected … manifest.hooks should only reference additional hook files."*

## [0.7.3] — 2026-07-09

### Added — user-controlled verification cadence (`sdlc` → 0.7.2)

- New `pipeline.verification` config block puts the review/QA cost — the pipeline's biggest
  recurring spend — in the user's hands:
  - `mode`: `auto` (SDLC runs reviewer + QA, current behavior), `manual` (SDLC skips the agents and
    opens the PR for the human to review; run ends at a new `review-pending` phase; issues fed back
    by rerunning `/sdlc:run <ID>`), or `ask` (pipeline prompts per item).
  - `scope`: `per-item` (verify every item, default) or `per-epic` (children skip per-item review;
    one consolidated pass when the epic's children are all implemented).
  - `reviewer` / `qa` / `security` toggles for fine control (e.g. keep the fast code review, drop
    the heavier QA test-authoring).
- `/sdlc:init` now asks for the verification cadence up front.
- Safety preserved: in every mode the implementer still runs lint + tests to green before a PR, and
  the human merge of the PR remains the final gate — `manual` just skips the *extra* bot pre-review
  (and flags the PR as un-reviewed by bots). `security: off` on a risky diff leaves a visible note.
- Default is unchanged (`auto` / `per-item`) so existing projects behave exactly as before until
  they opt into a cheaper cadence.
- Docs: user guide §3b (cadence table + manual feedback loop), example walkthrough (init option),
  architecture (extension point).

## [0.7.2] — 2026-07-09

### Changed

- **`sdlc-ux` enabled by default.** The design pod now ships `defaultEnabled: true` in the
  marketplace — no manual install/enable step. It stays dormant on backend/infra items, so
  non-UI projects are unaffected; turn it off per project with `ux.enabled: false`.
- **Hardened UI detection in the orchestrator (`sdlc` → 0.7.1).** The decision to invoke the
  design pod moved from a soft path-glob check during implement to an explicit determination at
  the **classify** step, recorded as `ui:` on the run file. Signals: a `ui`/`ux`/`design`/`frontend`
  label, OR the title/description/AC mentioning a screen/page/component/layout/visual/motion/
  redesign, OR a frontend stack with an item that clearly renders something. When unsure on a
  frontend item it defaults `ui: true` (an over-invoked jury is cheap; a missed one ships un-judged
  UI). The auto-invocation now also passes the resolved **scope, mode and brand** through, so the
  autopilot behaves the same as running `/sdlc-ux:design` by hand. Run-file template gains
  `ui` / `uxScope` / `uxMode`.
- Docs updated: user guide (§3a design-pod section + cheat-sheet + troubleshooting), example
  walkthrough (§6a/§6b showing the pod on the todo UI + a brand-anchored redesign), adoption guide
  and architecture.

## [0.7.1] — 2026-07-09

### Added — `sdlc-ux` plugin (v0.2.0): existing projects, scope targeting & brand references

- **Works on existing projects, not just greenfield.** `/sdlc-ux:design` now resolves a **scope**
  (a page/route/screen, a path/glob, or the whole app) and a **mode**:
  - `greenfield` — establish the design system; it becomes the project standard every later UI item
    adopts (implemented and followed throughout).
  - `retrofit` — redesign a specific page/screen while **adopting the project's established system**
    first, so the target stays uniform with the rest of the app.
  - `redesign` — whole-app redesign that may replace and re-propagate the system.
- **UI audit step** for existing surfaces: renders the current UI (Playwright) + sibling screens,
  and `sdlc-design-system` (new **audit mode**) extracts the current design language, flags
  inconsistencies, and recommends conform / elevate-in-place / replace → `design/audit.md`.
- **Brand references** (new + existing): pass a logo, colors, fonts, or reference screenshots (in
  `$ARGUMENTS`, in `ux.brand.referenceDir` = `design/brand/`, or via the `ux.brand` config). They're
  treated as **hard constraints** — the design-system extracts a palette from the logo, matches
  fonts (best-effort, flags ambiguous screenshot matches for confirmation), and honors supplied
  values exactly. Catalogued in `design/brand.md`.
- Jury now scores **cross-page consistency + brand adherence** on scoped redesigns (target must not
  be a lone island in a different style), using sibling-page shots.
- New `ux.brand` config block; new `audit.md` and `brand.md` templates.

## [0.7.0] — 2026-07-09

### Added — `sdlc-ux` plugin (new, opt-in): the UI/UX design pod

- A five-role pod for award-tier, uniform desktop-web UI:
  - `sdlc-ux-writer` (sonnet) — writes `design/narrative.md`: the experience story (vision, tone,
    journey, one signature moment) that every downstream decision must trace back to.
  - `sdlc-ux-researcher` (sonnet) — mines Awwwards/FWA and current best-in-class work (WebSearch/
    WebFetch) for cited, transferable techniques → `design/inspiration.md`.
  - `sdlc-design-system` (sonnet) — the **uniformity anchor**: color/type/spacing/radius/elevation
    tokens emitted to code as the single source of truth, WCAG-AA contrast verified.
  - `sdlc-motion` (sonnet) — animation, micro-interactions, scroll/parallax, GSAP, sequencing —
    within a 60fps + `prefers-reduced-motion` budget; realizes the signature moment.
  - `sdlc-ux-jury` (opus) — strict, **unbiased** Awwwards-style judge. Renders the built UI with
    Playwright, screenshots it, scores a weighted rubric /10 with mandatory visual evidence, blind
    to the makers' reasoning. A 9 is rare and must be earned.
- `/sdlc-ux:design <item|path|description>` — the pod pipeline: narrative → research → design system
  → build + motion → **jury loop until composite ≥ `ux.juryThreshold` (default 9)**, capped at
  `ux.maxJuryRounds` (default 3). At the cap it ships the best-scoring round, attaches the jury's
  remaining critique, and flags for human — never loops forever, never escalates models.
- Skills: `design` (orchestration), `ux-narrative`, `design-research`, `design-system`, `motion`,
  `design-jury` (rubric + anti-bias + render protocol). Templates for all five `design/*` artifacts.

### Changed — `sdlc` plugin

- Orchestrator (`/sdlc:run`): UI-touching items now route the frontend through `sdlc-ux:design`
  (jury gate included) when `sdlc-ux` is installed and `ux.enabled` — no hard dependency; core still
  runs standalone.
- Project `sdlc.config.json` gains a `ux` block (`enabled`, `target: desktop-web`, `juryThreshold`,
  `maxJuryRounds`, `juryPanelSize`, `renderBaseUrl`, `uiPaths`).

## [0.6.1] — 2026-07-09

### Fixed

- **Agent model identifiers**: all agents pinned invalid model ids (`claude-sonnet`,
  `claude-opus`, `claude-haiku`) which Claude Code could not resolve — subagents died with an
  API error and the orchestrator fell back to the session's (larger) model. Corrected to the
  valid tier aliases (`sonnet` / `opus` / `haiku`), so each agent runs on its intended tier.
- Orchestrator invariant added: a subagent model/API failure must be reported, never worked
  around by escalating to a larger model.

## [0.6.0] — 2026-07-09

### Added — `sdlc` plugin (requirement intake)

- `/sdlc:intake <text>`: the pipeline's front door for requirements that exist only in the
  user's head — analyst grounds the requirement in the codebase, sweeps the existing backlog
  (skip covered / delta-only for partial overlap / flag in-flight conflicts), proposes the
  item set (epic+stories or single story/bug/task) with AC, creates on approval in the active
  tracker (Jira/ADO/markdown).
- `/sdlc:run <free text>`: non-ID arguments route through intake, then the pipeline runs the
  first created item — "describe it and it gets built".
- Analyst agent: intake mode (propose-only; the orchestrator creates after approval).

## [0.5.0] — 2026-07-08

### Added — `sdlc` plugin (Phase 5: self-extension & scale)

- `scaffold-skill` / `scaffold-agent`: create project-local capabilities from the templates,
  with mandatory `x-sdlc` metadata and the agent-test justification; registered in
  `.sdlc/extensions.json` with reuse tracking.
- Capability-gap protocol in the orchestrator: search plugins → local → registry before
  creating; reuseCount bumped on every reuse; `/sdlc:status` surfaces promotion candidates.
- `/sdlc:promote`: validate (secret scan, lint) → generalize (project specifics → config
  references, with a shown diff) → package into the right plugin on a `promote/<name>` branch
  → PR with the reviewer checklist. PR opening is user-confirmed.
- `/sdlc:sync`: post-merge reconciliation — deletes local forks shadowed by promoted plugin
  versions, resolves shadowing conflicts, reports promotion-ready candidates.
- `/sdlc:sprint N`: parallel independent items — analyst independence check, one git worktree
  + headless pipeline run per item, live board from run-file polling, queued conflicts,
  worktree cleanup on completion.
- Governance: `docs/promotion-policy.md` (acceptance bar + reviewer checklist), CODEOWNERS
  making `plugins/**` platform-team owned.

## [0.4.0] — 2026-07-08

### Added — `sdlc` plugin (Phase 4: depth agents)

- `sdlc-architect` (opus): explores the codebase, plans items ≥ `architectThreshold`, writes ADRs.
- `sdlc-security` (opus): deep security pass — input→sink tracing, authz, dependency audit —
  auto-triggered by `securityReviewPaths` overlap, manifest changes, or `security` label.
- `sdlc-devops`: docker/CI/release items and red-PR-check diagnosis.
- `sdlc-docwriter` (haiku): docs phase; amends the PR with `docs(...)` commits.
- `sdlc-researcher`: spike items → cited decision reports in `docs/research/`.
- Skills: `architecture` (ADR discipline), `security`, `ci-cd`, `release` (`/sdlc:release`),
  `docs-writing`, `research`, `maintenance`; ADR template.
- Orchestrator wiring: security agent joins the verify batch conditionally; spikes route to the
  researcher; infra-only plans route to devops; red CI checks get a diagnosis pass.

### Added — `sdlc-stack-web` plugin (new)

- Stack expertise skills: `coding-standards-ts`, `nextjs` (App Router), `nestjs`, `postgres`,
  `mongodb`, `db-migrations` (expand-contract), `docker`, `api-design`.

## [0.3.0] — 2026-07-08

### Added — `sdlc` plugin (Phase 3: real trackers + Azure)

- `wi-jira` adapter: Jira via Atlassian MCP — JQL queries, transition-by-target-status,
  AC field/section detection, dev-panel linking, per-project `statusMap`.
- `wi-ado` adapter: Azure Boards via ADO MCP with `az boards` CLI fallback — WIQL queries,
  Agile/Scrum process detection, state-stepping with tag fallbacks, HTML field mapping.
- Azure Repos PR path in `git-workflow` (`az repos pr create` + work-item linking).
- `/sdlc:groom` — analyst-driven backlog refinement with autonomy boundaries
  (AC/sizing applied; decompositions and priority changes proposed only).
- Bundled MCP: `atlassian` (remote, OAuth) and `azure-devops` servers.
- Project template: `.mcp.json.example` with optional read-only Postgres/MongoDB, Sentry,
  Notion, Figma servers.

## [0.2.0] — 2026-07-08

### Added — `sdlc` plugin (Phases 0–2)

- Marketplace + plugin manifests; installable via `/plugin marketplace add`.
- Project template (`templates/project/`) scaffolded by `/sdlc:init`: CLAUDE.md, permissions
  posture, `sdlc.config.json` switchboard, always-on rules, markdown backlog spec, run-state folders.
- Orchestrator pipeline `/sdlc:run`: fetch → classify → requirements → plan → implement →
  verify (review + QA parallel, fix cycles) → PR → wrap; resumable via run files.
- `/sdlc:next`, `/sdlc:status` commands.
- Work-item adapter layer: canonical WorkItem schema + 7-operation contract; `wi-markdown` adapter.
- Agents: `sdlc-analyst`, `sdlc-implementer`, `sdlc-reviewer`, `sdlc-qa`.
- Phase skills: requirements, planning, git-workflow, code-review, testing, debugging, run-state.
- Hooks (Node, cross-platform): bash guard, protected paths, format-on-save, session context
  snapshot, run-state checkpoint/notify.
- Bundled MCP config: context7, github, playwright (auth per user).
- Docs: adoption guide, architecture (incl. phases 3–5 roadmap), permissions rationale.
