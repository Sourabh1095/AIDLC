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
- **Process is proportional to consequence — not everything is a ticket.** Ask for a typo fix and you
  get a typo fix: edited, gated, committed, no item and no PR. Ask for a feature and you get the full
  pipeline. AIDLC picks the lightest tier that fits and says which one in a line; **"just do it", "no
  ticket", "no PR" are honored as instructions**, not argued with. See §1b.
- **You are the merge gate** for tracked work. The pipeline takes an item from backlog to an open PR
  without you; only a human merges. **No remote yet?** Set `git.mode: local` — instead of a PR the pipeline
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

## 1b. How much process a change gets (and how to overrule it)

Four tiers. AIDLC picks one, says which in a line, and does the work:

| Tier | You get | For |
|---|---|---|
| **answer** | nothing but an answer | questions, opinions, "should we…" |
| **direct** | a gated commit on your current branch | typos, renames, a log line, an obvious one-liner |
| **tracked** | branch + run file + commits, PR optional | real work nobody needs a ticket for |
| **full** | item → requirements → plan → implement → verify → PR | stories, features, team-coordinated work |

```
You: fix the typo in the header

AIDLC: Direct — no item, no branch.
  edited  src/components/Header.tsx
  gate    lint ✓  typecheck ✓
  commit  fix(header): correct "Dashbaord" typo   [on feature/PROJ-140]
```

**Overruling it, both directions.** *"just do it"* / *"no ticket"* / *"no PR"* drop the tier — they're
instructions, and AIDLC won't try to sell you the tier you declined or ask twice. *"track this"* /
*"make it an item"* promotes work **already done**: the item gets created and the existing commits linked,
so starting light never traps you.

**Setting the floor.** `pipeline.ceremony` in `.claude/aidlc.config.json`: `direct` (default) · `tracked`
(nothing is ever untracked — always at least a branch and a run file) · `full` (everything through the
pipeline, for audit-bound teams). It only ever raises the tier.

**What doesn't scale down.** Two things, and they're what make the light tiers safe rather than sloppy:

- **Your gate always runs.** Lint, typecheck, tests — resolved from *your* project's real commands — at
  every tier including `direct`. Ceremony is what got cut; verification didn't.
- **Five triggers pull work up regardless of the floor or what you asked for**, because each one names
  something you can't fix by noticing it later: a diff touching **auth or tenant-isolation** paths; a
  **destructive migration** under expand/contract; a change to a declared **API contract**; code an
  **in-flight run already owns**; and an explicit pipeline request. None of them fire unless your config
  actually declares the relevant paths — nothing is invented.

So choosing `direct` isn't choosing to be careless. It's choosing not to file a ticket for a typo.

## 2. Command cheat-sheet — which command, when

