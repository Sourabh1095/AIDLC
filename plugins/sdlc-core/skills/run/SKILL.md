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
| epic | decompose only: dispatch `sdlc-analyst` to split into child stories via `adapter.create(...)` — **in poly, each child is routed to exactly one repo** (see §2.5); comment the child IDs (with their repos) on the epic, then STOP — children run individually. **Exception — `verification.scope: per-epic`:** if the epic's children already exist and are all implemented (query the adapter), don't re-decompose; instead run ONE consolidated auto-verify pass (reviewer + QA per the toggles) over the epic's combined changes, then report — this is where deferred per-item verification is paid, once, for the whole feature. |

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

## 2.5 · ROUTE TO REPO (poly; a no-op in mono)

With one repo in the registry (mono), skip this — the single entry is the target; leave `repo:`
unset on the run file. With several:

**Non-epic item** — resolve its target repo via the chain in `sdlc:work-items` → *Repos & routing*
(explicit `repo` → label match → single default → analyst grounding → ask). Record the resolved repo
on the run file's `repo:` and write it back via `adapter.link`/`adapter.updateAC` where the source
supports it. From here **every git/branch/commit/push/PR/verify step for this run runs with cwd =
`workspace.root`/`<repo.path>`**, using THAT repo entry's `host`/`remote`/`defaultBranch`/
`branchPattern`. The run file lives at `<repo.path>/.sdlc/runs/{ID}.md` and is committed to the
branch (so the PR still carries the full audit trail).

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
frontend repo** (its `path` as the working dir and its `ux.renderBaseUrl` for the jury). It runs narrative → research →
design system → (build/redesign +) motion, then the **jury loop to `ux.juryThreshold` (default 9),
capped at `ux.maxJuryRounds`**. Its `[open]` jury findings join `## Findings` and gate the PR the
same as reviewer/QA findings.
- If `ui: true` but `sdlc-ux` is not installed, build the UI with the implementer as usual and note
  in `## Findings` that the design gate was unavailable (so a human knows it shipped un-judged).
- `ui: false` items skip the pod entirely.

Phase → `verify`. Checkpoint.

## 7 · VERIFY (user controls the cadence)

Read `pipeline.verification` (defaults: `mode` `auto`, `scope` `per-item`, `reviewer` true,
`qa` true, `security` `risk-based`). The implementer has already run the project's lint + tests
green before finishing — this phase is the *extra* agent-driven review/QA on top of that, and it's
the biggest recurring cost, so who pays for it is the user's choice.

**Resolve the effective mode first:**
- `ask` → present the choice to the user for THIS item (AskUserQuestion where available): run full
  auto verification, run only one of reviewer/QA, or hand it to them (manual). Use their answer as
  the mode below; record it in `## Log`. (Only `ask` mode ever interrupts — `auto`/`manual` run
  unattended.)
- `scope: per-epic` AND this item has a `parent` epic → **defer**: skip the agent passes here, add
  `- verify deferred to epic {parent}` to `## Log`, and go to §8. The consolidated pass runs when
  the epic itself is run (see §2 epic note). (`per-item` verifies every item — the default.)

**Mode = `manual`** (the user reviews it themselves):
Skip all verify agents. Add `[NOTE] verification: manual — no automated review/QA ran; human review
is the gate` to `## Findings`. Go to §8, then §9 (docs), then set phase `review-pending` and
STOP with a ≤6-line message: item, branch, and — **remote mode:** PR URL + "review the PR … merge
when satisfied"; **local mode:** "review the branch (`git diff <default>...<branch>`), then re-run
`/sdlc:run {ID}` to integrate it locally (or merge yourself)". In both: "to have issues fixed, run
`/sdlc:run {ID}` and describe them (or add them under `## Findings`)." On a later resume with
user-supplied findings, run them through the fix-cycle loop below (implementer → push update, or the
local re-verify, → back to `review-pending`). Never auto-merge (remote) / never merge without
confirmation (local).

**Mode = `auto`** (SDLC verifies): dispatch in ONE parallel batch, honoring the toggles:
- **Agent → sdlc-reviewer** — only if `verification.reviewer` (adversarial diff review vs AC +
  standards per `sdlc:code-review`; findings to `## Findings`).
- **Agent → sdlc-qa** — only if `verification.qa` (run full suite, add missing tests per
  `sdlc:testing`; findings appended).
- **Agent → sdlc-security** — only if `verification.security` is `risk-based` AND (diff overlaps
  `pipeline.securityReviewPaths` OR manifests/lockfiles changed OR item labeled `security`). Deep
  pass per `sdlc:security`. (Set `security: off` to disable — but if a risky diff ships without it,
  add a `[NOTE] security review skipped on a risky change` to `## Findings` so a human sees it.)
- If BOTH `reviewer` and `qa` are false and security doesn't trigger, there's nothing to run —
  treat as manual (note it) and go to §8.

Then (auto mode):
1. No `BLOCKER`/`MAJOR` findings open → phase `pr`, go to §8.
2. Open blockers/majors AND `fixCycles < pipeline.maxFixCycles` → increment `fixCycles`,
   dispatch **sdlc-implementer** with ONLY the open findings, then re-run this VERIFY phase
   (re-dispatch only the enabled agents, scoped to the fixes).
3. Still failing at max cycles → phase `blocked`, `adapter.comment` with open findings summary,
   notify the user, STOP. (Do not thrash — this is a hard stop.)

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
