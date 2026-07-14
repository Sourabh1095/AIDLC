# SDLC Plugin — Dogfood Findings ARCHIVE — Cycle 1 (Authentication / Identity Platform, Epic-1 scaffolding)

**CLOSED ARCHIVE (F1–F16).** Historical design record only — do not add new findings here; log those in
`dogfood-findings.md`. Cycle ran 2026-07-11 → 2026-07-12.

> **✅ F1–F16 BATCH IMPLEMENTED — 2026-07-12** (branch `feat/dogfood-f1-f16-batch`). All sixteen
> Epic-1 findings were designed + implemented together through the branch → version → merge flow.
> Version bumps: `sdlc` 0.13.1 → **0.14.0**, `sdlc-stack-web` 0.7.1 → **0.8.0**, `sdlc-ux` 0.2.1 →
> **0.3.0**, marketplace → **0.14.0**. See the CHANGELOG for the per-finding change list. The findings
> below are retained as the design record. Next dogfood cycle (Epic 2, design pod) runs on the updated
> plugin and serves as the regression test for this batch.

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
- **(c) Parent status didn't persist — CONFIRMED cause: silent write failure.** A prior session
  recorded 8416 → Closed at **07:10Z in the run file**, but the ADO transition **never persisted** (a
  flaky `az.cmd` write that returned without error), so the board still showed **"Development in
  Progress."** Not a tier miss — the close *targeted* 8416; the *write* silently failed and nothing
  read it back to notice. This is the concrete mechanism, now split out as **F16** (write verification).
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
  board's **Task** type has **no `Removed` state** (only `Closed` is terminal) — whereas `Removed` *does*
  exist for **User Story**. So state availability is **per-work-item-type, not just per-process**: the
  reconciliation must **probe the available terminal states for that item's type and adapt** — prefer
  `Removed`, else fall back to `Closed` + a superseded comment; it must NOT hard-code `Removed`. (Live: 8417/8418/8419 → `Closed` +
  "superseded; delivered under 8564–8570; husky → AUTH-8667". Leaving them `New` was rejected because
  the pipeline's `query()` would resurface delivered work as "ready" and risk re-running it.)
- **ADO can't retype a work item via REST** — so any reconciliation/restructure fix (here, and the F1
  decompose path) must **create-new + link + supersede** or use an **umbrella-Story** structure, never
  "convert" an existing Task into a Story. (Live: husky Task 8667 stayed a Task under a new umbrella
  Story 8669 rather than being converted.) Also: the **AC field is Story-tier**, not Task-tier — the
  `updateAC` op must write ACs to the Story (Tasks only carry them in the description).
- **Ground-truth reconciliation step** in `/sdlc:status` (and at epic/story close): verify tracker
  status against run files + git + disk and report drift — the exact audit done here by hand.
