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

1. Read `.claude/sdlc.config.json`. Missing → tell the user to run `/sdlc:init`, stop.
2. Route to the active work-item adapter (per `sdlc:work-items`).
3. `fetch($ARGUMENTS)` → WorkItem. Not found → report and stop.

## 1 · RESUME check

If `.sdlc/runs/{ID}.md` exists, follow the resume protocol in `sdlc:run-state` — jump straight
to the recorded phase (§ below), never redo completed phases.

## 2 · CLASSIFY → pipeline variant

| type | variant |
|------|---------|
| story | full: requirements → plan → implement → verify → PR |
| bug | repro-first: requirements(light) → **QA writes failing repro test** → implement fix → verify |
| task | slim: skip requirements agent (orchestrator sanity-checks scope inline) → plan → implement → verify |
| spike | research only: no branch/PR unless the spike says otherwise; output = decision report in `docs/` (Phase 4 expands this) |
| epic | decompose only: dispatch `sdlc-analyst` to split into child stories via `adapter.create(...)`, comment the child IDs on the epic, then STOP — children run individually |

## 3 · START

1. Create the run file from `${CLAUDE_PLUGIN_ROOT}/templates/run-file.md` (fill frontmatter + item snapshot).
2. Branch per `sdlc:git-workflow` (`feature/{ID}-{slug}` etc.). Record branch in run file.
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
`pipeline.architectThreshold` and the `sdlc-architect` agent exists, dispatch it to explore the
codebase and write `## Plan`. Otherwise YOU write a short ordered plan (3–8 checkbox tasks) into
`## Plan` — grounded in a quick look at the relevant code, not guesswork.

Phase → `implement`. Checkpoint.

## 6 · IMPLEMENT

**Bug variant first:** dispatch **Agent → sdlc-qa** to write a *failing* repro test
(per `sdlc:debugging`), commit it (`test(scope): failing repro for {ID}`).

Dispatch **Agent → sdlc-implementer** with brief: run-file path, `## Plan`, AC list, stack
config, and: implement per plan, tick plan checkboxes as completed, conventional commits per
logical unit, run the project's test/lint commands before finishing, append a summary line to `## Log`.

If implementer reports a hard blocker (missing dependency/credentials/contradictory AC) →
phase `blocked`, record in `## Findings`, `adapter.comment`, report to user, STOP.

Phase → `verify`. Checkpoint.

## 7 · VERIFY (parallel) + fix cycles

Dispatch in ONE parallel batch:
- **Agent → sdlc-reviewer**: adversarial diff review vs AC + standards (per `sdlc:code-review`), append findings to `## Findings`.
- **Agent → sdlc-qa**: run full suite, add missing tests per `sdlc:testing`, append findings.

Then:
1. No `BLOCKER`/`MAJOR` findings open → phase `pr`, go to §8.
2. Open blockers/majors AND `fixCycles < pipeline.maxFixCycles` → increment `fixCycles`,
   dispatch **sdlc-implementer** with ONLY the open findings, then re-run this VERIFY phase
   (re-dispatch reviewer+qa scoped to the fixes).
3. Still failing at max cycles → phase `blocked`, `adapter.comment` with open findings summary,
   notify the user, STOP. (Do not thrash — this is a hard stop.)

## 8 · PR

Per `sdlc:git-workflow`: commit any remaining state (incl. run file), push, create the PR with
the filled pr-body template. Then: run-file `pr:` ← URL · `adapter.link(ID, {pr})` ·
`adapter.transition(ID, in_review)` · `adapter.comment(ID, "PR open: <url>")`.

Phase → `docs`. Checkpoint.

## 9 · DOCS

If the change affects README/API/user-facing behavior and the `sdlc-docwriter` agent exists,
dispatch it on the same branch (docs commit amends the PR). Otherwise update CHANGELOG/README
yourself only if the project has them and the change is user-visible. Skip silently for
internal-only changes.

## 10 · WRAP

Phase → `done`. Final checkpoint + `## Log` summary (phases run, fix cycles, PR URL).
Report to the user in ≤6 lines: item, branch, PR URL, assumptions count, findings resolved,
anything needing human eyes. **Humans review and merge the PR — never merge it yourself.**

## Orchestrator invariants

- Checkpoint the run file BEFORE dispatching any agent and AFTER it returns.
- Agent briefs always include: run-file path, the section(s) they may append to, and
  "return a short verdict + pointer, not a transcript".
- Keep your own context lean: read agents' verdicts, not their full output; the run file is the record.
- Any unexpected state (dirty tree at start, wrong branch, adapter errors) → report precisely; never improvise around safety rules.
