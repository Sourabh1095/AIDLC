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
  you; only a human merges. **No remote yet?** Set `git.mode: local` — instead of a PR the pipeline
  proposes a local `--no-ff` merge after verify and waits for your OK; it never merges on its own.
- **One repo or many.** In a **polyrepo** workspace (several git repos under one control plane),
  the model is *one item → one repo → one branch → one PR*: the orchestrator routes each item to
  the right repo, and a cross-repo feature is an epic whose children each target one repo. One
  shared backlog and board span every repo — `/sdlc:status` shows a unified board with a Repo
  column, and `/sdlc:release <repo>` cuts a per-repo release. Setup lives in `adoption-guide.md` §4.
  Mono projects behave exactly as before.

## 2. Command cheat-sheet — which command, when

| Situation | Command |
|---|---|
| New project, first time | `/sdlc:init` |
| **"I want X" — requirement in your head, not in the backlog yet** | `/sdlc:intake add avatar upload, max 5MB` |
| Describe it AND build it in one go | `/sdlc:run add avatar upload, max 5MB` (free text → items → pipeline) |
| "Just work on the next most important thing" | `/sdlc:next` |
| Work a specific item | `/sdlc:run PROJ-123` |
| Yesterday's run stopped / new session / anything interrupted | `/sdlc:run PROJ-123` (same command — it resumes) |
| "Where is everything?" | `/sdlc:status` |
| Backlog is messy / items missing AC / before sprint planning | `/sdlc:groom` |
| Work several items at once | `/sdlc:sprint 3` |
| **Make a screen or the whole app award-grade** (new or existing) | `/sdlc-ux:design /dashboard` · `/sdlc-ux:design "redesign the landing page"` |
| Same, anchored to your brand | drop a logo/font/screenshot in `design/brand/` (or set `ux.brand`), then run `/sdlc-ux:design …` |
| Cut a version | `/sdlc:release` |
| A local skill proved reusable | `/sdlc:promote <name>` |
| After `/plugin marketplace update` | `/sdlc:sync` |

### Getting requirements INTO the backlog

Three equally valid routes — mix them freely:

1. **Items already exist** (Jira/ADO/markdown, written by anyone) → `/sdlc:next` or `/sdlc:run <ID>` directly.
2. **You describe a requirement** → `/sdlc:intake <plain language>`. The analyst grounds it in
   the codebase, **sweeps the existing backlog first** — fully covered parts are skipped,
   partial overlaps produce only the delta (linked to the existing items), in-flight conflicts
   get flagged — then proposes the item set (epic+stories or a single story/bug/task) with
   acceptance criteria for your approval before anything is created.
3. **Both at once**: a sprint's items exist but your new ask isn't among them → same
   `/sdlc:intake`; the dedup pass is exactly what keeps the two sources from colliding.

`/sdlc:run <free text>` does route 2 and then immediately runs the first created item.
Hand-writing markdown items (per `backlog/README.md`) always works too.

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
   **This phase's cadence is yours to set** — every item, once per epic, or off (you review the
   PRs yourself). See §3b.
6. **pr** — branch pushed, PR opened with AC checklist, assumptions, test evidence. Item → In Review.
7. **docs** — README/CHANGELOG/API docs amended onto the PR if the change is user-visible.
8. **done** — summary report. **You review and merge the PR.** After merge, `/sdlc:status`
   offers cleanup (item → Done, run file archived).

Bugs differ in one way: QA writes a *failing reproduction test first*, then the fix must make
it pass. Spikes produce a cited decision report in `docs/research/` instead of a PR. Epics get
decomposed into child stories and stop.

### 3a. UI items → the design pod (Awwwards-grade UI)

The `sdlc-ux` plugin ships **enabled by default** and only wakes up on UI work — backend/infra
items never touch it. You don't flip a switch to use it.

**When it triggers automatically.** During `/sdlc:run`, the orchestrator decides at the *classify*
step whether an item is UI (`ui: true` on the run file) — if the item is labeled
`ui`/`ux`/`design`/`frontend`, OR its title/description/AC mention a screen/page/component/layout/
visual/motion/redesign, OR the project has a frontend and the item clearly renders something. When
it's UI, the frontend is built and then run through the pod's **jury loop**: narrative → inspiration
research → design system → build + motion → a strict, unbiased jury that *renders the actual UI*
(Playwright screenshots) and scores it /10 against an Awwwards-style rubric. It iterates until the
score is **≥ `ux.juryThreshold` (default 9)**, capped at `ux.maxJuryRounds` (default 3). Jury
findings gate the PR exactly like reviewer/QA findings; at the cap it ships the best round and flags
the rest for you — it never loops forever or jumps to a bigger model.

