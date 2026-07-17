# User Guide — Day-to-Day with the Claude AIDLC

The practical playbook: which command in which situation, what you'll see, how stopping/
resuming works, and how the framework remembers everything. (Setup/installation lives in
`adoption-guide.md`; design rationale in `architecture.md`.)

## 1. The 30-second mental model

- **The backlog is the source of truth for WHAT** — epics/stories/tasks/bugs/spikes in Jira,
  Azure Boards, or `backlog/` markdown files. You (or the analyst) write items; the pipeline
  consumes them.
- **Run files are the source of truth for WHERE** — every item being worked has
  `.aidlc/runs/<ID>.md` recording its phase, plan, assumptions, findings, and log. Everything
  the pipeline knows about in-flight work lives there, on the item's branch.
- **You are the merge gate.** The pipeline takes an item from backlog to an open PR without
  you; only a human merges. **No remote yet?** Set `git.mode: local` — instead of a PR the pipeline
  proposes a local `--no-ff` merge after verify and waits for your OK; it never merges on its own.
- **One repo or many.** In a **polyrepo** workspace (several git repos under one control plane), the
  model is *one **runnable leaf** → one repo → one branch → one PR*: the orchestrator routes each leaf
  to the right repo, and a cross-repo feature fans out so each leaf targets one repo. Epics/Features
  always span repos; **which tier is the single-repo leaf** — the Story or the Task — is your call
  (`workspace.crossRepoSplit`; see §1a). One shared backlog and board span every repo —
  `/aidlc:status` shows a unified board with a Repo column, and `/aidlc:release <repo>` cuts a per-repo
  release. Setup lives in `adoption-guide.md` §4. Mono projects behave exactly as before.

## 1a. Poly: how a feature's work maps to repos (a worked example)

A feature spans repos — an API in the backend, its UI in the frontend, a migration in the DB repo.
**Epics and Features always span repos.** The only hard rule is that the **runnable leaf** (the thing
that gets one branch + one PR) lives in **one repo** — separate git repos can't share a branch/PR.

*Which tier is the leaf* is a per-project convention set by **`workspace.crossRepoSplit`** (default
`story`). Both are fully supported — pick the one your board is authored for. Take a **"Profile page"**
epic:

**`crossRepoSplit: "story"` (default, recommended) — the leaf is the Story:**

```
Epic: Profile page                       ← spans repos
├─ Feature: General info                 ← spans repos
│  ├─ Story: General-info API + schema      → bee-auth-api    (one branch/PR)
│  │    └─ Tasks: migration · endpoints · DTOs        (all in bee-auth-api)
│  └─ Story: General-info UI                → bee-auth-web    (one branch/PR; dependsOn the API story)
│       └─ Tasks: form component · wire to /profile   (all in bee-auth-web)
└─ Feature: Notification info
   ├─ Story: Notification-prefs API           → bee-auth-api
   └─ Story: Notification-prefs UI            → bee-auth-web
```

Each Story is one repo = one PR; Tasks are that repo's breakdown. Fits ADO's
Epic→Feature→Story→Task hierarchy natively and keeps estimates/velocity honest. Recommended default.

**`crossRepoSplit: "task"` — the leaf is the Task (the Story is a cross-repo umbrella):**

```
Epic: Profile page
└─ Feature: General info
   └─ Story: General info                 ← cross-repo UMBRELLA (one unit of user value)
      ├─ Task: API ready       → bee-auth-api   (one branch/PR)
      ├─ Task: UI ready        → bee-auth-web   (one branch/PR)
      └─ Task: DB migration    → bee-auth-api   (one branch/PR)
```

Here you run the **Tasks** (each a single-repo run); the Story rolls up when they all complete. Natural
when a team treats a story as *user value* rather than *deliverable unit*, or when an existing board
already nests cross-repo tasks under one story.

**Which to choose?** Default to **`story`** — cleaner PRs, native ADO fit. Choose **`task`** if your
board is already authored that way or your team insists a story = one user-facing capability. The
pipeline honors the setting everywhere: `/aidlc:intake` and `/aidlc:groom` propose the matching shape,
and `/aidlc:run` treats an umbrella story as a coordinator (runs its per-repo tasks) instead of trying
to run it as one repo.

## 2. Command cheat-sheet — which command, when

