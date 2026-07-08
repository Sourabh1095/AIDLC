# User Guide — Day-to-Day with the Claude SDLC

The practical playbook: which command in which situation, what you'll see, how stopping/
resuming works, and how the framework remembers everything. (Setup/installation lives in
`adoption-guide.md`; design rationale in `architecture.md`.)

## 1. The 30-second mental model

- **The backlog is the source of truth for WHAT** — epics/stories/tasks/bugs/spikes in Jira,
  Azure Boards, or `backlog/` markdown files. You (or the analyst) write items; the pipeline
  consumes them.
- **Run files are the source of truth for WHERE** — every item being worked has
  `.sdlc/runs/<ID>.md` recording its phase, plan, assumptions, findings, and log. Everything
  the pipeline knows about in-flight work lives there, on the item's branch.
- **You are the merge gate.** The pipeline takes an item from backlog to an open PR without
  you; only a human merges.

## 2. Command cheat-sheet — which command, when

| Situation | Command |
|---|---|
| New project, first time | `/sdlc:init` |
| "Just work on the next most important thing" | `/sdlc:next` |
| Work a specific item | `/sdlc:run PROJ-123` |
| Yesterday's run stopped / new session / anything interrupted | `/sdlc:run PROJ-123` (same command — it resumes) |
| "Where is everything?" | `/sdlc:status` |
| Backlog is messy / items missing AC / before sprint planning | `/sdlc:groom` |
| Work several items at once | `/sdlc:sprint 3` |
| Cut a version | `/sdlc:release` |
| A local skill proved reusable | `/sdlc:promote <name>` |
| After `/plugin marketplace update` | `/sdlc:sync` |

Writing a new backlog item (markdown source): copy the format from `backlog/README.md` into
`backlog/items/` — or just tell Claude what you want; the analyst will draft it via the adapter.

## 3. The lifecycle of one item (what you'll see)

`/sdlc:run PROJ-123` on a story walks these phases, updating the run file and commenting on
the work item at each step:

```
start → requirements → design → implement → verify → pr → docs → done
                                              ↑______↓  (fix cycles, max 3)
```

1. **start** — branch `feature/PROJ-123-slug` created, item → In Progress.
2. **requirements** — analyst validates/refines AC; ambiguities become logged assumptions
   (visible on the item AND in the PR later — three chances to veto a bad one).
3. **design** — plan written into the run file (architect agent for M+ items, with an ADR if
   the decision is hard to reverse).
4. **implement** — implementer codes plan-task by plan-task, conventional commits, tests green.
5. **verify** — reviewer + QA in parallel (+ security when auth paths/dependencies are
   touched). Blocker/major findings loop back to the implementer, up to `maxFixCycles`.
6. **pr** — branch pushed, PR opened with AC checklist, assumptions, test evidence. Item → In Review.
7. **docs** — README/CHANGELOG/API docs amended onto the PR if the change is user-visible.
8. **done** — summary report. **You review and merge the PR.** After merge, `/sdlc:status`
   offers cleanup (item → Done, run file archived).

Bugs differ in one way: QA writes a *failing reproduction test first*, then the fix must make
it pass. Spikes produce a cited decision report in `docs/research/` instead of a PR. Epics get
decomposed into child stories and stop.

## 4. Stopping and resuming (end of day → next morning)

**You never need to "save".** State persists continuously:

- The run file is checkpointed at every phase transition and after every agent — and hooks
  force a flush before context compaction and at session stop.
- Just close the terminal whenever. Mid-implement, mid-verify, doesn't matter.

**Next morning:**

1. Open Claude Code in the project. The SessionStart hook prints where things stand
   automatically ("Active SDLC runs: PROJ-123 [verify] …").
2. `/sdlc:status` for the full board if you want detail.
3. `/sdlc:run PROJ-123` — it reads the run file, verifies the branch, and continues from the
   recorded phase. Completed phases are never redone; a half-done plan continues at the first
   unticked task.