**When you invoke it directly.** `/sdlc-ux:design <target>` runs the same pod on demand:
- a **new** project → establishes one design system that every later UI item then follows;
- an **existing** page/screen → *retrofit*: it audits the current UI, adopts the existing system, and
  redesigns just that surface so it stays consistent with the rest;
- the **whole** existing app → *redesign*: it may replace the system and propagate it everywhere.

**Anchoring to your brand (new or existing).** Give it a logo, colors, fonts, or a reference
screenshot and they become hard constraints (palette pulled from the logo, fonts matched, values
honored exactly). Two ways: drop assets in `design/brand/`, or set `ux.brand` in
`sdlc.config.json` (`logo`, `palette`, `fonts`, `guidelines`). You can also pass them inline:
`/sdlc-ux:design "redesign the header, match design/brand/logo.svg and use Söhne for headings"`.

**Tuning it** (`.claude/sdlc.config.json` → `ux`): `enabled` (default true), `juryThreshold`,
`maxJuryRounds` (cost cap), `juryPanelSize` (set 3 for a 3-juror panel whose scores are averaged),
`renderBaseUrl`, `target` (`desktop-web`). All artifacts land in `design/` (narrative, inspiration,
design-system, motion-spec, audit, brand, and per-round jury reports) and are committed to the
branch — so the reasoning and every score are auditable in the PR.

### 3b. Who verifies, and how often (controlling the review/QA cost)

The reviewer + QA agents are the pipeline's biggest recurring token/time cost. Whether SDLC spends
that on every item, or you review the work yourself, is a setting — `pipeline.verification` in
`.claude/sdlc.config.json` (you're also asked at `/sdlc:init`):

| `mode` / `scope` | What happens | Cost |
|---|---|---|
| `auto` / `per-item` (default) | reviewer + QA run before every PR; blocker/major findings loop back | highest, thorough |
| `auto` / `per-epic` | child items skip per-item review; one consolidated pass when the epic's children are all done (run `/sdlc:run <EPIC-ID>`) | medium |
| `manual` | SDLC skips the review/QA agents, builds, and **opens the PR for you to review**; the run ends at `review-pending` | lowest |
| `ask` | the pipeline asks you per item which to do | — |

Fine-grained toggles in the same block: `reviewer` (adversarial code review), `qa` (full suite +
missing tests), `security` (`risk-based` deep pass on auth/dep changes, or `off`). So you can, e.g.,
keep the fast code review on but turn the heavier QA test-authoring off: `"reviewer": true,
"qa": false`.

**Important:** regardless of mode, the implementer still runs the project's own lint + tests to green
before any PR — `manual` skips the *extra agent* review, not basic build health. And in every mode
**you remain the merge gate**; `manual` just means no bot pre-reviewed the PR (it's flagged as such,
so you know to look closely).

**Feeding back your own review (manual mode):** after the PR opens, if you want changes, run
`/sdlc:run <ID>` and describe the issues (or add them under `## Findings` in the run file) — the
implementer fixes them, pushes to the same PR, and returns to `review-pending`. Merge when happy.

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
| Design system & UX artifacts | `design/` (+ `design/brand/`, jury reports) | forever (committed) | one uniform system every UI item follows; auditable scores |
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
| Jury never reaches 9 / loops a lot | It stops at `ux.maxJuryRounds` and ships the best round with the critique attached — read the latest `design/jury-report-r*.md`; lower `juryThreshold` or raise `maxJuryRounds` if the bar/effort is genuinely off |
| Design pod ran on a non-UI item (or skipped a UI one) | Set the item's `ui`/`backend` intent explicitly with a label; or set `ux.enabled: false` to disable the pod for the whole project |
| Jury reports "app not rendering" | It needs the dev server reachable at `ux.renderBaseUrl` — make sure the project's run command starts there (check `CLAUDE.md`), then rerun |
| Headless run: "Ignoring N permissions.allow entries … workspace has not been trusted" | Open Claude Code interactively in that folder once and accept the trust dialog (or set `projects["<path>"].hasTrustDialogAccepted: true` in `~/.claude.json`), then rerun — the run resumes where it stopped |
