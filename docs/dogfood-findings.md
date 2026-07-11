# SDLC Plugin — Dogfood Findings (Authentication / Identity Platform)

**LIVING DOCUMENT — do NOT implement these yet.** Findings are logged as the dogfood proceeds;
all plugin modifications get designed + implemented together at the **end**, through the normal
branch → version → merge flow. Started 2026-07-11.

## Context

Dogfooding the SDLC plugin end-to-end on the **Bee Logical Identity Platform** (a real, ambitious
build):

- **Layout:** polyrepo — 5 repos: `bee-auth-api` (NestJS IdP), `bee-auth-web` (Next.js login),
  `bee-auth-admin` (Next.js admin), `bee-auth-sdk-nest`, `bee-auth-sdk-next`. Control plane at
  `D:\Authentication`.
- **Work items:** Azure DevOps — org `BeeLogical-APP`, project `Dashboard Test`, Agile template.
  7 epics / 27 features / ~37 stories / ~79 tasks (150 items).
- **Git mode:** local (no remotes yet). **Verification:** economical (reviewer/QA on-demand,
  security per-epic + confirm).
- Plugin versions under test: `sdlc` 0.13.1, `sdlc-stack-web` 0.7.1, `sdlc-ux` 0.2.1.

**Severity:** 🔴 blocks/confuses a core flow · 🟠 friction/manual workaround · 🟡 polish.

---

## Open findings (to implement at the end)

### F1 🔴 — Poly: a cross-repo "workspace-bootstrap" story has no clean home
**Symptom.** Story 8416 "Scaffold platform as separate repos" legitimately spans all 5 repos + a
shared `@beelogical/dev-config` package + a workspace README. On `/sdlc:run 8416` the orchestrator
correctly *detected* the conflict with the poly invariant (1 story = 1 repo = 1 branch) and offered
to decompose into per-repo child stories — but only ad-hoc, at run time.
**Root cause.** Poly models cross-repo work only at the **epic** level (fan out to per-repo child
stories). A cross-repo **story** (common for bootstrap/refactor/shared-config work) isn't modeled,
and the backlog authored this as a single story.
**Proposed modification.**
- `sdlc:intake` + `sdlc:groom` (poly): detect a story whose scope spans repos and split it into
  per-repo child stories **at creation/refinement time**, not at run time.
- Poly backlog-authoring guidance in `intake`/`planning` skills + adoption/user docs: *"in poly,
  scope each story to one repo; cross-repo work is a feature/epic with per-repo children."*
- Formalize the run-time "story spans repos → decompose" path the orchestrator improvised (the three
  options it offered — decompose-and-run / decompose-defer / single-repo-subset) so it's consistent
  and documented in `sdlc:run` §2.5.
- **ADO hierarchy constraint (seen live):** ADO forbids Story→Story parenting, so decomposing a
  cross-repo *Story* yields child **Tasks** under it (parent Story becomes an umbrella —
  non-idiomatic). Prefer decomposing cross-repo work at the **Feature** level (Feature → per-repo
  Stories) so each repo unit is a proper Story. (8416 → child Tasks 8564–8570.) Note: running the
  scaffolds as Tasks is fine functionally (task = slim variant, right for scaffolding).

**Positive note.** The orchestrator *catching* this and offering the canonical fix is the v0.8.0
poly logic working as designed — the gap is authoring guidance + a first-class story-level split.