| Situation | Command |
|---|---|
| New project, first time | `/aidlc:init` (choose the requirements-doc path to defer topology/stack to bootstrap) |
| **A whole project from a requirements doc/brief** (Word/PDF or chat) → infers architecture (mono/poly, stack, monolith-vs-microservices), populated board + sprint plan | `/aidlc:bootstrap ./requirements.docx` |
| **"I want X" — requirement in your head, not in the backlog yet** | `/aidlc:intake add avatar upload, max 5MB` |
| Describe it AND build it in one go | `/aidlc:run add avatar upload, max 5MB` (free text → items → pipeline) |
| "Just work on the next most important thing" | `/aidlc:next` |
| Work a specific item | `/aidlc:run PROJ-123` |
| Yesterday's run stopped / new session / anything interrupted | `/aidlc:run PROJ-123` (same command — it resumes) |
| "Where is everything?" | `/aidlc:status` |
| Backlog is messy / items missing AC / before sprint planning | `/aidlc:groom` |
| Work several items at once | `/aidlc:sprint 3` |
| **Make a screen or the whole app award-grade** (new or existing) | `/aidlc-ux:design /dashboard` · `/aidlc-ux:design "redesign the landing page"` |
| Same, anchored to your brand | drop a logo/font/screenshot in `design/brand/` (or set `ux.brand`), then run `/aidlc-ux:design …` |
| Cut a version | `/aidlc:release` |
| A local skill proved reusable | `/aidlc:promote <name>` |
| After `/plugin marketplace update` | `/aidlc:sync` |

### Getting requirements INTO the backlog

Three equally valid routes — mix them freely:

1. **Items already exist** (Jira/ADO/markdown, written by anyone) → `/aidlc:next` or `/aidlc:run <ID>` directly.
2. **You describe a requirement** → `/aidlc:intake <plain language>`. The analyst grounds it in
   the codebase, **sweeps the existing backlog first** — fully covered parts are skipped,
   partial overlaps produce only the delta (linked to the existing items), in-flight conflicts
   get flagged — then proposes the item set (epic+stories or a single story/bug/task) with
   acceptance criteria for your approval before anything is created.
3. **Both at once**: a sprint's items exist but your new ask isn't among them → same
   `/aidlc:intake`; the dedup pass is exactly what keeps the two sources from colliding.

`/aidlc:run <free text>` does route 2 and then immediately runs the first created item.
Hand-writing markdown items (per `backlog/README.md`) always works too.

## 3. The lifecycle of one item (what you'll see)

`/aidlc:run PROJ-123` on a story walks these phases, updating the run file and commenting on
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
5. **verify** — agent-driven review, **each on its own cadence** (`pipeline.verification`). By
   default (economical) reviewer + QA are **on-demand** and security runs **per-epic** (confirmed),
   so a typical item runs no LLM agent here — the deterministic CI gate (lint/type/tests/boundaries)
   is the per-item floor. When agents do run, blocker/major findings loop back to the implementer up
   to `maxFixCycles`. **The cadence is yours to set** — see §3b.
6. **pr** — branch pushed, PR opened with AC checklist, assumptions, test evidence. Item → In Review.
7. **docs** — README/CHANGELOG/API docs amended onto the PR if the change is user-visible.
8. **done** — summary report. **You review and merge the PR.** After merge, `/aidlc:status`
   offers cleanup (item → Done, run file archived).

Bugs differ in one way: QA writes a *failing reproduction test first*, then the fix must make
it pass. Spikes produce a cited decision report in `docs/research/` instead of a PR. Epics get
decomposed into child stories and stop.

### 3a. UI items → the design pod (Awwwards-grade UI)

The `aidlc-ux` plugin ships **enabled by default** and only wakes up on UI work — backend/infra
items never touch it. You don't flip a switch to use it.

**When it triggers automatically.** During `/aidlc:run`, the orchestrator decides at the *classify*
step whether an item is UI (`ui: true` on the run file) — if the item is labeled
`ui`/`ux`/`design`/`frontend`, OR its title/description/AC mention a screen/page/component/layout/
visual/motion/redesign, OR the project has a frontend and the item clearly renders something. When
it's UI, the frontend is built and then run through the pod's **jury loop**: narrative → inspiration
research → design system → build + motion → a strict, unbiased jury that *renders the actual UI*
(Playwright screenshots) and scores it /10 against an Awwwards-style rubric. It iterates until the
score is **≥ `ux.juryThreshold` (default 9)**, capped at `ux.maxJuryRounds` (default 3). Jury
findings gate the PR exactly like reviewer/QA findings; at the cap it ships the best round and flags
the rest for you — it never loops forever or jumps to a bigger model.