**If the run ended BLOCKED** (findings unresolved after 3 fix cycles, missing credential,
contradictory AC): the run file's `## Findings` section and the work-item comment say exactly
why. Fix the underlying issue (or amend the item), then `/sdlc:run PROJ-123` again — on
resuming a blocked run it asks whether to retry, adjust, or abandon.

**If a sprint was interrupted:** each item's worktree and run file survive independently.
`/sdlc:status` shows them; resume any item inside its worktree, or re-launch `/sdlc:sprint`
to fill free slots.

## 5. Scope changes mid-flight (the memory model at work)

Scenario: PROJ-123 is half-implemented, and the product owner edits the item — new acceptance
criterion, one removed, description clarified.

**Do nothing special.** Edit the item in the tracker/backlog as usual. On the next
`/sdlc:run PROJ-123` (and again just before the PR), the pipeline re-fetches the item and
compares it against the versioned snapshot in the run file:

- **Additive** changes → new plan tasks appended; completed work untouched.
- **Modifying** changes → affected completed tasks marked `[needs-rework]`, rework tasks added.
- **Removed** scope → tasks struck through (visible, not deleted — audit trail).
- Changes that invalidate the whole approach → the pipeline stops and asks you:
  finish-as-scoped, rework in place, or close-and-split.

Every reconciliation is logged in the run file and commented on the item, so nobody wonders
why the plan shifted. Other in-flight items are untouched — each run's state is isolated in
its own run file and branch.

## 6. What is remembered, where (the full memory map)

| Memory | Lives in | Survives | Used for |
|---|---|---|---|
| In-flight run state (phase, plan, findings, assumptions) | `.sdlc/runs/<ID>.md` (on the branch) | session restarts, compaction, crashes | resume, audit, PR trail |
| Session orientation | SessionStart hook (reads run files + backlog) | every new session | "where was I" for free |
| Work-item history | tracker comments / `## Activity` | forever | humans watching Jira/ADO/backlog |
| Completed-run history | `.sdlc/runs/archive/` | forever (committed) | cycle-time review, forensics |
| Architecture decisions | `docs/adr/` | forever | "why is it like this?" in a year |
| Research/spike outcomes | `docs/research/` | forever | decisions with evidence + dates |
| Project conventions | `CLAUDE.md` + `.claude/rules/` | every session (always loaded) | invariants: branch names, safety |
| Project configuration | `.claude/sdlc.config.json` | forever | tracker, git host, autonomy gates |
| Locally grown capabilities | `.claude/skills|agents/` + `.sdlc/extensions.json` | forever; promotable to all projects | self-extension with reuse tracking |

The deliberate consequence: **the conversation context is disposable.** Anything that matters
is externalized as it happens, so deviations, restarts and model context limits can't corrupt
in-flight work.

## 7. Troubleshooting

| Symptom | Do |
|---|---|
| Run BLOCKED at verify repeatedly | Read `## Findings`; the item's AC may be contradictory — `/sdlc:groom` it, or fix the noted issue and rerun |
| PR checks red after the pipeline finished | `/sdlc:run <ID>` again — the devops agent diagnoses (branch-caused vs flake vs pre-existing) |
| "adapter/MCP not available" | `/mcp` to check server status; auth per `adoption-guide.md` §4; markdown source needs nothing |
| Push/PR failed (no auth) | `gh auth login` / `az login`, rerun — the run resumes at the pr phase |
| Pipeline blocked a command you actually wanted | That's the guard hook; run it yourself in a terminal if you're sure — the pipeline can't, by design |
| Two runs touched the same file | Shouldn't happen via `/sdlc:sprint` (independence check); if manual runs collided, merge the first PR, then rerun the second item — verify will catch conflicts |
| Skill/agent seems missing after plugin update | `/sdlc:sync` reconciles local vs plugin |