### F2 🔴 — Poly: work references an *undeclared* repo (shared lib / new product)
**Symptom.** The scaffold work references `@beelogical/dev-config` (a shared config package every
repo extends) that was never declared in `repos[]`. Decomposition has nowhere clean to route it.
**Root cause.** `repos[]` is fixed at init, but real work references repos that don't exist yet
(shared libs, future products — e.g. Epic 7's five SaaS apps).
**Proposed modification.** When routing/decomposition hits an undeclared repo, **offer to declare
it** (append to `repos[]` + bootstrap the folder) instead of silently folding it into another repo.
Consider a small `/sdlc:repo add <name>` helper (updates config + git-inits + base commit).

### F3 🟠 — `/sdlc:init`: poly auto-detect defaults to mono for a greenfield poly project
**Symptom.** With a git-init'd but empty workspace root and no sub-repos yet, init's pre-flight
concluded *"No sub-repos detected → mono layout."* The user had to override via "type something" to
get poly.
**Root cause.** Poly auto-detect keys off **existing** sub-repos; a greenfield poly workspace (repos
not created yet) has none, so it guesses mono.
**Proposed modification.** init should **ask mono-vs-poly explicitly** (a real question), not silently
default from auto-detect — especially for an empty/greenfield workspace. Keep auto-detect as a
*proposal*, never a silent decision.

### F4 🟠 — Poly greenfield bootstrap: repos must pre-exist to branch into (chicken-and-egg)
**Symptom.** The pipeline needs each declared repo to be a git repo with a base commit to branch
into, but the first story is *"create the repos."* The user had to manually `git init -b main` +
base-commit all 5 before running anything.
**Root cause.** Local mode branches from / merges into each repo's `main`; a brand-new empty folder
has no repo and no `main`. init *flags* missing repos but doesn't create them.
**Proposed modification.** init (poly) should **offer to bootstrap declared repos** — `git init -b
main` + an initial commit — so the pipeline can run into them immediately. Or a dedicated
`/sdlc:bootstrap` step. At minimum, document the requirement + the exact commands.

### F5 🟠 — ADO MCP: "connected" ≠ "authenticated"; opaque `Failed to find api location for area`
**Symptom.** `/mcp` showed `azure-devops · connected · 90 tools`, yet board reads failed with
*"Failed to find api location for area."* Root cause: `ADO_MCP_ORG` was unset when Claude Code
launched, and `az` (installed mid-session) wasn't on the launching shell's PATH — so neither the MCP
token fetch nor the `az` fallback could authenticate. (Resolved by relaunching from a shell with both.)
**Root cause.** The MCP *process starting* (tools registered) is easily mistaken for a working ADO
connection; it authenticates on the first real call. The requirement that `ADO_MCP_ORG` **and** `az`
be present in the shell that **launches** Claude Code is a sharp, undocumented edge.
**Proposed modification.**
- Adoption guide (ADO section): state explicitly that `ADO_MCP_ORG` must be set and `az login`
  accessible **in the shell that launches Claude Code**; installing `az` mid-session needs a full relaunch.
- A preflight/"doctor" check (or `/sdlc:status`) that distinguishes *"MCP process up"* from *"ADO
  reachable + authenticated"* and prints the exact remediation, naming the launch-env root cause.

### F6 🟡 — `/sdlc:init`: control-plane branch is `master`, config says `main`
**Symptom.** `git init` created `master` at the control plane while every repo's config is
`defaultBranch: main`. Cosmetic mismatch; user renamed manually.
**Proposed modification.** init should normalize the control-plane branch to the configured default
(`git init -b main` / `git symbolic-ref`), or explicitly note the mismatch.

### F7 🟠 — ADO `statusMap` assumed standard Agile states; this board is customized
**Symptom.** `/sdlc:init` left `workItems.ado.statusMap` empty (and the recommended defaults —
`in_progress→Active`, `in_review→Resolved` — were wrong). This project's board uses **customized**
states: *Development in Progress / Ready for QA / Closed* (no Active/Resolved). The pipeline detected
the real states and fixed the map at run time.
**Root cause.** The default ADO status map assumes an out-of-the-box Agile process; init doesn't
probe the actual board states.
**Proposed modification.** init (ADO) should **query the project's real workflow states** and
populate `statusMap` from them (mapping canonical → detected), instead of assuming defaults or leaving
it empty. `wi-ado` self-healed at run time — but init should get it right up front.

### F9 🟡 — Scaffold applied the structure *layout* but omitted the *boundary-gate config*
**Symptom.** `bee-auth-api` (AUTH-8565) was scaffolded with the correct NestJS layout
(`modules/`, `common/`, `config/`) and tooling (eslint/prettier/tsconfig via `@beelogical/dev-config`),
but **no `.dependency-cruiser.cjs`** — so the `project-structure` boundary check (v0.11.0) has no config
to run and is silently inert.
**Root cause.** The implementer applied the structure *layout* from `sdlc-stack-web:project-structure`
but not the shipped `dependency-cruiser` boundary config; the task AC didn't call it out, and there's
no CI in local mode to notice its absence.
**Proposed modification.** Make the boundary config part of the repo-scaffold checklist — when the
pipeline scaffolds a repo per `project-structure`, it should drop the matching
`.dependency-cruiser.cjs` + `depcruise` script alongside the layout, so the gate is real once CI exists.
(Low priority: no CI under local mode yet, but it should be present for the remote flip.)

### F8 🟡 — Poly: control-plane-targeted items have no `repos[]` entry to route to
**Symptom.** Task 8570 (workspace README) targets the **control plane**, which isn't a declared repo,
so routing is deferred to run time.
**Root cause.** Poly routing resolves to a `repos[]` entry; genuinely workspace-level work (README,
cross-repo docs) has no such target.
**Proposed modification.** Recognize a first-class **`control-plane`** routing target in `sdlc:run`
§2.5 for workspace-level items, so they resolve deterministically instead of ad-hoc.

---

## Validated — working as designed (no change needed)

- ✅ **ADO Feature tier (v0.13.1):** Epics **and** Features correctly excluded from "ready work";
  only stories surfaced in the ready list. The just-shipped fix works on a real board.
- ✅ **Verification cadence (v0.13.0):** economical default offered and configured cleanly
  (reviewer/QA on-demand, security per-epic + confirm).
- ✅ **Local git mode (v0.9.0):** selected and written for all repos; host inferred `azure-repos`
  (inert under local) for a clean future flip.
- ✅ **Poly config (v0.8.0):** 5 repos with correct per-repo stacks/ux written to `sdlc.config.json`;
  orchestrator correctly detected cross-repo scope (see F1).
- ✅ **ADO connectivity via `az` fallback:** full board (150 items, 7-epic rollup) rendered once the
  launch environment was fixed.
- ✅ **Dependency policy (v0.12.0) — verified live against the npm registry (2026-07-12):** the
  `bee-auth-dev-config` scaffold (AUTH-8564) pinned current, mutually-compatible versions — eslint
  10.7.0, @eslint/js 10.0.1, typescript-eslint 8.63.0, @types/node 26.1.1, prettier 3.9.5,
  eslint-config-prettier 10.1.8 — and, crucially, TypeScript **6.0.3 instead of the latest 7.0.2**,
  because `typescript-eslint@8.63` caps TS at `<6.1.0` and no tseslint 9 exists yet. "Latest stable
  **and** compatible" worked, including the non-obvious compat call. (Note to self: verify versions
  against the registry, not training memory — nearly logged a false finding here.)

## Out of scope (not plugin issues — noted for the record)
- Backlog push created **150 of 165** planned items (~3 stories + 12 tasks short) — a limitation of
  the external HTML pusher, not the plugin; check its log.
- PowerShell tool disabled in the session (az driven via Bash) — environment quirk.

---

## Append log
- 2026-07-11 — initial findings F1–F6 from `/sdlc:init` + first `/sdlc:run 8416` on the poly ADO setup.
- 2026-07-11 — F1 & F2 confirmed live during 8416 decomposition: orchestrator prompted for the
  cross-repo split (F1) and asked where the undeclared `bee-auth-dev-config` should live (F2 → new
  repo). Added F7 (ADO statusMap auto-detect), F8 (control-plane routing target), and an F1 note on
  the ADO Story→Story hierarchy constraint (children became Tasks 8564–8570).
- 2026-07-12 — AUTH-8564 (dev-config) scaffolded + locally merged. Reviewed its package.json;
  registry-verified all versions → dependency policy produced current + compatible pins (see
  Validated). No finding.