| Situation | Command |
|---|---|
| New project, first time | `/aidlc:init` (choose the requirements-doc path to defer topology/stack to bootstrap) |
| **Existing project, first time** — the code is the spec, and you'd rather not answer topology/stack/commands from memory | `/aidlc:init` (pick "there's existing code — scan it") → `/aidlc:adopt` (read-only; reports topology, per-repo stack, monorepo packages, the real gate, your git conventions and your runtime constraints **with evidence**, writing only `.aidlc/adoption/`) → `/aidlc:adopt-apply` (shows the diff, writes only what you approve) → `/aidlc:adopt-adr` (records the decisions your code already embodies) |
| **My tests aren't npm — will the pipeline still verify?** | Yes, once `pipeline.gates.verify` is set: it runs *your* gate in order (`ruff` + `pytest`, `mvn -B verify`, `cargo test`, Turbo affected targets). `/aidlc:adopt-apply` populates it from the scan, or write it by hand. A gate you don't have is recorded `absent` and reported per run as a coverage hole — never counted green. A step your **stack** cannot have (no `build` for a Django service, no separate `typecheck` for Go, where `go build` does it) is recorded `not-applicable` instead: listed once as inapplicable and **never** a finding, because a hole nobody can ever fill teaches you to stop reading the section |
| **We use GitFlow / squash-only / a fork** | Recorded as conventions on the repo entry (`integrationBranch`, `mergeStrategy`, `contribution: fork`). Feature work then branches from and integrates into `develop`, merges the way your project merges, and a fork-only repo gets a fork → upstream PR |
| **One repo, many packages** (pnpm/Nx/Turbo/Lerna/Maven modules) | `packages[]` on the repo entry — still `layout: mono`/one repo entry, because a monorepo has one git boundary. An item routes to a package, its gate **layers** over the repo's (a package's own `test` doesn't lose the repo's `lint`), its PR is labeled with the package, and `/aidlc:release <repo> <pkg>` cuts a per-package release **where your tooling supports one** — and says so plainly where it doesn't |
| **We're a live SaaS — will it know not to drop a column?** | Once `saas` is set: yes. `tenancy` + `liveDataConstraint: expand-contract` makes a destructive migration a review **blocker**, a diff touching a public API contract triggers breaking-change review, auth and tenant-isolation paths are security-reviewed **regardless of your cadence** (and if you delete one of those paths from `pipeline.securityReviewPaths` on purpose, it stays deleted — a later apply will not quietly put it back), and the implementer is told to ship user-visible changes behind your flag system. Every one of these is off unless `/aidlc:adopt` found evidence for it — nothing is assumed |
| **Where did this decision come from?** | `/aidlc:adopt-adr` writes an ADR per decision the code embodies, at status `accepted (retroactive)`, citing `path:line`. Its `## Rationale` says *not recorded — confirm with the team* and stays that way until a human fills it in: a scan sees *what*, never *why*, and an invented reason in an accepted ADR is worse than a blank one |
| **The scan found real problems — can they become work?** | `/aidlc:adopt-backlog` — absent gates, an untested tenant-isolation path, an EOL runtime, docs the code contradicts. Opt-in, capped (20), deduped against your board, every item shown with its evidence first, each carrying the `adopted` label and the scan commit. A finding whose *location* is the disclosure (a credential in history, a PII fixture) goes on the board without it — a tracker item may be a public issue |
| **Has the codebase drifted since we adopted?** | Re-run `/aidlc:adopt`. It reads the previous profile and reports a **drift** section: what the code changed, what config no longer matches, and — kept separate and never proposed for overwrite — **what you edited by hand**. At the same commit and depth it writes nothing at all |
| **Pilot on one repo before rolling out** | `--only <repo\|package>` on `/aidlc:adopt` and `/aidlc:adopt-apply`. The config records both the scope (`adoption.only`) and the exclusions (`adoption.unmanaged`), so later scans report the rest as unmanaged-by-choice instead of nagging |
| **Config written by an older plugin version** | `/aidlc:adopt-apply` upgrades it in place as its own small diff: keys are **relocated, never rewritten** (your commands stay verbatim), and the moves are recorded in `adoption.upgrades[]` |
| **The evaluation is over — take it out** | `/aidlc:remove` (`--dry-run` first). Deletes the framework's files, reverts only the sections it merged into `CLAUDE.md`/`settings.json`, and **keeps what you authored** — your ADRs, backlog, run history and the adoption report. Then verifies two things separately: `git status` shows **nothing outside the approved plan** (that is the promise), and each file it merged into is compared against `git show <adoption.commit>:<file>` — identical means restored, and any remaining difference is **your own edits since adoption**, shown for you to confirm rather than reported as a failure. The plugin itself goes with `/plugin uninstall` |
| **A whole project from a requirements doc/brief** (Word/PDF or chat) → infers architecture (mono/poly, stack, monolith-vs-microservices), populated board + sprint plan | `/aidlc:bootstrap ./requirements.docx` |
| **An opinion, not a task** — "would this feature sit right in our project?", "should we use X here?" | `/aidlc:do would a notifications service fit our architecture?` (grounded recommendation; **no item created**) |
| **A small obvious fix** — a typo, a rename, a stray log line, an off-by-one | `/aidlc:do fix the typo in the header` — done directly: edited, gated, committed on your current branch. **No item, no PR** (§1b) |
| Anything at all, and you'd rather not pick a command | `/aidlc:do <whatever>` — it grounds itself, picks the lightest tier that fits, then routes |
| **"I want X" — requirement in your head, not in the backlog yet** | `/aidlc:intake add avatar upload, max 5MB` |
| Describe it AND build it in one go | `/aidlc:run add avatar upload, max 5MB` (free text → items → pipeline) |
| "Just work on the next most important thing" | `/aidlc:next` |
| Work a specific item | `/aidlc:run PROJ-123` |
| Yesterday's run stopped / new session / anything interrupted | `/aidlc:run PROJ-123` (same command — it resumes) |
| "Where is everything?" | `/aidlc:status` |
| Backlog is messy / items missing AC / before sprint planning | `/aidlc:groom` |
| **The client changed their mind about the order** — "checkout before search", "security items first for the audit", a revised requirements doc | `/aidlc:replan client wants checkout live before search` (§2a) — re-sequences what hasn't started into **waves**; work in flight finishes untouched; **nothing is written to your tracker** |
| **You want the work phased** — "all the backend first, then the UI", "everything for the demo, then the rest" | `/aidlc:replan complete all BE first and then start with UI` (§2a) — same command; a grouping directive becomes a hard barrier, not just a re-ranking |
| Work several items at once | `/aidlc:sprint 3` |
| **Make a screen or the whole app award-grade** (new or existing) | `/aidlc-ux:design /dashboard` · `/aidlc-ux:design "redesign the landing page"` |
| Same, anchored to your brand | drop a logo/font/screenshot in `design/brand/` (or set `ux.brand`), then run `/aidlc-ux:design …` |
| **The screens are already designed in Figma** | `/aidlc-ux:figma <figma-url>` to link them, then `/aidlc-ux:design /dashboard` (or just `/aidlc:run PROJ-123`) builds to the design (§3a) |
| The designer changed the Figma | `/aidlc-ux:figma sync` — re-extracts and tells you which built screens now disagree |
| Cut a version | `/aidlc:release` |
| A local skill proved reusable | `/aidlc:promote <name>` |
| After `/plugin marketplace update` | `/aidlc:sync` |

