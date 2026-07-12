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

### F10 🟡 — Guidance gap: shared/base tsconfig should be strictness-only (module resolution per-repo)
**Symptom.** The generated `@beelogical/dev-config` shared `tsconfig.base.json` set
`moduleResolution:"node"` + `baseUrl`, which **TypeScript 6.0.3 deprecates**. Every consumer
(`bee-auth-api`, and the siblings to come) inherits it and must patch per-repo with
`ignoreDeprecations:"6.0"` — a workaround that won't survive a TS7 migration.
**Root cause.** The implementer put module-resolution settings in the **shared base**. Our stack-web
tooling-baseline *template* deliberately keeps `tsconfig.base.json` **strictness-only** (no
`module`/`target`/`moduleResolution`/`baseUrl`) so it layers cleanly under any repo — but
`coding-standards-ts` / `project-structure` never **state** that principle, so a hand-authored shared
config drifted.
**Proposed modification.** State explicitly in `coding-standards-ts` (and/or `project-structure`):
a shared/base tsconfig is **strictness-only**; `moduleResolution`, `baseUrl`/`paths`, and `target`
belong in each repo's own tsconfig (matching what the template already does).
**Project-side follow-up (not plugin):** fix `bee-auth-dev-config`'s base to strictness-only and drop
the per-repo `ignoreDeprecations` — before the siblings replicate the workaround, and before any TS7 move.
**Proven clean fix (from AUTH-8566):** leave `moduleResolution` **unset** (don't use `"node"` *or*
`"node10"` — both deprecated) and use **no `baseUrl`** → zero deprecation suppression needed. That's
the config the shared base should ship; empirically validated on a tsc-built CJS repo.

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

### F11 🟡 — Design pod scope-gating is correct interactively, but the non-interactive default is unclear
**Symptom (positive core).** On `/sdlc:run 8568` (`bee-auth-web`, a Next.js *scaffold* task), the
orchestrator did **not** blindly fire the `sdlc-ux` design pod just because the repo is a frontend/UI
repo. It **detected the scaffold-vs-UI scope mismatch** ("minimal shell" scope, functional-only DoD)
and surfaced a choice — *Skeleton only (`ui:false`, skip jury) [recommended]* vs *Full design pod* —
recommending skeleton-only. This is exactly the smart gating I feared it lacked: the pod is reserved
for real UI surfaces, not empty scaffolds. **Good behavior — validated.**
**Open question (the finding).** The decision was resolved by an **interactive prompt**. In
**`/sdlc:sprint` / headless** mode the orchestrator can't ask — so what is the default for a
frontend-repo item whose scope reads as a scaffold? If it silently falls back to firing the full pod,
a batched sprint could burn a large design-pod run on an empty shell (esp. relevant for 8569 admin
scaffold, and any future scaffold story). If it defaults to skeleton-only, that should be stated.
**Proposed modification.** Make the ui-detection / design-pod trigger deterministic and documented:
(a) a scope signal (scaffold/skeleton items → `ui:false` by default even in UI repos), and
(b) an explicit non-interactive default in `sdlc:run` §2 + `sdlc:sprint`, so headless runs don't
guess. Keep the interactive prompt as the confirmation, not the only gate.

### F12 🟠 — stack-web tooling baseline has no Next.js overlay; every Next repo re-derives the same 4 workarounds
**Symptom.** Scaffolding `bee-auth-web` (AUTH-8568) required **4 config-level workarounds** to reconcile
the shared strict flat ESLint config (`@beelogical/dev-config` → typescript-eslint `strictTypeChecked`)
with `eslint-config-next` on **ESLint 10** + **Turbopack** + a `file:../` monorepo. Gates stayed green
and no rules were weakened, but the reconciliation was hand-authored per-repo:
1. **Duplicate `@typescript-eslint` plugin registration** — both the shared config *and*
   `eslint-config-next` register it → flat-config *"Cannot redefine plugin"* error. Dropped the
   redundant registration from the next config; kept our parser override (no coverage lost).
2. **`eslint-plugin-react` `settings.react.version:"detect"` crashes on ESLint 10** (relies on the
   removed `context.getFilename()`). Pinned `react.version` explicitly (`"19.2.7"`) to avoid the
   detection code path.