- **Verify transitions persisted** (reported success ≠ board state) and make close **tier-aware** (a
  Story-as-umbrella like 8416 must itself be transitioned; don't assume the parent is an Epic).
**Severity 🟠** (silent requirement loss + board drift; a correctness gap in the decompose/close flow,
mitigated only by a manual audit — arguably 🔴 precisely *because* it was silent). Extends F1.
**Project-side (not plugin):** husky+lint-staged carved out to a high-priority follow-up task (wire in
`@beelogical/dev-config` `prepare` → inherited by all repos); 8418 closed with a linked carve-out note;
8417/8419/8416 reconciled to done.

### F16 🟠 — Tracker transitions can silently fail; the adapter doesn't read-back-verify (durable record ≠ board)
**Symptom.** A prior session stamped 8416 → Closed in the run file at 07:10Z and moved on, but the ADO
transition **never landed** — a flaky `az.cmd` write returned without surfacing an error. The board sat
at "Development in Progress" while the pipeline's durable state said Closed. Nothing caught it until a
manual ground-truth audit; it was the concrete cause of F15(c).
**Root cause.** `wi-ado`'s `transition` (acutely via the `az boards` CLI fallback) can fail silently —
the mutation appears to succeed, the run file records success, but the board is unchanged. There is **no
read-back verification** of writes, so the pipeline trusts a record that has diverged from reality.
**Proposed modification.** Adapter write ops — **`transition` at minimum, ideally every mutation
(`comment`/`link`/`updateAC`/`create`)** — must **fetch the item back and assert the change landed**
before recording success (verify state == target / field present / item exists). On mismatch: retry,
then **surface a hard error** instead of silently stamping success. **Tolerate eventual consistency:**
an immediate read-after-write can transiently show stale/`None` (observed live during the 8415
reconciliation — mid-script `parent==None` flags that an authoritative batch re-fetch then showed
correct and stable). So the verification must **retry with a short backoff / re-fetch authoritatively**
before declaring failure — *not* hard-fail on the first mismatch (that would trade silent-success for
false-failure). State this in the adapter contract (`work-items` skill) so it binds all trackers, not
just ADO — any tracker write can fail; the `az.cmd` fallback just makes it likely. **Prevention** pairs with F15's ground-truth reconciliation
(the **detection** safety net). Severity 🟠 — silent state divergence in an autonomous pipeline, where
every downstream decision trusts the durable record (arguably 🔴 for exactly that reason).
**Positive corollary.** The project session already added a "verify writes with a read-back" note +
corrected the stale "Task has a Removed state" memory — the right instinct; F16 makes it a plugin-level
contract rule, not a per-project habit.

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
- 2026-07-12 — **Board reconciled to ground truth** (169-item tree audited; only 8416's subtree was
  wrong, 8420+ legitimately New). 8416 → Closed; 8417/8418/8419 → Closed + superseded comments (linked
  to delivering children 8564–8570; husky → new task **AUTH-8667**, P3); 8667 to be reparented under
  **Feature 8415** (open task shouldn't hang off a closed story). **Confirmed F15(c)'s mechanism →
  split out as F16:** the 07:10Z 8416-close was recorded in the run file but the `az.cmd` write
  **silently failed** and was never read back → board diverged. Refined F15 (state availability is
  per-item-**type**: `Removed` on User Story, not Task). Advised creating the 3 security follow-ups
  (postcss + `.gitignore` = one hardening task under 8415; admin-route-guard = note-to-promote on the
  auth story-to-be). **Findings now F1–F16.** Scaffolding phase genuinely closed. Next: plan the
  F1–F16 batch (+ the pending ADO tier/ID cross-check if it surfaces anything).
- 2026-07-12 — **Reconciliation follow-ups landed + read-back-verified; scaffolding phase truly closed.**
  Under Feature 8415: new Story **8669** "Foundation tooling & hardening" (P2) with ACs, parenting Task
  **8670** (postcss override + `.gitignore` `.env*` hardening) and the reparented husky Task **8667**
  (P3) — tiers correct (Feature→Story→Task), nothing hangs off closed Story 8416. Admin-route-guard →
  grooming-flag comment + tag on **Epic 8444** (not a task). **The ADO tier/ID cross-check is effectively
  complete: tiers were modeled correctly all along** (8416 is a Story, children are Tasks — deliberate
  per F1); the only problems were **status drift (F16 silent write) + decomposition gaps (F15)**, not
  ID/tier confusion. **F16 validated in the field** — the read-back caught transient `parent==None`
  read-after-write lag that a batch re-fetch resolved → refined F16 to require *eventual-consistency-
  tolerant* verification (retry/backoff, not hard-fail-on-first-mismatch). Refined F15 with two ADO
  constraints (no REST retype → umbrella-Story/create-new; AC field is Story-tier). Terminal A (original
  `/sdlc:run`) retired as stale; accurate state lives on the board + run files + terminal B. **Findings
  F1–F16 stable. Discovery phase done — next conversation: plan the batch.**

---

# SDLC Plugin — Dogfood Findings ARCHIVE — Cycle 2 (Authentication / Identity Platform — remote/PR + CI + poly shared-config)

**CLOSED ARCHIVE (F17–F33).** Historical design record only — do not add new findings here; log those in
`dogfood-findings.md`. Cycle ran 2026-07-12 → 2026-07-14.

> **✅ F17–F33 BATCH IMPLEMENTED — 2026-07-14** (branch `chore/dogfood-cycle2-f17-f33`, merge `5212bbb`,
> 3 commits: `feat(stack-web)` / `feat(sdlc)` / `chore(release)`). All seventeen findings were designed +
> implemented together through the branch → version → merge flow. Version bumps: `sdlc` 0.14.0 →
> **0.15.0**, `sdlc-stack-web` 0.8.0 → **0.9.0**, `sdlc-ux` unchanged (**0.3.0**), marketplace →
> **0.15.0**. See the CHANGELOG `[0.15.0]` entry for the per-finding change list. This cycle came from
> first exercising the **remote/PR** integration path (the six `bee-auth-*` repos flipped to
> `git.mode: remote`), real Azure CI, a poly shared-config (`bee-auth-dev-config`, `file:../`-consumed)
> pattern, and the first security-critical design phase (AUTH-8425/8426 OIDC). F26/F27 were verified in a
> real eslint9 + dependency-cruiser@17 harness (F27 proven load-bearing; F26 shipped as a
> robustness/explicitness fix since depcruise 17.4.3 defaults already resolve `exports` maps). The
> findings below are retained as the design record.

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