### 2a. When priorities change mid-project

Clients change their minds, and they do it while things are running. `/aidlc:replan` is the command
for that — it changes **when** work happens, never **what** the work is.

**You tell it how you want things re-planned, in your own words.** That argument is the whole input:

```
/aidlc:replan client wants checkout live before search
/aidlc:replan complete all BE first and then start with UI
/aidlc:replan security items first for the audit
/aidlc:replan ./requirements-v3.docx
```

Point it at a revised requirements doc and it diffs against what the backlog already reflects. Run it
**bare** and it asks you what changed rather than guessing — and "nothing changed, just re-derive from
the board" is one of the answers, which is what you want after a grooming pass or a decomposition.

Two kinds of directive, and the difference matters:

- **Ordering** — *"checkout before search"*. Moves items up and down one list.
- **Grouping** — *"all BE first, then UI"*. Says *all* of one group before *any* of another. This is
  not the same thing, and re-ranking cannot deliver it: rank the backend 1–3 and the UI 4–5 and a
  scheduler will still start a UI item in wave 1 the moment a slot frees up. In a multi-repo workspace
  it *always* will, because the free frontend slot has nothing else to put in it. So a grouping
  directive becomes a **barrier** the packer enforces, and you see it drawn in the plan.

**What comes back is a schedule, not a list.** Re-ordering alone would quietly cost you the
parallelism: move one item to the top and a frontend/backend pair that used to build side by side ends
up in two separate steps for no reason anyone can name. So a replan re-packs as it re-orders, into
**waves** — each wave a set of items that genuinely can run at the same time:

```
Replan — driver: "client wants checkout live before search"

In flight (wave 0 — finishes as-is, not re-planned):
  PROJ-101  backend   implement   ← now outranked by PROJ-102, but it lands first

  wave 1   PROJ-102 backend  Checkout contract (OpenAPI)   ‖  PROJ-110 frontend  Search filters
  wave 2   PROJ-103 backend  Checkout endpoint             ‖  PROJ-104 frontend  Checkout UI
  wave 3   PROJ-120 db       Search index migration

Held:   PROJ-111 blocked · PROJ-112 unrouted — route it and re-plan
Board deltas (not written): PROJ-102 P3→P1, PROJ-110 P1→P3
```

Ask for phasing and you get the same schedule with the barrier drawn in it, plus what it cost:

```
Replan — driver: "complete all BE first and then start with UI"   [grouping: backend → ui]

  stage backend
    wave 1   PROJ-102 backend  Orders API   ‖  PROJ-120 db  Schema migration
    wave 2   PROJ-103 backend  Payments API
  ──── barrier ────
  stage ui
    wave 3   PROJ-104 frontend Checkout screen
    wave 4   PROJ-105 frontend Order history

Cost:   4 waves, was 2 — PROJ-104/105 could have run alongside the backend. That is the directive.
```