3. **Plain `.js/.cjs/.mjs` routed to the TS parser** — the default parser path crashed under ESLint 10.
   *(The one to scrutinize — could over-broaden the parser; reviewer to confirm it's benign.)*
4. **`turbopack.root` widened to the workspace parent** so Turbopack resolves the `file:../` sibling
   packages (dev-config + SDKs).
**Root cause.** The v0.10.0 tooling baseline template was validated on **plain-tsc backend/SDK** repos.
It has **no Next.js-specific overlay**. Next brings its own required tooling (`eslint-config-next`) and
bundler (Turbopack) that don't compose with a strict shared flat config out of the box on ESLint 10 —
so **every** frontend repo re-derives the same 4 fixes by hand (8569 admin will hit all four again).
**Proposed modification.** Ship a **Next.js tooling overlay** in `sdlc-stack-web/templates/tooling/`
(+ state it in the `nextjs` / `coding-standards-ts` skills): a ready `eslint.config.mjs` fragment that
composes `@beelogical/dev-config` + `eslint-config-next` with all four reconciliations **pre-solved**
(dedupe the typescript-eslint plugin, pin `react.version`, parser mapping for `.js/.cjs/.mjs`,
`turbopack.root` for monorepo `file:../`). **Pin `eslint-config-next` / `eslint-plugin-react` to
ESLint-10-compatible versions** (workarounds #2/#3 are ESLint-10 breakages the ecosystem hasn't fully
absorbed) — Context7-verify the exact pins at implementation time (per the "verify vs registry, not
memory" lesson). Sibling of F9 (boundary config) + F10 (base tsconfig) — template-completeness for the
Next flavor.
**Positive to note.** The orchestrator's **transparency** — surfacing exactly what went unreviewed and
why, at the merge gate — is the economical cadence working as designed. The on-demand reviewer was then
summoned at a genuine judgment moment (first time this dogfood), which is the intended trigger.
**Reviewer confirmation (AUTH-8568).** The on-demand reviewer verified via `eslint --print-config` that
all 4 workarounds **preserve full lint coverage** (109 `@typescript-eslint/*` rules + react-hooks +
jsx-a11y + `@next/next` all active) and are AC-compliant *wiring* fixes, not divergent rules —
including workaround **#3** (`.js/.cjs/.mjs` → TS parser), which is therefore **benign**. So the F12
overlay we ship can safely encode all four. Workaround **#4** (`turbopack.root` breadth) is inherent to
`file:../` siblings-under-parent and not cleanly narrowable today — the overlay should ship it with a
"revisit as the workspace matures" note.
**Carried-lore reuse validated (AUTH-8569).** The admin scaffold reused all 4 workarounds + the
`env.ts` guard + every config file **verbatim** from bee-auth-web (only the port/package/clientId/route
differed) — **no re-derivation**. So *within an epic* the orchestrator's carried lore self-mitigates
F12: the second Next repo doesn't rediscover the fixes. **But** the lore is **epic-run-scoped memory**,
not persistent — a fresh Next repo in a different epic/project (or a cold start) would re-derive from
zero. So F12's fix still stands, refined to: **make the lore persistent** by shipping the overlay in
`sdlc-stack-web/templates/tooling/` (a template survives across epics/projects; run-scoped memory does
not). In-epic *urgency* downgraded; the durable fix is unchanged.

### F13 🟡 — `ux.renderBaseUrl` isn't synced to the scaffold's actual dev-server port (jury renders the wrong server)
**Symptom.** `sdlc.config.json` → `repos[bee-auth-web].ux.renderBaseUrl` = `http://localhost:3000`, but
the scaffolded web app runs on **:3100** (the scaffold picked :3100 to avoid colliding with the API on
:3000). :3000 is in fact the **API repo's** port — so when the deferred Epic 2 design-pod UX story runs,
the jury would render against the **API** (JSON / 404), not the web UI, and silently score the wrong
thing (or fail to render).
**Root cause.** `init` defaults `ux.renderBaseUrl` (to :3000); the scaffold **independently** chooses the
repo's dev-server port; nothing reconciles the two, and there's no cross-repo port-collision check.
**Proposed modification.**
- When the scaffold assigns a UX repo's dev-server port, **write it back to `ux.renderBaseUrl`** (the
  scaffold owns the port, so it should own the config value) — *or* have the design pod/jury resolve the
  render URL from the repo's actual `dev` script / `package.json` at render time rather than a static
  config default.
- `init` (UX repos): derive/ask the dev port instead of defaulting to :3000, and **flag collisions**
  (here `renderBaseUrl` :3000 collides with the API repo's port).
- **Watch on AUTH-8569 (admin):** likely the same default :3000 `renderBaseUrl` vs its own dev port —
  confirm whether it replicates.
**Replication confirmed (AUTH-8569).** Admin runs on **:3001** (web on :3100, api on :3000) — three
different scaffold-chosen ports, none reconciled with `ux.renderBaseUrl` (default :3000 = the API).
So F13 is systemic, not a one-off: every UX repo picks its dev port ad-hoc and nothing writes it back
to config. Reinforces the fix — scaffold owns the port, so scaffold should write `ux.renderBaseUrl`.

### F14 🟡 — Scaffolded `.gitignore` doesn't harden `.env*` (secret-hygiene gap across every repo)
**Symptom.** The epic security consolidation (AUTH-8416) flagged that `bee-auth-web`, `bee-auth-admin`,
**and** `bee-auth-api` `.gitignore` should be tightened to ignore `.env*` with a `!.env.example`
allow-exception (defense-in-depth — no live leak, but the pattern wasn't there by default). Flagged
across all three code repos ⇒ template-level, not a one-off.
**Root cause.** The tooling/structure scaffold doesn't ship a hardened `.gitignore` (or ships a
framework default that only covers `.env*.local`), so secret-bearing env files aren't robustly ignored
by default — a real concern for **auth/identity** repos.
**Proposed modification.** Ship a hardened `.gitignore` in the scaffold (stack-web tooling template)
that ignores `.env*` and re-includes `!.env.example` (alongside the usual `node_modules`/`dist`/
`coverage`/`.next`). **Verify what the template currently emits before writing the fix** (don't assume,
per the registry-vs-memory lesson). Sibling of F9 (boundary config) — scaffold-template completeness.
**Positive corollary.** The per-epic security pass **caught** this — the layered model (scaffold +
epic-time security audit) compensated for the template gap rather than shipping it silently.

### F15 🟠 — Cross-repo re-decomposition (F1 path) drops requirements + orphans superseded originals; tracker never reconciled to ground truth
**Symptom.** A manual **ground-truth audit** (disk + git log + run files vs the ADO board), run after
Epic-1 "close," found four kinds of drift:
- **(a) Requirement silently dropped.** When 8416's cross-repo story was decomposed into per-repo
  children 8564–8570, the **husky-hooks AC of the original task 8418 was not carried into any new
  child** and was never delivered (no `.husky/`, no `prepare` script, no husky dep in *any* of the 6
  repos). Only caught out-of-band by the manual audit.
- **(b) Superseded originals orphaned.** The original sibling tasks **8417 / 8418 / 8419** (replaced by
  the 8564–8570 re-decomposition) were left **"New"** on the board — never linked, superseded, or
  closed — even though 8417 (create repos) and 8419 (Docker Compose: PG16.4/Redis7.4/volumes/
  healthchecks) are verifiably done.
- **(c) Parent status didn't persist / wrong tier.** 8416 (a **Story**, per F1 — not an Epic) showed
  **"Development in Progress"** on the board despite all 4 ACs being met and this terminal reporting
  *"epic → Closed."* The close either didn't persist or the close-flow didn't target the Story-typed
  umbrella (it likely assumed the decomposable parent is an Epic).
- **(d) No drift detection.** Nothing in the pipeline reconciles tracker state against what was actually
  built — the user had to do it entirely by hand.
**Root cause.** The F1 run-time decomposition creates children but has **no AC coverage-mapping**
(original ACs → new children, with uncovered ACs flagged), **no reconciliation** of the originals it
supersedes (link + transition), and **no post-hoc verification** that transitions persisted / that the
board matches reality. Requirements leak and the board silently diverges.
**Proposed modification.**
- **Decomposition (extend F1):** emit an explicit **AC coverage map** old→new and **flag any original AC
  not covered** by a child (husky would have been caught at decompose time); **link + close/supersede**
  the original tasks being replaced (don't leave them "New"). **Use `Removed` (superseded) state, not
  `Closed`** — the originals were never worked *as themselves* (their scope was re-tracked under the new
  children), so closing them double-counts throughput (10 "done" scaffolding tasks vs the 7 actually
  delivered). Link each Removed original to its delivering children; if a carved-out AC (e.g. husky)
  moved to a *new* follow-up, link that too. **State availability is process-dependent (F7 echo):** this
  board's **Task** type has **no `Removed` state** (only `Closed` is terminal), so the reconciliation
  must **probe the process's available terminal states and adapt** — prefer `Removed`, else fall back to
  `Closed` + a superseded comment; it must NOT hard-code `Removed`. (Live: 8417/8418/8419 → `Closed` +
  "superseded; delivered under 8564–8570; husky → AUTH-8667". Leaving them `New` was rejected because
  the pipeline's `query()` would resurface delivered work as "ready" and risk re-running it.)
- **Ground-truth reconciliation step** in `/sdlc:status` (and at epic/story close): verify tracker
  status against run files + git + disk and report drift — the exact audit done here by hand.
- **Verify transitions persisted** (reported success ≠ board state) and make close **tier-aware** (a
  Story-as-umbrella like 8416 must itself be transitioned; don't assume the parent is an Epic).
**Severity 🟠** (silent requirement loss + board drift; a correctness gap in the decompose/close flow,
mitigated only by a manual audit — arguably 🔴 precisely *because* it was silent). Extends F1.
**Project-side (not plugin):** husky+lint-staged carved out to a high-priority follow-up task (wire in
`@beelogical/dev-config` `prepare` → inherited by all repos); 8418 closed with a linked carve-out note;
8417/8419/8416 reconciled to done.

### F8 🟡 — Poly: control-plane-targeted items have no `repos[]` entry to route to
**Symptom.** Task 8570 (workspace README) targets the **control plane**, which isn't a declared repo,
so routing is deferred to run time.
**Root cause.** Poly routing resolves to a `repos[]` entry; genuinely workspace-level work (README,
cross-repo docs) has no such target.
**Proposed modification.** Recognize a first-class **`control-plane`** routing target in `sdlc:run`
§2.5 for workspace-level items, so they resolve deterministically instead of ad-hoc.
**Resolved live (AUTH-8570) — behavior OK, fix still warranted.** At run time the item routed to the
**control-plane repo** (the `D:\Authentication` root), branched `task/AUTH-8570-workspace-readme`, and
merged via the *same* local `--no-ff` gate — it did **not** error on the missing `repos[]` entry. But
it did so through a **logged run-time assumption** ("control-plane routing special-case," 1 of 5
assumptions on the run), i.e. ad-hoc, not first-class. So F8's behavior didn't break; the fix
(formalize `control-plane` as a routing target) is confirmed as **polish, not a blocker**.

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
- ✅ **Run-state resume (checkpoint/resume) — validated on a real interruption (AUTH-8567):** the
  implementer hit an environment session limit right before committing; recovery re-ran the suite,
  committed the scaffold, smoke-tested, and finished docs **without re-authoring code** — the run
  file carried enough state to resume cleanly. Core resilience feature confirmed on a live cut-off.
- ✅ **On-demand reviewer earns its keep (v0.13.0) — validated on AUTH-8568 (first invocation of the
  dogfood):** summoned at a genuine trigger (4 config workarounds flagged at the merge gate), it did
  **not** rubber-stamp — it independently re-ran the gates, proved via `eslint --print-config` that the
  workarounds didn't silently drop lint coverage (the exact risk), confirmed AC compliance, and
  surfaced 2 real MINORs (one a genuine empty-env-string crash footgun in `lib/env.ts`) + 1 NIT with
  correct BLOCKER/MAJOR-only gating. This validates the whole economical model: reviewer spent only
  when triggered, and worth it when it is. (env.ts MINOR fixed in a project fix-cycle before merge —
  project code, not a plugin finding.)
- ✅ **On-demand reviewer skips correctly on routine work (v0.13.0) — validated on AUTH-8569 (the
  *other* direction of the cadence):** where 8568 *spent* the reviewer on genuine novelty (4 new config
  deviations), 8569 was a **verbatim mirror** of the already-approved bee-auth-web (only port/package/
  clientId/route differed, green dev-smoke on both routes), so a fresh review was correctly **skipped**
  — the mechanical diffs are fully covered by the deterministic gates, and admin authz is deferred to
  the epic security pass. Spend-when-novel + skip-when-routine both observed ⇒ the economical model
  earns its keep in both directions, not just one.
- ✅ **Design-pod scope-gating (v0.2.1 ux) — validated on AUTH-8568:** on a Next.js *scaffold* task
  the orchestrator did NOT auto-run the full design pod; it detected the scaffold-vs-UI scope mismatch
  and recommended skeleton-only (`ui:false`, skip jury), reserving the pod for real UI surfaces. The
  only gap is the *non-interactive* default (logged as F11) — the interactive behavior is correct.
- ✅ **Dependency policy (v0.12.0) — verified live against the npm registry (2026-07-12):** the
  `bee-auth-dev-config` scaffold (AUTH-8564) pinned current, mutually-compatible versions — eslint
  10.7.0, @eslint/js 10.0.1, typescript-eslint 8.63.0, @types/node 26.1.1, prettier 3.9.5,
  eslint-config-prettier 10.1.8 — and, crucially, TypeScript **6.0.3 instead of the latest 7.0.2**,
  because `typescript-eslint@8.63` caps TS at `<6.1.0` and no tseslint 9 exists yet. "Latest stable
  **and** compatible" worked, including the non-obvious compat call. (Note to self: verify versions
  against the registry, not training memory — nearly logged a false finding here.)

- ✅ **Per-epic security consolidation (v0.13.0) — validated end-to-end on the AUTH-8416 close (the last
  unobserved cadence behavior):** the `securityConfirm` gate was honored (it **asked** before running,
  not silent); it reviewed the **combined 6-repo scaffolding diff coherently** (a real consolidation,
  not per-item); returned **APPROVE — 0 blocker / 0 major** with proportionate real findings (placeholder
  auth **fails closed**, AC2 env validation confirmed **fail-loud**, **no committed secrets**, Docker
  **binds loopback-only**) + 3 non-blocking follow-ups (postcss transitive-XSS override; `.gitignore`
  `.env*` hardening → F14; a future admin-route-guard AC). Right **depth for scaffolds** — light but not
  empty. Confirms per-epic timing + confirm-first is well-placed; real findings will scale when Epic 2
  adds actual auth logic. The 3 follow-ups were **surfaced, not auto-filed** (filed on user confirmation)
  — correct confirm-first behavior for creating work items.
- ✅ **Layered dependency defense — add-time + epic-time together caught a *transitive* vuln:** `dep-vet`
  (v0.12.0) vets packages at **add** time and structurally can't see a vuln buried in a framework's
  transitive tree (moderate XSS via `postcss` under `next@16`, a direct dep of neither repo). The
  **epic security audit caught it.** Validates the *two-layer* model (install-time policy **and**
  periodic audit), not install-time policy alone.

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
- 2026-07-12 — AUTH-8565 (api) + 8567 (sdk-next) + 8566 (sdk-nest) done; rollup 4/7. Added F9
  (scaffold omits dependency-cruiser config, now confirmed across 3 repos), F10 (state strictness-only
  base in skills). Validated: run-state resume (8567 mid-run recovery), dependency policy. 8566
  proved F10's clean fix (moduleResolution unset + no baseUrl = zero suppression). Next: the two UX
  frontends (8568/8569) — first exercise of the design pod on a scaffold.
- 2026-07-12 — AUTH-8568 (web) merge gate: gates green (lint/type/build, 3 routes 200) but the
  implementer needed **4 config workarounds** to compose our strict shared flat ESLint config with
  `eslint-config-next` + ESLint 10 + Turbopack + `file:../` monorepo → logged **F12** (ship a Next.js
  tooling overlay so every frontend repo doesn't re-derive them; 8569 will hit the same). Recommended
  running the on-demand **reviewer** on the 4 deviations before merge (first reviewer invocation of the
  dogfood — a genuine, non-routine trigger). Reviewer verdict will sharpen F12 (esp. workaround #3).
- 2026-07-12 — AUTH-8568 reviewer verdict: **APPROVE / mergeable** (0 BLOCKER, 0 MAJOR, 2 MINOR, 1 NIT).
  Proved all 4 workarounds preserve full lint coverage via `eslint --print-config` (#3 benign) → F12
  confirmed safe to templatize. Logged the reviewer as a **validated positive** (didn't rubber-stamp;
  found a real empty-env-string footgun in `lib/env.ts`). Chose to fix `env.ts` in a project fix-cycle
  before merge (reference pattern that will propagate to 8569+); left `turbopack.root` breadth as an
  F12-tracked note (not cleanly narrowable). env.ts fix = project code, not a plugin finding.
- 2026-07-12 — AUTH-8568 (web) design-pod decision point: orchestrator correctly detected scaffold
  scope and recommended **skeleton-only** (design pod reserved for real UI surfaces). Chose skeleton-
  only. Logged F11 (non-interactive default for the ui:true-repo + scaffold-scope fork is unclear —
  matters for sprint/headless and for 8569) and a matching positive validation. Design pod itself
  still unobserved end-to-end — the honest place to characterize it is an Epic 2 real login-UI story,
  not an empty shell.
- 2026-07-12 — AUTH-8568 **DONE / merged** (`--no-ff` 74493ab, branch deleted, ADO → Closed, rollup
  **5/7**). env.ts empty-string fallback hardened in the fix-cycle; reviewer APPROVE, full lint coverage
  intact. From the completion follow-ups, logged **F13** (`ux.renderBaseUrl` :3000 ≠ app-on-:3100, and
  :3000 is the API's port → jury would render the wrong server; scaffold-port vs config not reconciled).
  Notable: orchestrator claims it carried the Next.js-app "lore" (the 4 workarounds) into the epic
  rollup so **8569 won't rediscover it** — a claim to test directly on 8569 (does it reuse, or
  re-derive? bears on F12 severity). Next: **8569 (admin, Next twin of 8568)**, then **8570**
  (control-plane README — the F8 case).
- 2026-07-12 — AUTH-8569 (admin) merge gate: **verbatim mirror** of reviewer-approved bee-auth-web (only
  port :3001 / package / clientId / `/dashboard` route differed), gates green incl. dev-smoke both
  routes. **Carried lore worked** (no re-derivation) → updated F12 (in-epic self-mitigation confirmed;
  durable fix = persistent template overlay, not run-scoped memory). **F13 replication confirmed**
  (admin :3001, three unreconciled ports). Chose **merge without a fresh reviewer** — routine
  verbatim mirror, nothing novel to judge → logged as a validation of the on-demand cadence's
  *skip-when-routine* direction (complements 8568's spend-when-novel). → rollup **6/7**. Last: **8570**.
- 2026-07-12 — **AUTH-8570 done + Epic AUTH-8416 CLOSED (7/7) — Epic 1 (scaffolding) complete.** 8570
  (workspace README) merged (`--no-ff` 035775f) → **F8 resolved** (routed to the control-plane repo via
  a logged run-time assumption; behavior OK, formalize-fix downgraded to polish). Epic-close **per-epic
  security consolidation** ran (user-confirmed): APPROVE, 0 blocker/0 major over the combined 6-repo
  diff → logged as a **major validation** (last unobserved cadence behavior) + a **layered-dep-defense**
  validation (caught transitive postcss XSS that add-time vetting can't see). New finding **F14**
  (scaffold `.gitignore` should harden `.env*`). 3 project follow-ups (postcss override + `.gitignore`
  → one maintenance task; admin-route-guard → auth-epic note) advised to file in ADO. **Findings now
  F1–F14.** Next: cross-check ADO tier/ID alignment (separate terminal), then plan the F1–F14 batch.
- 2026-07-12 — **Ground-truth audit (disk + git + run files vs board) after Epic-1 close** surfaced
  real drift → new finding **F15** (F1 re-decomposition drops requirements + orphans originals + board
  drift). Verified: the 7 re-decomposed children (8564–8570) are **genuinely done**; BUT the **husky
  AC of original task 8418 was silently dropped** (wired in zero repos), originals **8417/8418/8419
  left "New,"** and **8416 (a Story) showed "Development in Progress"** despite our "epic→Closed"
  report. Advised: husky → **high-priority follow-up task** (via dev-config); **close 8418 with a
  linked carve-out note** (don't false-close); **reconcile 8417/8419/8416 → done** with "delivered
  under 8564–8570" comments. **Correction to prior entry:** Epic-1 scaffolding is delivered *modulo*
  the husky follow-up + tracker reconciliation — not the clean 7/7 the board+report implied. **Findings
  now F1–F15.** The manual audit itself is the evidence for F15's "add a ground-truth reconciliation
  step" fix.