**When you invoke it directly.** `/aidlc-ux:design <target>` runs the same pod on demand:
- a **new** project → establishes one design system that every later UI item then follows;
- an **existing** page/screen → *retrofit*: it audits the current UI, adopts the existing system, and
  redesigns just that surface so it stays consistent with the rest;
- the **whole** existing app → *redesign*: it may replace the system and propagate it everywhere.

**Anchoring to your brand (new or existing).** Give it a logo, colors, fonts, or a reference
screenshot and they become hard constraints (palette pulled from the logo, fonts matched, values
honored exactly). Two ways: drop assets in `design/brand/`, or set `ux.brand` in
`aidlc.config.json` (`logo`, `palette`, `fonts`, `guidelines`). You can also pass them inline:
`/aidlc-ux:design "redesign the header, match design/brand/logo.svg and use Söhne for headings"`.

**Tuning it** (`.claude/aidlc.config.json` → `ux`): `enabled` (default true), `juryThreshold`,
`maxJuryRounds` (cost cap), `juryPanelSize` (set 3 for a 3-juror panel whose scores are averaged),
`renderBaseUrl`, `target` (`desktop-web`). All artifacts land in `design/` (narrative, inspiration,
design-system, motion-spec, audit, brand, and per-round jury reports) and are committed to the
branch — so the reasoning and every score are auditable in the PR.

### 3b. Who verifies, and how often (controlling the review/QA/security cost)