Notice the backend items still run **side by side** inside their own stage. "All BE first" holds the UI
back; it does not put the backend in single file. And notice the cost line: a barrier trades throughput
for order, and you are the one who should decide that was worth it.

**Starting the work — the plan does not launch itself.** A replan writes the schedule; you start each
wave by hand:

```
/aidlc:sprint     # launches the current wave's items together → "wave 1 done — wave 2 is …"
/aidlc:sprint     # the next wave, when you're ready
/aidlc:next       # or one item at a time from the current wave
/aidlc:status     # which wave you're on, and whether the plan has gone stale
```

`sprint` and `next` both read the plan and follow it. `/aidlc:run PROJ-123` does **not** — you named an
ID, so you get that ID, whatever wave it sits in. It will say so in one line (`PROJ-104 is plan wave 3
(stage ui); wave 1 has 2 open items. Running it anyway.`) and then run it. Nothing is blocked and
nothing is re-planned; the next sprint just finds that item already done.

Wave *N+1* becomes current when wave *N* is finished, but no command loops — crossing a wave boundary,
and especially crossing a stage barrier, is always you pressing the key.

**Three things worth knowing before you run it:**

- **Work in flight is never touched.** Anything already running is pinned to wave 0 and finishes exactly
  as it is — no pause, no reordering, no abandoning. A change half-applied across many files (and, in a
  multi-repo workspace, many repos) costs far more to unwind than the time a stop would save. If the new
  order says a running item should have waited, the report says so and it lands anyway. Note this is
  **per story/task**, not per epic: an Epic showing *In Progress* because one child started does not
  freeze its other children.
- **Your tracker is not modified.** No priority field, no dependency link, no sprint assignment is
  written. The plan lives at `.aidlc/plan.md` and is what AIDLC follows; your board stays exactly as
  your product owner left it. The "board deltas" line lists the edits that would make the two agree —
  apply them yourself if you want that, or don't.
- **A stale plan gets ignored loudly, never followed quietly.** If grooming later splits or re-routes a
  planned item, `/aidlc:next` and `/aidlc:sprint` say so and fall back to plain priority order rather
  than following a schedule that no longer describes your backlog. `/aidlc:status` shows the plan, which
  wave you're on, and whether it has gone stale. Re-running `/aidlc:replan` is cheap — it creates
  nothing and changes nothing.

Some items may come back **held** rather than scheduled — blocked, not yet routed to a repo, or sitting
on a dependency cycle. That is deliberate: the packer refuses to guess placements it cannot prove are
safe, and each one is listed with the reason so it becomes grooming work rather than a silent omission.

A barrier yields in exactly two situations, and tells you both times rather than quietly doing it:

- **A held item does not stall the stages behind it.** One blocked backend ticket must not freeze the
  entire UI half of your board, so the next stage opens and the report says the grouping was not fully
  met. Unblock it and re-plan, or accept the order you got.
- **A real dependency outranks the grouping.** If something in the backend genuinely depends on
  UI-stage work, the barrier relaxes rather than scheduling a build against something that is not
  there. A dependency is correctness; a phase is a preference.

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
   the decision is hard to reverse). **If the item already has child Tasks on the board, those *are* the
   plan** — AIDLC adopts them rather than inventing its own breakdown (§3d).
4. **implement** — implementer codes plan-task by plan-task, conventional commits, tests green; each
   commit names the Task it spent, and closing a plan step closes that Task (§3d). Where
   the plan's tasks touch **provably disjoint files**, several implementers work them at once — see §3c.
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

**If the screens already exist in Figma, it doesn't design anything.** The pod has two sources, and
it picks one before it starts. When a Figma design is linked — `ux.figma` in config, a
`figma.com/design/…` URL on the item, or a spec already extracted — the design decisions are *already
made and signed off*, so the pod switches tracks: it reads the file through the Figma MCP (screen
spec, variables, reference screenshots), **maps the Figma variables onto your project's tokens**
instead of inventing a palette, builds to the spec, and then checks **fidelity** — the built screen
rendered side by side with the Figma frame, every difference classified blocking / minor / deliberate
adaptation. Pass is *zero blocking deviations*, not a score.

