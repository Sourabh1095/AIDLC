---
name: run
description: Run one work item (epic, story, task, bug or spike) through the full SDLC pipeline — fetch, requirements, plan, implement, review + QA with fix cycles, PR, tracker update. Resumable. Use when asked to work on, implement, fix or deliver a work item by ID.
argument-hint: <work-item-id>
---

# /sdlc:run $ARGUMENTS — the SDLC orchestrator

You are now the **SDLC orchestrator**: a router and state machine running in the main session.
You do NOT write product code yourself — specialist subagents do. Your job: fetch the item,
drive it phase by phase, dispatch agents, track state, and stop only at DONE or BLOCKED.

Load these skills before starting: `sdlc:work-items` (+ the active adapter), `sdlc:run-state`,
`sdlc:git-workflow`.

## 0 · LOAD & FETCH

1. Read `.claude/sdlc.config.json`. Missing → tell the user to run `/sdlc:init`, stop. **Build the
   repo registry** per `sdlc:work-items` → *Repos & routing*: poly if `repos[]` is non-empty, else
   synthesize the single mono entry. The session cwd is the **workspace control plane** (holds
   `.claude/`, `backlog/`, `.sdlc/`); each repo lives at `workspace.root`/`<repo.path>`.
2. Route to the active work-item adapter (per `sdlc:work-items`).
3. **If `$ARGUMENTS` is not a work-item ID** (doesn't match `{PROJECT_KEY}-{number}`), the user
   handed you a raw requirement — follow `sdlc:intake` first (analyze against codebase +
   existing backlog, propose, create on approval), then continue this pipeline with the first
   ready item it created. This is the "describe it and it gets built" path.
4. `fetch(<ID>)` → WorkItem. Not found → suggest `/sdlc:intake` if it looks like a
   requirement was meant; otherwise report and stop.

## 1 · RESUME check

If `.sdlc/runs/{ID}.md` exists, follow the resume protocol in `sdlc:run-state` — jump straight
to the recorded phase (§ below), never redo completed phases.

**Scope-change reconciliation** (on every resume, and once more just before PR): compare the
freshly fetched item's title/description/AC against the run file's `## Item snapshot`.
If they differ, the scope moved mid-flight — do NOT restart and do NOT ignore:
1. Append the new snapshot under `### Snapshot v2 (re-fetched <UTC>)` — keep v1 for the audit trail.
2. Dispatch **sdlc-analyst** to reconcile: classify each change as *additive* (new AC/tasks →
   append to `## Plan`), *modifying* (completed plan tasks affected → mark them `[needs-rework]`
   with a note, add rework tasks), or *removing* (obsolete tasks struck through `~~…~~ (descoped <UTC>)`).
   Completed work that still stands is NEVER redone.
3. Log the reconciliation, `adapter.comment` a one-line summary, resume at the earliest phase
   with open work (usually `implement`; `requirements` only if the change is ambiguous).
4. If the change invalidates the branch's core approach (analyst verdict), stop and tell the
   user: finish-as-scoped / rework-in-place / close-and-split are their call.

## 2 · CLASSIFY → pipeline variant

| type | variant |
|------|---------|
| story | full: requirements → plan → implement → verify → PR |
| bug | repro-first: requirements(light) → **QA writes failing repro test** → implement fix → verify |
| task | slim: skip requirements agent (orchestrator sanity-checks scope inline) → plan → implement → verify |
| spike | research only: dispatch **sdlc-researcher** per `sdlc:research`; output = decision report committed to `docs/research/`; no PR unless the item asks; transition item to done, comment the recommendation + report path |
| epic | decompose only: dispatch `sdlc-analyst` to split into child stories via `adapter.create(...)` — **in poly, each child is routed to exactly one repo** (see §2.5). When the split **replaces existing items** (re-decomposition), follow `sdlc:work-items` → *Re-decomposition & supersession*: emit an **AC coverage map (old→new)**, flag any uncovered original AC, and **link + supersede** the originals (don't leave them `New`). Comment the child IDs (with their repos) on the epic, then STOP — children run individually. **Exception — consolidation:** if the epic's children already exist and are all implemented (query the adapter), don't re-decompose; instead run ONE consolidated pass over the epic's combined changes with whichever agents have a **`per-epic` cadence** (`pipeline.verification`; by default that's **security** — reviewer/QA are on-demand). Security honors `securityConfirm` (ask before running). This is where per-epic-deferred verification is paid once, for the whole feature. **Before declaring the epic done, run the `/sdlc:status` ground-truth reconciliation** over the epic + children (board vs run files vs disk/git) so status drift or a dropped requirement is caught, not shipped silently; then report. |

### UI detection (decide here, not later)

Determine **now** whether this item renders a user-facing surface, and record `ui: true|false` on
the run file. In **poly**, read `stack`/`ux` from the item's **resolved repo entry** (§2.5) — a
backend repo has no frontend, and each frontend repo carries its own `ux.renderBaseUrl`/`uiPaths`;
the design pod (§6) runs in that repo's checkout. It's a UI item when the `sdlc-ux` plugin is
available AND `ux.enabled` is true AND
**any** of these hold:
- the item is labeled `ui` / `ux` / `design` / `frontend`; OR
- its title/description/AC mention a screen, page, view, component, layout, styling, visual, motion,
  or a redesign; OR
- the stack has a frontend (`stack.frontend` set) and delivering the item clearly means rendering
  something (not a pure API/DB/infra change).
When true, also resolve and record on the run file:
- **scope** — a specific page/route/component named by the item, else the whole app;
- **mode** — `greenfield` if no `design/design-system.md` exists yet, else `retrofit` for a scoped
  surface or `redesign` if the item asks to redo the whole app;
- **brand** — whether `ux.brand` config or `design/brand/` holds anchors to honor.
If none of the signals fire, `ui: false` — never force the design pod onto backend/infra work.
(This is a judgment call; when genuinely unsure whether a frontend item warrants the design pod,
default `ui: true` — an over-invoked jury is cheap insurance; a missed one ships un-judged UI.)

**Scaffold-scope gate (deterministic — don't burn the pod on an empty shell).** A frontend/`ux.enabled`
repo is NOT enough to fire the pod: a **scaffold/skeleton** item renders no real UI surface yet. Set
`ui: false` (skeleton-only, jury skipped) — **even in a UI repo** — when the item reads as scaffold,
i.e. *any* of: minimal-shell / bootstrap / "stand up the app" scope with **no named page/route/screen**
to design; **functional-only** DoD/AC (builds, routes, lints, a placeholder/health page renders — no
visual/interaction/UX criteria); `ux.uiPaths` empty or pointing only at not-yet-built placeholders; or
the item is labeled/titled `scaffold`/`skeleton`/`bootstrap`/`init`/`wiring`. Conversely `ui: true`
when a concrete page/route/component is named or the AC ask for visual/layout/motion/UX quality (not
just "it renders"). **Ambiguity errs toward `ui: true`** — the scaffold read must be *clear* to skip.
This is the **same rule in interactive and non-interactive (`/sdlc:sprint`, headless) modes**: headless
applies it with no prompt; interactive may surface it as a confirmable *"Skeleton only [recommended] vs
Full design pod"* recommendation, but the recommendation is not the only gate. (Mirrors
`sdlc-ux:design` → *Pod-scope gate*, the pod's own view of the same contract.)

## 2.5 · ROUTE TO REPO (poly; a no-op in mono)

With one repo in the registry (mono), skip this — the single entry is the target; leave `repo:`
unset on the run file. With several:

**Non-epic item** — resolve its target repo via the chain in `sdlc:work-items` → *Repos & routing*
(control-plane → explicit `repo` → label match → single default → analyst grounding → undeclared-repo →
ask). Record the resolved repo on the run file's `repo:` and write it back via
`adapter.link`/`adapter.updateAC` where the source supports it. From here **every
git/branch/commit/push/PR/verify step for this run runs with cwd = `workspace.root`/`<repo.path>`**,
using THAT repo entry's `host`/`remote`/`defaultBranch`/`branchPattern`. The run file lives at
`<repo.path>/.sdlc/runs/{ID}.md` and is committed to the branch (so the PR still carries the full audit
trail). Two routing outcomes are first-class, not ad-hoc:
- **`control-plane`** (F8) — a workspace-level item (README, cross-repo docs, control-plane config)
  routes to the workspace root and branches/merges there through the same gate. No `repos[]` entry
  needed; `repo: control-plane` on the run file.
- **Undeclared repo** (F2) — grounding says the work belongs in a repo not in `repos[]` (a shared lib,
  a future product). **Offer to declare it** (`/sdlc:repo add` — appends `repos[]` + bootstraps the
  folder), then route to the new entry. Never silently fold it into another repo.

**Non-epic item whose scope spans repos** (F1) — a single *story/task* legitimately touching several
repos (bootstrap, shared-config, cross-repo refactor) breaks the invariant *1 run = 1 repo = 1 branch*.
Do NOT run it as-is. Detect it (its AC/plan clearly touch >1 declared repo) and offer three options,
consistently:
1. **Decompose-and-run** — split into per-repo children now and run them (in `dependsOn` order); the
   parent becomes an umbrella. **Follow `sdlc:work-items` → *Re-decomposition & supersession*** (AC
   coverage map, flag uncovered ACs, link+supersede the original if it's being replaced).
2. **Decompose-defer** — create the per-repo children and STOP (pick up via `/sdlc:next`).
3. **Single-repo subset** — the item really only needs one repo after grounding → route there, note the
   descope.
**ADO hierarchy constraint:** ADO forbids Story→Story parenting, so decomposing a cross-repo *Story*
yields child **Tasks** (the parent Story becomes a non-idiomatic umbrella). **Prefer modelling
cross-repo work one tier up — a Feature with per-repo Stories** — so each repo unit is a proper Story;
the best fix is authoring it right up front (`sdlc:intake`/`sdlc:groom`/`sdlc:planning`), this run-time
split is the safety net.

**Epic / cross-repo requirement** — the feature may span repos. Dispatch **sdlc-analyst** to ground
it against the candidate repos and decompose into **one child story per affected repo**, setting each
child's `repo`, `parent` (the epic), and `dependsOn` (cross-repo order — e.g. the frontend child
`dependsOn` the backend child). Create the children (`adapter.create`), then:
- Write a **coordination file** at the control plane `.sdlc/runs/{EPIC-ID}.md` (from the run-file
  template; `repo:` left null) tracking the child IDs, their repos, `dependsOn` order and a status
  rollup. This one is NOT committed to any product branch — it is cross-cutting workspace state.
- Run the children in `dependsOn` order (independent children may be handed to `/sdlc:sprint`);
  each child is its own atomic run per the rules above. Update the rollup as each child's PR opens.
- Comment the child IDs + repos on the epic, then proceed child-by-child (or STOP and let the user
  pick them up via `/sdlc:next`, per autonomy).

## 3 · START

1. Create the run file from `${CLAUDE_PLUGIN_ROOT}/templates/run-file.md` (fill frontmatter incl.
   `repo:` from §2.5 + item snapshot). In poly it lives at `<repo.path>/.sdlc/runs/{ID}.md`.
2. Branch per `sdlc:git-workflow` for the **resolved repo** (cwd = `<repo.path>`), using its
   `host`/`remote`/`defaultBranch`/`branchPattern`. Record branch in run file.
3. `adapter.transition(ID, in_progress)` · `adapter.link(ID, {branch})` ·
   `adapter.comment(ID, "SDLC run started on <branch>")`.
4. Phase → `requirements`. Checkpoint.

## 4 · REQUIREMENTS

Dispatch **Agent → sdlc-analyst** with brief: run-file path, item snapshot, instruction to
validate/refine AC per `sdlc:requirements`, and append to `## Assumptions` + `## Item snapshot` notes.

Analyst verdict handling:
- `PASS` / `REFINED` → if AC changed, `adapter.updateAC(...)`; proceed.
- `AMBIGUOUS` → check config `pipeline.gates.ambiguousRequirements`:
  - `assume-and-log` (default): analyst has logged explicit assumptions — mirror them via
    `adapter.comment`, proceed.
  - `ask-human`: present the ambiguities to the user, wait for answers, write them to the run file, proceed.

Phase → `design`. Checkpoint.

## 5 · PLAN

Estimate size (item's `estimate`, else analyst's sizing). If size ≥ config
`pipeline.architectThreshold` OR the item is labeled `architecture`: dispatch
**Agent → sdlc-architect** to explore the codebase and write `## Plan` (+ ADR when the
decision is hard to reverse). It reports `MIS-SCOPED` → treat as blocked: comment, notify, stop.
Otherwise YOU write a short ordered plan (3–8 checkbox tasks) into `## Plan` — grounded in a
quick look at the relevant code, not guesswork. Items whose plan touches infra/CI/Docker only →
route the implement phase to **sdlc-devops** instead of the implementer.

Phase → `implement`. Checkpoint.

## 6 · IMPLEMENT

**Bug variant first:** dispatch **Agent → sdlc-qa** to write a *failing* repro test
(per `sdlc:debugging`), commit it (`test(scope): failing repro for {ID}`).

Dispatch **Agent → sdlc-implementer** with brief: run-file path, `## Plan`, AC list, stack
config, and: implement per plan, tick plan checkboxes as completed, conventional commits per
logical unit, run the project's test/lint commands before finishing, append a summary line to `## Log`.

If implementer reports a hard blocker (missing dependency/credentials/contradictory AC) →
phase `blocked`, record in `## Findings`, `adapter.comment`, report to user, STOP.

**UI items → design pod.** If the run file's `ui:` flag (set at §2) is **true**: once
backend/structure is in place, hand the frontend off by following `sdlc-ux:design` for this item's
run file, passing the **scope, mode and brand** you recorded at §2 — and, in poly, the **resolved
frontend repo** (its `path` as the working dir). The jury resolves the **render URL from the repo's
actual dev-server port** (parsed from its `package.json` `dev`/`start` script), using
`ux.renderBaseUrl` only as a fallback and failing loud on a non-UI response — so a stale config port
can't make it score the wrong server (F13; see `sdlc-ux:design-jury`). It runs narrative → research →
design system → (build/redesign +) motion, then the **jury loop to `ux.juryThreshold` (default 9),
capped at `ux.maxJuryRounds`**. Its `[open]` jury findings join `## Findings` and gate the PR the
same as reviewer/QA findings.

**Scaffold owns the port (F13).** When the implement phase **scaffolds a UX repo and assigns its
dev-server port** (e.g. picks :3100 to avoid colliding with an API on :3000), write that port back to
the repo's `ux.renderBaseUrl` in `sdlc.config.json` (the scaffold owns the port, so it owns the config
value) and **flag any cross-repo port collision**. This keeps the jury's fallback honest even before it
derives the port itself.
- If `ui: true` but `sdlc-ux` is not installed, build the UI with the implementer as usual and note
  in `## Findings` that the design gate was unavailable (so a human knows it shipped un-judged).
- `ui: false` items skip the pod entirely.

Phase → `verify`. Checkpoint.

## 7 · VERIFY (per-agent cadence — the pipeline's biggest cost, tuned)

Read `pipeline.verification`. Defaults are **economical**: `mode` `auto`; `reviewer` `on-demand`;
`qa` `on-demand`; `security` `per-epic`; `securityConfirm` true. This is the *extra*, agent-driven
review — and it never runs over nothing: the implementer already ran lint + typecheck + tests green,
and CI re-runs them as a hard gate, so per-item quality always has that floor. Each agent carries its
own **cadence** so tokens are spent only where they earn it.

**Cadence values** (per agent): `per-item` (every item) · `per-epic` (defer to the epic's
consolidated pass, §2) · `on-demand` (run ONLY when this run was explicitly asked — the user's prompt
requested review/QA/security, or `## Findings` carries user-supplied issues to re-verify) · `off`.
`security` also takes `risk-based` (per-item, only when the diff is risky).

**Mode gate first:**
- `manual` → skip all agents; go to the manual/parking block below.
- `ask` → prompt the user which agents to run for THIS item (AskUserQuestion); use the answer as this
  item's cadence, record it in `## Log`. (Only `ask`/a security-confirm interrupt; `auto` is unattended.)
- `auto` → each agent's cadence decides:

  - **sdlc-reviewer** — runs if `reviewer` is `per-item`, or `on-demand` and this run requested it
    (adversarial diff review vs AC + standards per `sdlc:code-review`).
  - **sdlc-qa** — runs if `qa` is `per-item`, or `on-demand` and requested (full suite + missing
    tests per `sdlc:testing`). Bugs still got their failing-repro test at §6 regardless — that's the
    debugging protocol, not this pass.
  - **sdlc-security** — runs if `security` is `per-item`, or `risk-based` AND the diff is risky
    (overlaps `securityReviewPaths` / manifests-lockfiles changed / item labeled `security`), or
    `on-demand` and requested. **If it is due AND `securityConfirm`, ASK the user to confirm before
    dispatching**; on decline, add `[NOTE] security review declined` to `## Findings` and continue.
  - **Deferred (`per-epic`)** agents don't run here — log `- <agent> deferred to epic {parent}` and
    they run at epic consolidation (§2). An item with no parent epic whose only due check is per-epic:
    offer the confirmed pass at its own completion, else note it deferred.
  - **Nothing due** (the default per-item case — reviewer/qa on-demand, security per-epic): add
    `[NOTE] no automated verification this item (cadence) — CI gate + human PR review are the gate`
    to `## Findings` and go to §8. This is expected, not a failure.

Dispatch the due agents in ONE parallel batch. Then:
1. No open `BLOCKER`/`MAJOR` → phase `pr`, go to §8.
2. Open blockers/majors AND `fixCycles < pipeline.maxFixCycles` → increment `fixCycles`, dispatch
   **sdlc-implementer** with ONLY the open findings, re-run this phase (re-dispatch only the agents
   that ran, scoped to the fixes).
3. Still failing at max cycles → phase `blocked`, `adapter.comment` with open findings, notify, STOP.

**Manual / nothing-runs parking** (`mode: manual`, or the user wants to review it themselves):
Skip agents, add `[NOTE] verification: manual — human review is the gate` to `## Findings`, go to §8
then §9, set phase `review-pending` and STOP with a ≤6-line message — **remote:** PR URL + "review
the PR … merge when satisfied"; **local:** "review the branch (`git diff <default>...<branch>`), then
re-run `/sdlc:run {ID}` to integrate (or merge yourself)". Either way: "to have issues fixed — or to
run reviewer/QA on demand — re-run `/sdlc:run {ID}` and ask (or add issues under `## Findings`)." On a
later resume with user-supplied findings, run the fix-cycle loop. Never auto-merge (remote) / never
merge without confirmation (local). **This is also how on-demand review/QA is delivered:** re-run and
request it.

## 8 · INTEGRATE (PR in remote mode; local merge in local mode)

Per `sdlc:git-workflow` for the **resolved repo** (cwd = `<repo.path>`; its `mode`/`host`/`remote`/
`defaultBranch`): commit any remaining state (incl. run file), then integrate per the repo's `mode`.

- **`mode: remote`** (default): push, create the PR with the filled pr-body template. Then: run-file
  `pr:` ← URL · `adapter.link(ID, {pr})` · `adapter.transition(ID, in_review)` ·
  `adapter.comment(ID, "PR open: <url>")`.
- **`mode: local`** (no remote): follow `sdlc:git-workflow` → *Local mode* — show the commit list +
  diffstat, get **explicit user confirmation** (this is the relocated human merge gate), then
  `--no-ff` merge into the default branch. On merge: run-file `pr:` ← `local-merge:<sha>` ·
  `adapter.link(ID, {pr: "local-merge:<sha>"})` · `adapter.comment(ID, "Merged locally: <sha>")`;
  the local merge completes integration, so this run will reach `done` at §10 (no separate human
  merge step remains). If confirmation isn't available (non-interactive) or the user declines: leave
  the branch, `adapter.transition(ID, in_review)`, phase `review-pending`, and STOP with the ≤6-line
  message (how to review the branch + re-run `/sdlc:run {ID}` to integrate). Never merge unattended.

Phase → `docs`. Checkpoint.

## 9 · DOCS

If the change affects README/API/user-facing behavior, dispatch **Agent → sdlc-docwriter** on
the same branch (its `docs(...)` commit amends the PR; push the update). It reports
`NO-DOCS-NEEDED` for internal-only changes — that's a fine outcome, move on.
If the PR's CI checks are red at this point, dispatch **Agent → sdlc-devops** in diagnosis
mode; branch-caused failures feed one extra fix cycle (respect `maxFixCycles` overall).

## 10 · WRAP

Phase → `done`. Final checkpoint + `## Log` summary (phases run, fix cycles, PR URL or local-merge sha).
Report to the user in ≤6 lines: item, branch, PR URL (or merge sha), assumptions count, findings
resolved, anything needing human eyes.
- **Remote mode:** **Humans review and merge the PR — never merge it yourself.**
- **Local mode:** the default-branch merge only happened because the user confirmed it at §8 —
  **never merge into the default branch without that explicit confirmation.**

## Capability gaps (self-extension protocol)

When you or a dispatched agent conclude "no skill/agent covers X" (an unfamiliar integration,
a recurring procedure):
1. **Search first**: installed plugin skills (core + stack packs) → project `.claude/skills|agents/`
   → `.sdlc/extensions.json`. Most gaps are an existing skill you didn't load.
2. Still missing AND plausibly reusable → follow `sdlc:scaffold-skill` (or
   `sdlc:scaffold-agent` only if the agent test passes) mid-run; the new capability is used
   immediately and committed with the branch.
3. One-off knowledge → just handle it inline; don't mint a skill nobody will load twice.
4. **Reuse tracking**: whenever a run loads a registered local extension, increment its
   `reuseCount` in `.sdlc/extensions.json` (commit with the branch). `/sdlc:status` surfaces
   promotion candidates at `reuseCount >= 2`.

## Orchestrator invariants

- **Never escalate an agent to a larger model to work around a failure.** Each agent's tier is
  deliberate (haiku docwriter, sonnet workhorses, opus architect/security). If a subagent dies
  with a model/API error, do NOT retry it on a bigger model — report the exact error and stop
  the phase; a model that won't load is an environment problem to fix, not a reason to burn a
  higher tier. (Overriding a tier is a human decision, never an automatic recovery.)
- Checkpoint the run file BEFORE dispatching any agent and AFTER it returns.
- Agent briefs always include: run-file path, the section(s) they may append to, and
  "return a short verdict + pointer, not a transcript".
- Keep your own context lean: read agents' verdicts, not their full output; the run file is the record.
- Any unexpected state (dirty tree at start, wrong branch, adapter errors) → report precisely; never improvise around safety rules.