The reviewer, QA and security agents are the pipeline's biggest recurring token/time cost, so **each
has its own cadence** in `pipeline.verification` (`.claude/aidlc.config.json`; you're also asked at
`/aidlc:init`). Cadence values per agent: `off` · `on-demand` (runs only when you ask on a run) ·
`per-item` · `per-epic` (deferred to the epic's consolidated pass); `security` also takes
`risk-based` (per-item, only on risky diffs). Whatever you pick, the **deterministic CI gate**
(lint/format/typecheck/boundaries/tests) always runs — that's the per-item floor.

Common profiles:

| Profile | reviewer / qa / security | Cost |
|---|---|---|
| **Economical (default)** | `on-demand` / `on-demand` / `per-epic` (+`securityConfirm`) | lowest — no LLM agent per item; you invoke reviewer/QA when wanted; security once per epic, after you confirm |
| **Balanced** | `per-item` / `on-demand` / `risk-based` | medium — AC/standards review every PR; QA on demand; security auto on risky diffs |
| **Thorough** | `per-item` / `per-item` / `per-item` | highest — every item fully reviewed before PR |
| **Manual** (`mode: manual`) | all skipped | you review the PR yourself; run ends at `review-pending` |

On-demand reviewer/QA is delivered by re-running the item and asking (e.g. "run a code review /
QA on PROJ-123"). `security: per-epic` runs when you run the epic (`/aidlc:run <EPIC-ID>`) once its
children are done — and asks before it spends the tokens (`securityConfirm: true`).

**Important:** regardless of mode, the implementer still runs the project's own lint + tests to green
before any PR — `manual` skips the *extra agent* review, not basic build health. And in every mode
**you remain the merge gate**; `manual` just means no bot pre-reviewed the PR (it's flagged as such,
so you know to look closely).

**Feeding back your own review (manual mode):** after the PR opens, if you want changes, run
`/aidlc:run <ID>` and describe the issues (or add them under `## Findings` in the run file) — the
implementer fixes them, pushes to the same PR, and returns to `review-pending`. Merge when happy.

## 4. Stopping and resuming (end of day → next morning)

**You never need to "save".** State persists continuously:

- The run file is checkpointed at every phase transition and after every agent — and hooks
  force a flush before context compaction and at session stop.
- Just close the terminal whenever. Mid-implement, mid-verify, doesn't matter.

**Next morning:**

1. Open Claude Code in the project. The SessionStart hook prints where things stand
   automatically ("Active AIDLC runs: PROJ-123 [verify] …").
2. `/aidlc:status` for the full board if you want detail.
3. `/aidlc:run PROJ-123` — it reads the run file, verifies the branch, and continues from the
   recorded phase. Completed phases are never redone; a half-done plan continues at the first
   unticked task.

**If the run ended BLOCKED** (findings unresolved after 3 fix cycles, missing credential,
contradictory AC): the run file's `## Findings` section and the work-item comment say exactly
why. Fix the underlying issue (or amend the item), then `/aidlc:run PROJ-123` again — on
resuming a blocked run it asks whether to retry, adjust, or abandon.

**If a sprint was interrupted:** each item's worktree and run file survive independently.
`/aidlc:status` shows them; resume any item inside its worktree, or re-launch `/aidlc:sprint`
to fill free slots.

## 5. Scope changes mid-flight (the memory model at work)

Scenario: PROJ-123 is half-implemented, and the product owner edits the item — new acceptance
criterion, one removed, description clarified.

**Do nothing special.** Edit the item in the tracker/backlog as usual. On the next
`/aidlc:run PROJ-123` (and again just before the PR), the pipeline re-fetches the item and
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
| In-flight run state (phase, plan, findings, assumptions) | `.aidlc/runs/<ID>.md` (on the branch) | session restarts, compaction, crashes | resume, audit, PR trail |
| Session orientation | SessionStart hook (reads run files + backlog) | every new session | "where was I" for free |
| Work-item history | tracker comments / `## Activity` | forever | humans watching Jira/ADO/backlog |
| Completed-run history | `.aidlc/runs/archive/` | forever (committed) | cycle-time review, forensics |
| Architecture decisions | `docs/adr/` | forever | "why is it like this?" in a year |
| Research/spike outcomes | `docs/research/` | forever | decisions with evidence + dates |
| Design system & UX artifacts | `design/` (+ `design/brand/`, jury reports) | forever (committed) | one uniform system every UI item follows; auditable scores |
| Project conventions | `CLAUDE.md` + `.claude/rules/` | every session (always loaded) | invariants: branch names, safety |
| Project configuration | `.claude/aidlc.config.json` | forever | tracker, git host, autonomy gates |
| Locally grown capabilities | `.claude/skills|agents/` + `.aidlc/extensions.json` | forever; promotable to all projects | self-extension with reuse tracking |

The deliberate consequence: **the conversation context is disposable.** Anything that matters
is externalized as it happens, so deviations, restarts and model context limits can't corrupt
in-flight work.

## 7. Troubleshooting

| Symptom | Do |
|---|---|
| Run BLOCKED at verify repeatedly | Read `## Findings`; the item's AC may be contradictory — `/aidlc:groom` it, or fix the noted issue and rerun |
| PR checks red after the pipeline finished | `/aidlc:run <ID>` again — the devops agent diagnoses (branch-caused vs flake vs pre-existing) |
| "adapter/MCP not available" | `/mcp` to check server status; auth per `adoption-guide.md` §4; markdown source needs nothing |
| Push/PR failed (no auth) | `gh auth login` / `az login`, rerun — the run resumes at the pr phase |
| Pipeline blocked a command you actually wanted | That's the guard hook; run it yourself in a terminal if you're sure — the pipeline can't, by design |
| Two runs touched the same file | Shouldn't happen via `/aidlc:sprint` (independence check); if manual runs collided, merge the first PR, then rerun the second item — verify will catch conflicts |
| Skill/agent seems missing after plugin update | `/aidlc:sync` reconciles local vs plugin |
| Jury never reaches 9 / loops a lot | It stops at `ux.maxJuryRounds` and ships the best round with the critique attached — read the latest `design/jury-report-r*.md`; lower `juryThreshold` or raise `maxJuryRounds` if the bar/effort is genuinely off |
| Design pod ran on a non-UI item (or skipped a UI one) | Set the item's `ui`/`backend` intent explicitly with a label; or set `ux.enabled: false` to disable the pod for the whole project |
| Jury reports "app not rendering" | It needs the dev server reachable at `ux.renderBaseUrl` — make sure the project's run command starts there (check `CLAUDE.md`), then rerun |
| Headless run: "Ignoring N permissions.allow entries … workspace has not been trusted" | Open Claude Code interactively in that folder once and accept the trust dialog (or set `projects["<path>"].hasTrustDialogAccepted: true` in `~/.claude.json`), then rerun — the run resumes where it stopped |