**And the jury is optional there.** Scoring someone's approved design out of 10 and then "fixing" it
toward a 9 would overwrite their decision, so on Figma-sourced UI the jury doesn't gate — it's
**offered** after fidelity passes ("want the jury to look at it as well?"), skipped silently on
headless/sprint runs, and advisory when you say yes: findings that mean *the build missed the design*
get fixed, findings that mean *the design could be better* go to you and your designer as suggestions
and are never built. Set `ux.figma.jury` to `advisory` (always run, never gate), `off`, or `gate` if
you treat Figma as a starting point and do want the full jury loop. Two things the pod will not do:
improve the design on its own, and invent a design when the Figma read fails — an unreachable or
unauthenticated Figma MCP **blocks the run and says so** rather than quietly designing screens the
client never approved. The one deviation it makes without asking is fixing contrast that fails WCAG
AA, and it always tells you.

**Linking and re-syncing.** `/aidlc-ux:figma <url>` links a file: it inventories the frames, maps them
to your actual routes (reading the router, not guessing from names), writes `ux.figma`, and extracts
the spec. `/aidlc-ux:figma sync` re-reads after the designer moves and reports **drift** — what
changed in the design and which built routes now disagree. `/aidlc-ux:figma` with no argument reports
status. Partial coverage is normal: mapped routes run the Figma track, unmapped ones run the design
track below, under one design system. Figma reads are rate-limited (a Starter plan or View/Collab seat
gets only a handful of tool calls *per month*), which is why everything is extracted once into
`design/figma-spec.md` and worked from there.

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
`renderBaseUrl`, `target` (`desktop-web`), and `figma` (`enabled`, `url`, `fileKey`, the `screens`
route→node map, `jury`, `maxFidelityRounds`). In a polyrepo or a monorepo these are **per repo and
per package** — different frontends have different design files and different dev ports. All
artifacts land in `design/` (narrative, inspiration, design-system, motion-spec, audit, brand,
per-round jury reports, and on the Figma track `figma-spec.md`, `figma/` reference shots and
`fidelity-report.md`) and are committed to the branch — so the reasoning, every score and every
deviation from the design are auditable in the PR.

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

### 3c. When one item is worked by several agents at once

Two places the pipeline runs work concurrently inside a single feature. Both are on by default and
neither trades away review.

**Wide mechanical changes fan out across files.** Ask for *"pagination on every table"* and the plan
comes out as a shared component plus one task per screen. The shared component is built first (everything
depends on it), then the screens are implemented **in parallel** — up to `pipeline.implementFanout.maxAgents`
(default 3, hard cap 5) at a time. You still get **one branch and one PR**: the agents edit and report,
and the orchestrator does all the committing, so there is exactly one writer to git. The gate runs once,
after the batch lands.

What keeps it safe is that disjointness is **computed, not assumed** — a task that declares no files, or
that touches something with one-writer semantics (a barrel export, a route table, a lockfile, an i18n
catalog, a migration, a declared API contract), is run on its own and the run file says why. The
`fanout:` line on the run file records exactly what overlapped, e.g. `1 -> [2|3|4] -> 5`.

The one thing worth configuring is `implementFanout.sharedPaths`: if your project has its *own*
aggregator — a central theme file, a generated registry, a hand-maintained DI container — name it there.
The built-in list only knows the conventional ones. Set `enabled: false` to have every item implemented
by a single agent start to finish.

**Frontend and backend run at the same time, via a contract.** When a feature needs both, AIDLC does
*not* queue the frontend behind the backend. It creates a small **contract item** first — an OpenAPI path,
a GraphQL type, a `.proto` message, or a shared exported type — and then the backend and frontend items
each depend on *the contract* rather than on each other. Once the contract lands, both run concurrently
(their own repos, branches and PRs; `/aidlc:sprint` picks them up together). The frontend builds against
generated types and contract-derived fixtures, so it never sits waiting for a running backend.

Because each side is then verified only against the contract, the feature gets an **integration join**
when both are done: your contract tests, or the e2e path that exercises the real call, run at the
epic/feature level. If your project has neither, that is reported as a `MAJOR` finding rather than quietly
passing — with the two sides built in parallel, the contract is the only thing holding them together, and
you should know if nothing tests the seam.

And the case that saves the most time: **when the interface already exists and your feature doesn't change
it, there is no contract item and no waiting at all** — both sides start immediately.

### 3d. Tasks: the tier your effort is counted in

A Story is what gets a branch and a PR. That is a fact about **git** — a branch and a PR are one per
repo, and a Story is the smallest thing you can review and revert on its own. It is *not* a claim that a
Story is the unit of work. On most boards it isn't: a Story says something, and the **Tasks** beneath it
are what actually has to be done. ADO models exactly that — story points on the Story, remaining hours on
the Task.

The pipeline holds both. The run file's plan has always been a list of commit-sized steps; your board's
Tasks are that same list, authored by a human. So AIDLC **binds them** instead of keeping a private
second copy:

```
## Plan
- [x] Add the profile DTOs      ·  paths: src/dto/profile.ts       ·  wi: PROJ-145
- [x] GET /profile endpoint     ·  paths: src/profile/*.ts          ·  wi: PROJ-146
- [ ] Wire the settings form    ·  paths: src/screens/settings.tsx  ·  wi: PROJ-147
```

Three things follow:

- **Your Tasks become the plan.** If `PROJ-123` has child Tasks, AIDLC adopts them in *your* board order
  rather than inventing its own breakdown. It still grounds each one in the code — adding the file paths
  and ordering edges a board can't carry, which is what §3c's fan-out reads.
- **Commits name both.** `Refs: PROJ-123, PROJ-145` — the Story that owns the PR, the Task whose effort
  the commit spent. `git log --grep PROJ-145` now answers "what did this task actually cost".
- **Ticking a checkbox closes the Task.** Progress lands on the tier your burndown reads, instead of a
  Story sitting Active for two days while every Task under it says New.

**One PR, still.** Binding commits to Tasks does not make a Task the leaf — "add the DTO" is not
independently shippable, so it does not get its own PR. (If you genuinely want a branch per Task, that's
`workspace.crossRepoSplit: "task"` in §1a — a different trade.)

**AIDLC never writes an estimate.** Not story points, not remaining hours, not priority — in any mode.
Those are your record of what you asked for and what you think it costs; the pipeline moves Tasks through
their *states* so the burndown is honest about what's **done**, and leaves the numbers alone. An invented
estimate would just make velocity a measurement of the tool's guesswork. (On ADO, note it doesn't zero
`RemainingWork` on close either — if your burndown needs that, it's a process rule for you to set.)

The knob is `pipeline.taskSync`:

| `mode` | Behaviour |
|---|---|
| **`adopt`** (default) | Where a Story has Tasks, adopt and update them. Where it has none, do exactly what it always did and **create nothing** — so a board that doesn't use the Task tier notices no difference. |
| `author` | Also **offers** to create a Task per plan step where a Story has none — shown for approval first, never a silent write. |
| `off` | The plan stays private; nothing below the Story is read or written. |

Set `taskSync.trailer: "leaf"` if your tooling parses commit trailers strictly and can't take a second id.

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

**If a sprint was interrupted:** each item's run file survives independently — `/aidlc:status`
shows them. In **mono**, resume an item inside its worktree; in **poly**, resume it with
`/aidlc:run <ID>` from the control plane as usual (there is no worktree — the run already lives in
its own repo checkout). Either way you can re-launch `/aidlc:sprint` to fill free slots.

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
| Run blocked: "figma MCP unavailable" | Deliberate — it won't invent a design in place of one you already had approved. `/mcp` → `figma` to authenticate (OAuth), then rerun. No Figma seat? Drop exported PNGs in `design/figma/` (screenshots only — no variables), or set `ux.figma.enabled: false` to let the pod design it |
| Figma read hit a rate limit | Starter plans and View/Collab seats get only a few Figma tool calls per month; the spec is extracted once into `design/figma-spec.md` so the build works offline from it — re-`sync` sparingly, or move to a Dev/Full seat |
| Built screen doesn't match the design | Read `design/fidelity-report.md` — every difference is classified blocking / minor / adaptation with both screenshots. At `ux.figma.maxFidelityRounds` the leftovers become `[MAJOR][open]` findings instead of another round |
| Designer changed the Figma after you built | `/aidlc-ux:figma sync` — it diffs the design and names the routes that now disagree; feed those to `/aidlc:intake` or `/aidlc-ux:design <route>` |
| You *do* want the jury on a Figma design | Say yes when it offers, or set `ux.figma.jury: "advisory"` (always runs, never gates) or `"gate"` (full jury loop, Figma treated as a starting point) |
| Headless run: "Ignoring N permissions.allow entries … workspace has not been trusted" | Open Claude Code interactively in that folder once and accept the trust dialog (or set `projects["<path>"].hasTrustDialogAccepted: true` in `~/.claude.json`), then rerun — the run resumes where it stopped |
