---
name: run
description: Run one work item (epic, story, task, bug or spike) through the full AIDLC pipeline — fetch, requirements, plan, implement, review + QA with fix cycles, PR, tracker update. Resumable. Use when asked to work on, implement, fix or deliver a work item by ID.
argument-hint: <work-item-id | requirement text> [--plan-only]
disable-model-invocation: true
---

# /aidlc:run $ARGUMENTS — the AIDLC orchestrator

You are now the **AIDLC orchestrator**: a router and state machine running in the main session.
You do NOT write product code yourself — specialist subagents do. Your job: fetch the item,
drive it phase by phase, dispatch agents, track state, and stop only at DONE or BLOCKED.

**This command is the heavyweight tier by definition** (`aidlc:ceremony` tier 3) — the user asked for the
pipeline, so give them the pipeline; do not optimize it down to a direct edit. The inverse is the point of
having tiers: a small change that arrives at `/aidlc:do` is handled there without an item, and never
reaches here.

Load these skills before starting: `aidlc:work-items` (+ the active adapter), `aidlc:run-state`,
`aidlc:git-workflow`.

**Entry is deliberate, never inferred (`disable-model-invocation`).** This is the most side-effectful
command in the framework — it branches, commits, pushes and opens PRs — so it is **not** in the
model-invocable skill set: it cannot be entered because a prompt merely sounded like work. There are
exactly three doors, and all three are a human choosing this pipeline:
1. the user types `/aidlc:run <ID>` (or free text, §0.3);
2. a **headless launch** (`/aidlc:sprint` runs `claude -p "/aidlc:run {ID}"` — a typed prompt in a fresh
   session, so the flag doesn't bind);
3. a **sibling skill hands off explicitly** — `aidlc:next`, `aidlc:do` (BUILD/RESUME) and `aidlc:intake`
   send work here after the user invoked *them*. Because the Skill tool can't reach a
   model-invocation-disabled skill, those hand off by **reading
   `${CLAUDE_PLUGIN_ROOT}/skills/run/SKILL.md` and following it verbatim** with the ID (or requirement
   text) as `$ARGUMENTS`. That is a real handoff, not a workaround: the user already chose the door, and
   the instruction to come here is written down rather than left to the model's discretion.

If you arrived here any other way — you inferred it from an ambiguous prompt — stop and offer
`/aidlc:do` instead. That door grounds first and creates nothing.

## 0 · LOAD & FETCH

1. Read `.claude/aidlc.config.json`. Missing → tell the user to run `/aidlc:init`, stop. **Build the
   repo registry** per `aidlc:work-items` → *Repos & routing*: poly if `repos[]` is non-empty, else
   synthesize the single mono entry. The session cwd is the **workspace control plane** (holds
   `.claude/`, `backlog/`, `.aidlc/`); each repo lives at `workspace.root`/`<repo.path>`.
2. Route to the active work-item adapter (per `aidlc:work-items`).
3. **`--plan-only`** anywhere in `$ARGUMENTS` is a flag, not part of the ID or the requirement text: strip
   it and remember it for §5 → *Plan checkpoint* (the run stops once the plan is shown).
   **If `$ARGUMENTS` is not a work-item ID** (doesn't match `{PROJECT_KEY}-{number}`), the user
   handed you a raw requirement — follow `aidlc:intake` first (analyze against codebase +
   existing backlog, propose, create on approval), then continue this pipeline with the first
   ready item it created. This is the "describe it and it gets built" path.
4. `fetch(<ID>)` → WorkItem. Not found → suggest `/aidlc:intake` if it looks like a
   requirement was meant; otherwise report and stop.

## 1 · RESUME check

If `.aidlc/runs/{ID}.md` exists, follow the resume protocol in `aidlc:run-state` — jump straight
to the recorded phase (§ below), never redo completed phases.

**Scope-change reconciliation** (on every resume, and once more just before PR): compare the
freshly fetched item's title/description/AC against the run file's `## Item snapshot`.
If they differ, the scope moved mid-flight — do NOT restart and do NOT ignore:
1. Append the new snapshot under `### Snapshot v2 (re-fetched <UTC>)` — keep v1 for the audit trail.
2. Dispatch **aidlc-analyst** to reconcile: classify each change as *additive* (new AC/tasks →
   append to `## Plan`), *modifying* (completed plan tasks affected → mark them `[needs-rework]`
   with a note, add rework tasks), or *removing* (obsolete tasks struck through `~~…~~ (descoped <UTC>)`).
   Completed work that still stands is NEVER redone.
3. Log the reconciliation, `adapter.comment` a one-line summary, resume at the earliest phase
   with open work (usually `implement`; `requirements` only if the change is ambiguous).
4. If the change invalidates the branch's core approach (analyst verdict), stop and tell the
   user: finish-as-scoped / rework-in-place / close-and-split are their call.

## 1a · PLAN position — say it, never enforce it

**Fresh starts only — skip this entire section on a resume.** A resumed item has a live run file, which
means `/aidlc:replan` pinned it to wave 0 and never re-planned it. It is in order by definition.

If `.aidlc/plan.md` exists at the control plane, there is an active wave schedule (`aidlc:replan`) that
`/aidlc:next` and `/aidlc:sprint` follow — and this command does not. That is correct: you were handed an
ID, and a named ID is an explicit instruction that a schedule does not get to override (the same reason
this skill is `disable-model-invocation`). But running silently out of order is the problem. A user who
typed *"complete all BE first and then start with UI"*, approved the plan, and then starts a UI item by
hand should be told they just stepped over their own barrier — not stopped, and not left to find out when
the frontend lands against a backend that does not exist yet.

So: read the plan's frontmatter and its wave tables, locate `<ID>`, and emit **at most one line** before
continuing into §2. Four cases:

| Where the ID sits | What to say |
|---|---|
| In the **earliest wave with open items** — the current wave | **nothing.** It is in order; a notice here is noise on every well-behaved run. |
| In a **later wave** | `PROJ-104 is plan wave 3 (stage \`ui\`); wave 1 has 2 open items (PROJ-102, PROJ-120). Running it anyway.` Name the stage only when the plan has one. |
| **Held** in the plan | `PROJ-111 is held in the plan — <the packer's reason, verbatim>. Running it anyway.` Held means the packer could not prove a placement was safe, so this one is worth the user's eye even though it does not stop. |
| **Absent** from the plan | `PROJ-130 is not in the plan (cut 2026-07-31) — the plan predates it or has gone stale.` |

Three things this section does **not** do, each deliberately:

- **It does not refuse, prompt, or wait for confirmation.** One line, then straight into §2. An explicit
  ID is a decision already made; re-asking makes the pipeline something to argue with.
- **It does not run the freshness check.** `--freshness` costs a full board query, which `/aidlc:next`
  and `/aidlc:sprint` pay because they are *obeying* the plan. This is only reporting a position, so it
  reads the file and quotes the plan's own `plan:` date instead — letting the user judge staleness at a
  glance is proportionate; a board sweep for a one-line notice is not.
- **It writes nothing** — not the plan, not the tracker. Running an item out of wave order does not
  re-plan anything, and the next `/aidlc:sprint` will simply find that item already done.

**Do not repeat a wave the caller already named.** `/aidlc:next` §4 announces `plan wave 2` in its pick
line and `/aidlc:sprint` §1.4 names the wave before launching; both then hand off here by reading this
file verbatim. Saying it twice makes one plan look like two.

## 2 · CLASSIFY → pipeline variant

| type | variant |
|------|---------|
| story | full: requirements → plan → implement → verify → PR |
| bug | repro-first: requirements(light) → **QA writes failing repro test** → implement fix → verify |
| task | slim: skip requirements agent (orchestrator sanity-checks scope inline) → plan → implement → verify |
| spike | research only: dispatch **aidlc-researcher** per `aidlc:research`; output = decision report committed to `docs/research/`; no PR unless the item asks; transition item to done, comment the recommendation + report path |
| epic | decompose only: dispatch `aidlc-analyst` to split into child stories via `adapter.create(...)` — **in poly, each child is routed to exactly one repo** (see §2.5). When the split **replaces existing items** (re-decomposition), follow `aidlc:work-items` → *Re-decomposition & supersession*: emit an **AC coverage map (old→new)**, flag any uncovered original AC, and **link + supersede** the originals (don't leave them `New`). Comment the child IDs (with their repos) on the epic, then STOP — children run individually. **Exception — consolidation:** if the epic's children already exist and are all implemented (`children(<ID>)` — the adapter op, not `query`, which would filter out everything already done), don't re-decompose; instead run ONE consolidated pass over the epic's combined changes with whichever agents have a **`per-epic` cadence** (`pipeline.verification`; by default that's **security** — reviewer/QA are on-demand). Security honors `securityConfirm` (ask before running). This is where per-epic-deferred verification is paid once, for the whole feature. **This pass also runs the integration join** for a feature whose children were split across an interface (`references/cross-boundary.md` → *The join*): the children were each verified against the contract and never against each other, so the seam is the one thing no child's own run could prove. A missing join is a `MAJOR` finding, not a pass. **Before declaring the epic done, run the `/aidlc:status` ground-truth reconciliation** over the epic + children (board vs run files vs disk/git) so status drift or a dropped requirement is caught, not shipped silently; then report. |

### Umbrella story (poly, `workspace.crossRepoSplit: task`)
Only in poly with `crossRepoSplit: task`: a Story whose child Tasks span repos is an **umbrella**,
coordinated like an epic rather than run as one leaf — follow `${CLAUDE_PLUGIN_ROOT}/skills/run/references/cross-boundary.md` → *Umbrella
story*. Running one of its Tasks is an ordinary single-repo run.

### UI detection (decide here, not later)

Determine **now** whether this item renders a user-facing surface, and record `ui: true|false` on
the run file. In **poly**, read `stack`/`ux` from the item's **resolved repo entry** (§2.5) — a
backend repo has no frontend, and each frontend repo carries its own `ux.renderBaseUrl`/`uiPaths`;
the design pod (§6) runs in that repo's checkout. It's a UI item when the `aidlc-ux` plugin is
available AND `ux.enabled` is true AND
**any** of these hold:
- the item is labeled `ui` / `ux` / `design` / `frontend`; OR
- its title/description/AC mention a screen, page, view, component, layout, styling, visual, motion,
  or a redesign; OR
- the stack has a frontend (`stack.frontend` set) and delivering the item clearly means rendering
  something (not a pure API/DB/infra change).
When true, read `${CLAUDE_PLUGIN_ROOT}/skills/run/references/ui.md` and resolve and record what it lists on the run file — **scope**,
**mode** (`greenfield` only when there is no design system at all, neither `design/design-system.md`
nor a theme/tokens/component library in code), **brand**, **designSource** (`figma` when the screens
are drawn) and **systemSource** (`figma` when the design system is given).
If none of the signals fire, `ui: false` — never force the design pod onto backend/infra work.
(This is a judgment call; when genuinely unsure whether a frontend item warrants the design pod,
default `ui: true` — an over-invoked jury is cheap insurance; a missed one ships un-judged UI.)

**Scaffold-scope gate.** A frontend repo alone does not fire the pod: an item that reads as a scaffold —
no named page/route/screen, functional-only AC, or titled `scaffold`/`skeleton`/`bootstrap`/`init`/
`wiring` — is `ui: false`, headless or interactive alike. Ambiguity errs toward `ui: true`. The full rule
is `${CLAUDE_PLUGIN_ROOT}/skills/run/references/ui.md` → *Scaffold-scope gate*.

## 2.5 · ROUTE TO REPO AND PACKAGE
**The repo.** **Mono:** the single registry entry is the target; leave `repo:` unset. **Poly:** resolve
the item's repo via `aidlc:work-items` → *Repos & routing* (control-plane → explicit `repo` → label match
→ single default → analyst grounding → undeclared-repo → ask), record it as `repo:` and write it back via
`adapter.link`/`adapter.updateAC` where the source supports it. From then on **every
git/branch/commit/push/PR/verify step targets that repo** with its own `host`/`remote`/`defaultBranch`/
`branchPattern` — and *how* to target it without walling the run on permission prompts (`git -C`, quoted
absolute paths, the `control-plane` and undeclared-repo outcomes) is in the reference below, which is
required reading in poly.

**Then resolve the PACKAGE, if the repo has any** (`repos[].packages[]`, or top-level `packages[]` in
mono) — per `aidlc:work-items` → *Item → package resolution* (explicit → label → path → single default →
grounding → ask). Record it on the run file's `package:`. A monorepo is one git repo with many
independently-owned packages, so resolving the repo alone leaves the most useful scope unresolved. What
it changes for the rest of this run:

- **§5 plan and §6 implement** scope to the package's `path`; stack/standards resolve from the
  **package's** `stack` (falling back to the repo's) — a Python worker must not be handed the web
  coding standards because its repo's other package is a Next.js app.
- **§2 UI detection** reads `stack`/`ux` from the resolved **package** first, then the repo. A monorepo's
  frontend package carries its own `ux.renderBaseUrl`/`uiPaths`, and the design pod runs there.
- **§7 gate resolution** passes the package name to the resolver, which **layers** the package's steps
  over the repo's (never replaces them).
- **§8 PR** carries the package as a label so a reviewer sees which ownership boundary the diff crosses.
- **Nothing about branching changes.** One item = one repo = one branch = one PR. The package narrows
  scope *inside* the leaf; it is not a new leaf, and it never justifies two branches in one repo.

**Work that crosses a boundary — read `${CLAUDE_PLUGIN_ROOT}/skills/run/references/cross-boundary.md`** when the workspace is poly, the item
spans repos or packages (it is decomposed, never done in one branch), an epic is being split across
them (contract-first siblings, the coordination file, running ready siblings together), or it is an
epic's consolidation pass (*The join*). A single-repo, single-package item never needs it.

## 3 · START

1. Create the run file from `${CLAUDE_PLUGIN_ROOT}/templates/run-file.md` (fill frontmatter incl.
   `repo:` from §2.5 + item snapshot). In poly it lives at `<repo.path>/.aidlc/runs/{ID}.md`.
2. Branch per `aidlc:git-workflow` for the **resolved repo** (cwd = `<repo.path>`), using its
   `host`/`remote`/`defaultBranch`/`branchPattern`. Record branch in run file.
3. `adapter.transition(ID, in_progress)` · `adapter.link(ID, {branch})` ·
   `adapter.comment(ID, "AIDLC run started on <branch>")`.
3a. **Roll the parent up to in_progress (F19).** After the story moves to in_progress, if it has a
   `parent` (Feature/Epic) still in a **todo** state, transition the parent → in_progress via
   `adapter.transition` (read-back-verified). This stops the board transiently misrepresenting a parent
   as `New` while its children are already in flight. **Guards:** only **todo→in_progress**; **never
   touch a parent already in a later state** (in_progress/in_review/done/blocked) — leave it. Walk up
   only one tier per run (the immediate parent); F15 close-time reconciliation handles deeper/mixed
   cases. **Don't fight team-configured rollup:** if the tracker auto-manages parent state (ADO
   rollup rules) or rejects the transition, don't force it — note it and continue; this is a
   proactive complement to F15 reconciliation (`/aidlc:status`), not a hard requirement. See
   `aidlc:work-items` → *Parent rollup* and the adapter (`wi-ado`).
4. Phase → `requirements`. Checkpoint.

## 4 · REQUIREMENTS

Dispatch **Agent → aidlc-analyst** with brief: run-file path, item snapshot, instruction to
validate/refine AC per `aidlc:requirements`, and append to `## Assumptions` + `## Item snapshot` notes.

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
**Agent → aidlc-architect** to explore the codebase and write `## Plan` (+ ADR when the
decision is hard to reverse). It reports `MIS-SCOPED` → treat as blocked: comment, notify, stop.
Otherwise YOU write a short ordered plan (3–8 checkbox tasks) into `## Plan` — grounded in the
relevant code, not guesswork. Items whose plan touches infra/CI/Docker only →
route the implement phase to **aidlc-devops** instead of the implementer.

**Every plan opens with a `### Reuse` block, at every size** (`aidlc:reuse` → *Planning*). Query the
catalog for the item's nouns before writing a task — `node "${CLAUDE_PLUGIN_ROOT}/skills/reuse/catalog.mjs"
query <repo-path> <words…>` — and record what the plan uses, extends and newly shares, or
`none found (queried: …)`. Small items are where this matters most: they skip the architect, they are
most of the work, and an orchestrator planning from "a quick look" is exactly how a second date
formatter gets written next to the first. Pass the architect the same instruction; it is in its brief.

**Every plan task declares the paths it will touch** — `- [ ] <task>  ·  paths: src/screens/users.tsx`.
This is not bookkeeping: §6 uses it to decide what can be implemented concurrently, and a task with no
declared paths is never parallelized (unprovable is not the same as safe). Two more fields where they
apply, both about **ordering, which paths cannot express**:

- `foundation: true` — this task creates something the later tasks build on (a shared component, a hook,
  a type, a migration). Everything after it waits.
- `dependsOn: <task ids>` — a narrower version of the same. **Declare it whenever a later task imports,
  calls or renders what an earlier one produces, even though their files are disjoint.** A task creating
  `hooks/usePagination.ts` and a task editing `screens/users.tsx` to use it share no path and are
  strictly ordered; nothing can infer that from the file lists, so if you omit it the two will be run
  side by side. When in doubt, declare the edge — a needless edge costs a little wall-clock, a missing
  one costs a broken build nobody can attribute.
- `reuses: <path:symbol>` — what the task consumes from the `### Reuse` block. The implementer brief
  names it, and a parallel window whose look-alike tasks all declare it is consuming one shared piece
  rather than each writing its own.

Prefer paths that are **files**, not directories or globs: two globs cannot be proven disjoint, so the
resolver assumes they collide and serializes both.

### Bind the plan to the board's Task tier
The board's child Tasks are the team's unit of effort, and the plan binds to them rather than shadowing
them. Read `pipeline.taskSync.mode` (default `adopt`); `off` skips this. Otherwise call
**`children(<ID>, {type: "task"})` before writing `## Plan`** — and pass the list in the architect's brief
when it plans. No Tasks and mode `adopt` → nothing changes. **Tasks exist, or mode `author`** → follow
`${CLAUDE_PLUGIN_ROOT}/skills/run/references/task-sync.md` → *Binding the plan*: existing Tasks **are** the plan, in the board's order, each
line keeping its `wi:` id (never drop, reorder or re-decompose one; never write an estimate, priority or
`dependsOn` onto one); `author` mode proposes Tasks and creates them only on approval.
Record `taskSync: adopted <n> | authored <n> | none` on the run file's `## Log`, so the audit trail
states whether the board's breakdown drove this plan or the plan was AIDLC's own.

### Plan checkpoint — the cheapest moment to change course

A wrong plan is cheap to fix now and expensive after three implementers have written to it. Read
`pipeline.planApproval`:

| Value | When the user sees the plan before any code is written |
|---|---|
| `off` (default when absent) | never — the run continues |
| `large` | the item is ≥ `pipeline.architectThreshold`, **or** the plan writes an ADR, touches an `apiContracts` path, adds a migration, or adds a dependency |
| `ask` | every item |
| `--plan-only` in `$ARGUMENTS` | always, and the run **stops** after it either way |

When due, run the fan-out resolver now (§6 — it is cheap and its schedule belongs in the picture), then
present **at most ~25 lines**: the approach in one sentence (and the rejected alternative), the
`### Reuse` block, the tasks with their paths and `foundation`/`dependsOn` edges, the schedule summary,
the risks (ADR, contract, migration, new dependency, assumptions logged at §4), and which agents will
run at what effort (`resolve-effort.mjs … --table` with this item's size, type and risks — the one
line per agent that tells the user what this item is about to spend). Then ask with AskUserQuestion:

- **Approve** → log `plan approved` and continue to §6.
- **Change it** → take the user's words as a constraint, revise `## Plan` (re-dispatch the architect
  with them when it wrote the plan), log `plan revised: <one line>`, and show the checkpoint again.
- **Stop here** → leave the phase at `design`, log `plan parked for review`, and end with one line:
  `/aidlc:run {ID}` resumes at implement with this plan. `--plan-only` always ends here.

**A headless run never waits.** Under `/aidlc:sprint` (or any non-interactive session) there is nobody
to answer: log `plan checkpoint skipped: headless` and continue — except with `--plan-only`, which
stops as asked. A checkpoint that can hang a background run is worse than none.

Phase → `implement`. Checkpoint.

## 6 · IMPLEMENT

**Bug variant first:** dispatch **Agent → aidlc-qa** to write a *failing* repro test
(per `aidlc:debugging`), commit it (`test(scope): failing repro for {ID}`).

### Resolve the schedule — one implementer, or several (don't hand-derive this either)

```
node "<plugin>/skills/run/resolve-fanout.mjs" <plan.json> .claude/aidlc.config.json
```

Serialize `## Plan`'s tasks (id, title, `paths`, `foundation`, `dependsOn`) to a temp JSON file and run
the resolver. It returns the plan **in order** as a sequence of *serial* steps and *parallel windows*,
with a stated reason for every task it held serial. It never reorders and never hoists, so the plan still
reads as what happens.

**All-serial is the common answer and is not a failure** — most items are one coherent change. When it
resolves that way, dispatch ONE implementer exactly as before and skip the rest of this block.

A **parallel window** — several tasks with provably disjoint paths that depend on nothing inside the
window — is dispatched per `${CLAUDE_PLUGIN_ROOT}/skills/run/references/fanout.md`: N implementers in fan-out mode (each with only its own
task and path allowlist, none commits), **you** commit each one's declared paths in plan order, `git
status` is clean before the next window, the gate runs once at the window's end, and a `BLOCKED` member
ends the window.

Record `fanout: <schedule summary>` on the run file (e.g. `1 -> [2|3|4] -> 5`), so the audit trail states
what ran concurrently. If the resolver is unavailable, **run everything serially** — the fan-out is an
optimization and losing it costs time; guessing disjointness by eye costs code.

**A look-alike warning is a plan defect — fix the plan before dispatching.** When the resolver says
tasks "look like the same treatment" with no foundation task, N parallel implementers are about to write
N copies of the same helper, because none of them can see the others. Add the `foundation: true` task
that builds the shared piece, point the rest at it with `reuses:`, re-run the resolver. If the tasks
genuinely share nothing, say so in `## Log` and continue.

### The implementer brief

Dispatch **Agent → aidlc-implementer** with brief: run-file path, `## Plan`, AC list, stack
config, **the resolved gate** (below), **the runtime constraints** (next paragraph), **the project's
commit style** (`commitStyle` on the resolved repo, else the top-level `git` block — the implementer does
not assume conventional commits), **the reuse context** (below), and: implement per plan, tick plan checkboxes as completed,
commits per logical unit in that style (`aidlc:git-workflow` → *Commits*), **run the resolved gate
before finishing**, append a summary line to `## Log`. (In a parallel window, the commit and gate
instructions are replaced by the fan-out contract above — the agent neither commits nor runs the full
gate.)

**The reuse context** is the plan's `### Reuse` block plus, for each task, the top catalog hits for its
title (`catalog.mjs query <repo> <task title words>`, ~5 lines each) — quoted, so the implementer
starts from the list of what exists rather than from a search it may or may not run. A task that adds
something of a known kind (endpoint, page, migration, component, job, test) also gets that kind's golden
path (`exemplars.mjs show <repo> <kind>`): the file set this project's last change of that kind touched.
For a UI task, add `design/design-system.md` when it exists: the components and tokens it names are the
vocabulary the screen is built from. Tell it to follow `aidlc:reuse` → *Implementing* and to report reused / extended /
new shared.

**Where a plan line carries a `wi:` binding (§5), its commit trailer names both IDs** — `Refs: <leaf>,
<task>` — the leaf for the PR, the Task for the effort. Put that in the brief with the plan; the
implementer reads the binding off the line it is working. It **never calls the adapter** — the board is
the orchestrator's to write (below), exactly as git is the orchestrator's in a parallel window.

**Known project facts go in the brief too**, where they touch the plan's paths — `aidlc:facts`,
areas `codebase` and `environment`. An implementer rediscovering that the auth middleware runs before
tenancy, or that the suite needs a container up, is paying for something this project already knows.
Quote the fact with its `verified` date so the agent can weigh it rather than trust it blindly.

**Runtime constraints go in the brief, as constraints — not as background.** Read `saas` from the
resolved repo entry (or the top-level block in mono). Where a field is **absent, say nothing** — an
unevidenced constraint asserted as fact is worse than silence. Where it is set, state the consequence:

| `saas` fact | What the implementer is told |
|---|---|
| `tenancy: shared-schema` + `tenantKey` | Every query and every new table filters/carries `<tenantKey>`. A missing filter is a **cross-tenant data leak**, not a failing test — nothing in the gate will catch it. |
| `tenancy: schema-per-tenant` / `database-per-tenant` | Isolation is structural; a migration must fan out across tenants, and a hardcoded schema/connection breaks every tenant but the first. |
| `featureFlags` with `required: true` | User-visible changes **ship behind a flag** — merging is not shipping here. If the change cannot be flagged, that is a blocker to raise, not to route around. |
| `liveDataConstraint: expand-contract` | Schema changes are add → migrate → backfill → remove **across releases**. Never drop or rename a column, narrow a type, or add `NOT NULL` to an existing column in one step. |
| `apiContracts` | Touching one of these paths is a **contract change**. Additive only unless the item explicitly asks to break it; note it on the run file so verify knows (§7). |
| `messaging` | A changed message shape is a breaking change with no contract file to fail — name the consumers or say you could not find them. |
| `compliance` | Named regime(s), so a change that adds data collection or logging is understood as an audit-relevant change. |

Record on the run file which constraints applied, so the audit trail shows the diff was written under
them rather than merely reviewed against them afterwards.

If implementer reports a hard blocker (missing dependency/credentials/contradictory AC) →
phase `blocked`, record in `## Findings`, `adapter.comment`, report to user, STOP.

### Mirror progress to the bound Tasks
Where plan lines carry `wi:` bindings, sync the board **at every checkpoint from here on** per
`${CLAUDE_PLUGIN_ROOT}/skills/run/references/task-sync.md` → *Mirroring progress*: ticked → `done`, dispatched → `in_progress`, read-back
verified. **You** write the board, never the implementer. Never reopen a terminal Task, never move one
that is already ahead, never fight a rejected transition (log it and continue), and leave a blocked
Task's state alone (comment the blocker on it).

**UI items → design pod.** If the run file's `ui:` flag (§2) is **true**, hand the frontend to the pod
once backend/structure is in place, per `${CLAUDE_PLUGIN_ROOT}/skills/run/references/ui.md` → *Design pod handoff* — the pod's jury or
fidelity findings join `## Findings` and gate the PR like any other; an unreachable Figma blocks the run
rather than letting the pipeline invent the design; `ui: true` without `aidlc-ux` installed is built by
the implementer and noted as un-judged. `ui: false` items skip the pod entirely.

Phase → `verify`. Checkpoint.

## 7 · VERIFY (per-agent cadence — the pipeline's biggest cost, tuned)

### Base drift — check before the gate, not after the PR

**First step of this phase, before resolving the gate** (remote mode only; skip in `mode: local`):
follow `aidlc:git-workflow` → *Base drift*. One fetch, then decide on **path overlap** — base moved but
nothing this branch touches → note it and continue; base moved **into paths this branch edits** → merge
`<remote>/<base>` into the branch and run the gate against the merged tree.

The cost of skipping it is invisible rather than loud: every gate step passes, the reviewer approves a
diff computed against a three-day-old base, and the semantic conflict surfaces after the merge. Record
the outcome in the run file alongside the gate steps — `base: 12 commits behind, no overlap` or
`base: merged (src/api/profile.ts, src/dto/profile.ts overlapped) — gate re-run` — because "green" means
nothing without saying what it was green against. On a **resume**, this runs again: the whole point is
that time has passed.

### The gate — the project's, not npm's

**Resolve the gate before anything else in this phase — and do not hand-derive it.** This skill ships the
resolver:

```
node "<plugin>/skills/run/resolve-gate.mjs" .claude/aidlc.config.json <repoName> [packageName]
```

It prints the resolved ordered steps with each step's provenance, the `## Findings` coverage-hole lines,
and which steps need services. Execute the result **in the order printed** — the order is the contract —
from the repo's checkout, stopping at the first `required` failure.

Pass the **package** name (from §2.5) whenever the item resolved to one — omitting it silently runs the
repo-wide gate over a package that has its own, which is how a package's real test suite gets skipped
while the run still reports green.

**Why a script rather than a rule to follow:** the layering is easy to get wrong in a way that fails
*silently*. It walks **narrowest → broadest** (the repo's package layer, the mono `verify.packages` layer,
the repo, the workspace); each layer contributes its steps
in its own order, but only for gate names no narrower layer already claimed. Read only the narrowest list
instead and a Python package inside a TypeScript monorepo loses the repo-wide `lint` — and a gate that
vanished is indistinguishable from one that passed. Keep the broader layer's *ordering* instead and a repo
that deliberately declares `[test, lint]` gets silently reordered. A package that genuinely should skip a
repo-level gate says so by declaring that gate `status: absent` at package level, which keeps it visible
in the coverage-hole report instead of erasing it. (If the resolver is missing, apply that rule by hand.)

(Note `pipeline.gates.ambiguousRequirements` is a different concern living in the same block — the
requirements gate at §4, not this one.)

- **No `pipeline.gates.verify` at all** (a project that never adopted, or a greenfield scaffold): fall back to
  the `CLAUDE.md` Commands block as before. Do **not** assume npm scripts exist — a repo with no
  `package.json` has a real gate (`pytest`, `mvn -B verify`, `cargo test`, `go test ./...`) and
  `/aidlc:adopt` + `/aidlc:adopt-apply` are how it gets recorded.
- **A step with `status: not-applicable` is neither run nor a finding.** The stack has no such step (a
  Django service has no build; Go type-checks during `go build`), so there is nothing a team could ever
  add. List those once under the gate table as *"not applicable to this stack: build"* and move on —
  putting them in `## Findings` fills every run with holes nobody can close, which is how the section
  stops being read. `resolve-gate.mjs` exports `notApplicable(steps)` for exactly this list.
- **A step with `status: absent` is a coverage hole, not a pass.** Never count it green, never substitute
  an AIDLC default for it. Write one line per absent step into `## Findings` —
  `coverage hole: no <name> gate in <repo> (recorded absent at adoption)` — so every run states what the
  project cannot verify. It is deliberate, recurring, and the honest cost of an un-gated codebase.
- **`environmentDependent` failures are diagnosed differently.** If a step needing services fails, decide
  whether the services are actually up before blaming the diff, and record it as **environment
  unavailable** in `## Findings`, not as a regression. Getting this wrong sends a fix cycle chasing a
  missing database. **Read `aidlc:facts` (`environment` + `gates`) before theorizing** — this project
  may have already paid for the answer, and the fact turns a judgment call into a lookup. If it had
  not, and you work it out here, **write it back**:
  `node "${CLAUDE_PLUGIN_ROOT}/skills/facts/facts.mjs" add <workspace-root> environment "<what must be true>" --ref {ID}`.
  That is the difference between this run losing twenty minutes and every run losing them.
- **Scoping a slow suite.** Where a step's `scope` is `affected`, run the affected-graph runner's affected
  targets and **name the affected set** in the run file. Where it is `changed-paths`, derive the subset
  from this item's diff. Either way record **which subset ran** — `gate: test (affected: @acme/web,
  @acme/shared)` — because a green subset is not a green suite, and the full suite is CI's job. If a step
  has no scope narrower than `repo` and blows `pipeline.gates.verify.maxItemMinutes`, say so rather than silently
  waiting or silently skipping.
- **`providedByHook` steps** already run at commit time via the project's own hook manager; do not run
  them twice and do not install an AIDLC pre-commit layer over them.
- Record the outcome of every step — name, scope, subset, pass/fail/absent/environment-unavailable — in
  the run file. That list is the audit trail the PR carries.

### Risk triggers that outrank the cadence (from `saas`)

Cadence tunes cost. These three override it, because "we only review per-epic" is not an acceptable
answer for any of them. Check the branch diff (`git diff <base>...HEAD --name-only`) against the resolved
repo's `saas` block **before** reading cadence, and record each trigger that fires in `## Findings`:

1. **Diff touches `tenantIsolationPaths` or `authPaths`** (or any `pipeline.securityReviewPaths` entry
   seeded from them) → **aidlc-security runs**, regardless of cadence. `securityConfirm` still applies —
   ask before dispatching — but on decline write `[BLOCKER][open] security review declined on an
   auth/tenant-isolation diff` rather than the ordinary `[NOTE]`: a cross-tenant leak is not a note.
2. **Diff touches an `apiContracts` path** → the item is **contract-affecting**. Stamp
   `contract-affecting: true` on the run file, dispatch **aidlc-reviewer** regardless of cadence with an
   explicit breaking-change brief (is every change additive? are existing consumers still valid? is the
   version bumped if not?), and for a `public: true` contract say plainly in the PR body that external
   consumers are affected.
3. **Diff adds a migration and `liveDataConstraint` is `expand-contract`** → check it for destructive
   DDL: a dropped or renamed column, a narrowed type, a `NOT NULL` added to an existing column, a dropped
   table. Any of those is a **`BLOCKER` finding** (`- [BLOCKER][open] destructive migration against live
   tenant data: <file> — <what>. Expand/contract: add the new shape, backfill, migrate readers, remove
   in a later release.`), and it blocks the PR like any other blocker. A green gate is not evidence here:
   the migration runs fine against an empty test database and destroys production data.

None of these fire when the corresponding `saas` field is absent — the pipeline never invents a
constraint the scan did not evidence.

### Reuse checks — every item, whatever the cadence

Right after the gate, from the repo's checkout:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/reuse/dup-check.mjs" . --base <remote>/<base> --min-lines <reuse.minCloneLines|8>
node "${CLAUDE_PLUGIN_ROOT}/skills/reuse/catalog.mjs" similar . --base <remote>/<base> --config <control-plane>/.claude/aidlc.config.json
```

Turn the output into `## Findings` per `aidlc:reuse` → *Verifying* (a copy of existing product code or a
block written twice in this change is `MAJOR` under the default `reuse.duplication: block`; test-code
copies and look-alike names are `MINOR`). These are deterministic, take seconds and need no agent, so
they run on every item — the default cadence runs no reviewer, and without this nothing would notice
that the change re-wrote something the project already had. Record the result on the run file even when
clean (`reuse: dup-check clean · similar clean`), and copy the implementer's reused / extended / new
shared lines into the PR body's *Reuse* section.

### Agent cadence

Read `pipeline.verification`. Defaults are **economical**: `mode` `auto`; `reviewer` `on-demand`;
`qa` `on-demand`; `security` `per-epic`; `securityConfirm` true. This is the *extra*, agent-driven
review — and it never runs over nothing: the implementer already ran the resolved gate green, and CI
re-runs it as a hard gate, so per-item quality has that floor **to the extent the project's gate covers
it** (an absent step is a hole in the floor, reported per run, never papered over). Each agent carries its
own **cadence** so tokens are spent only where they earn it. **When you must reproduce that gate
yourself** — a subagent returned a non-verdict (see the orchestrator invariants), or you can't take a
`file:`-sibling consumer's CI parity on trust — reproduce it in the CI image per `aidlc:ci-cd` →
*Diagnosis protocol*, using the stack's own recipe (Node: `aidlc-stack-web:ci-web` → *Local CI-parity
for a `file:`-sibling consumer*, F38 — two-step sibling install, each gate step's exit code standing
on its own, no `&& echo` masking that fakes a green).

**Cadence values** (per agent): `per-item` (every item) · `per-epic` (defer to the epic's
consolidated pass, §2) · `on-demand` (run ONLY when this run was explicitly asked — the user's prompt
requested review/QA/security, or `## Findings` carries user-supplied issues to re-verify) · `off`.
`security` also takes `risk-based` (per-item, only when the diff is risky).

**Mode gate first:**
- `manual` → skip all agents; go to the manual/parking block below.
- `ask` → prompt the user which agents to run for THIS item (AskUserQuestion); use the answer as this
  item's cadence, record it in `## Log`. (Only `ask`/a security-confirm interrupt; `auto` is unattended.)
- `auto` → each agent's cadence decides:

  - **aidlc-reviewer** — runs if `reviewer` is `per-item`, or `on-demand` and this run requested it
    (adversarial diff review vs AC + standards per `aidlc:code-review`).
  - **aidlc-qa** — runs if `qa` is `per-item`, or `on-demand` and requested (full suite + missing
    tests per `aidlc:testing`). Bugs still got their failing-repro test at §6 regardless — that's the
    debugging protocol, not this pass.
  - **aidlc-security** — runs if `security` is `per-item`, or `risk-based` AND the diff is risky
    (overlaps `securityReviewPaths` / manifests-lockfiles changed / item labeled `security`), or
    `on-demand` and requested. **If it is due AND `securityConfirm`, ASK the user to confirm before
    dispatching**; on decline, add `[NOTE] security review declined` to `## Findings` and continue.
  - **Deferred (`per-epic`)** agents don't run here — log `- <agent> deferred to epic {parent}` and
    they run at epic consolidation (§2). An item with no parent epic whose only due check is per-epic:
    offer the confirmed pass at its own completion, else note it deferred.
  - **Nothing due** (the default per-item case — reviewer/qa on-demand, security per-epic) **and no
    risk trigger fired**: add
    `[NOTE] no automated verification this item (cadence) — CI gate + human PR review are the gate`
    to `## Findings`, then apply the open-findings rule below rather than going straight to §8 — the
    reuse checks may have filed a `MAJOR` even though no agent ran. This is expected, not a failure. If a risk trigger *did* fire, the
    agents it named run even though the cadence says nothing is due — that is the whole point of the
    override, and the `## Findings` line names which trigger caused it.

### Dispatch order — the read-only agents in parallel, then QA

**Not one flat batch: QA writes.** Dispatch in two steps, because only one of these three agents mutates
the working tree:

1. **Batch 1 — reviewer + security**, whichever are due, in ONE parallel call. Both only *read* the
   diff, so there is nothing for them to collide on and no reason to pay their latency serially.
2. **Batch 2 — aidlc-qa**, after batch 1 has returned. Its verify mode **authors and commits tests**
   (`aidlc-qa` → *Verify mode*, steps 2 and 4), so it cannot ride in batch 1: new commits move `HEAD`
   and change `git diff <base>...HEAD` **while the reviewer is mid-review**, leaving findings written
   against a diff that no longer exists and two agents committing to one branch at once. The reviewer's
   job is the diff the *implementer* produced — that is the diff that has to be reviewed, and QA's tests
   are not part of it.

Only one due → there is no batch, just run it. Only QA due → run it alone; the ordering exists to
protect the reviewer, and with no reviewer there is nothing to protect. If QA's own commits are what
turn the tree dirty at §8, that is expected — commit state belongs to the branch either way.

Then:
1. No open `BLOCKER`/`MAJOR` → phase `pr`, go to §8.
2. Open blockers/majors AND `fixCycles < pipeline.maxFixCycles` → increment `fixCycles`, dispatch
   **aidlc-implementer** with ONLY the open findings, re-run this phase (re-dispatch only the agents
   that ran, scoped to the fixes — **in the same two-step order**, for the same reason).
3. Still failing at max cycles → phase `blocked`, `adapter.comment` with open findings, notify, STOP.

**Manual / nothing-runs parking** (`mode: manual`, or the user wants to review it themselves):
Skip agents, add `[NOTE] verification: manual — human review is the gate` to `## Findings`, go to §8
then §9, set phase `review-pending` and STOP with a ≤6-line message — **remote:** PR URL + "review
the PR … merge when satisfied"; **local:** "review the branch (`git diff <default>...<branch>`), then
re-run `/aidlc:run {ID}` to integrate (or merge yourself)". Either way: "to have issues fixed — or to
run reviewer/QA on demand — re-run `/aidlc:run {ID}` and ask (or add issues under `## Findings`)." On a
later resume with user-supplied findings, run the fix-cycle loop. Never auto-merge (remote) / never
merge without confirmation (local). **This is also how on-demand review/QA is delivered:** re-run and
request it.

## 8 · INTEGRATE (PR in remote mode; local merge in local mode)

Per `aidlc:git-workflow` for the **resolved repo** (cwd = `<repo.path>`; its `mode`/`host`/`remote`/
`defaultBranch`): commit any remaining state (incl. run file), then integrate per the repo's `mode`.

**Freeze window check, when the repo declares one** (`saas.freezeWindows`). If integrating now would land
inside a declared freeze, **say so and ask** — do not merge through it silently and do not refuse either:
opening the PR is almost always still correct (review can proceed), it is the *merge* the freeze governs.
State the window and its source, note that a `mode: local` run's merge **is** the deploy here, and let the
user decide. Never treat a freeze as a hard block on an unevidenced window — if `freezeWindows` is absent,
this paragraph does not apply.

**Label the PR with the resolved `package`** (§2.5) alongside the repo label, so a reviewer sees which
ownership boundary inside the monorepo the diff crosses. Add the `contract-affecting` label and, for a
`public: true` contract, a line in the PR body naming the external consumers affected (§7's trigger 2).

- **`mode: remote`** (default): push, create the PR with the filled pr-body template. Then: run-file
  `pr:` ← URL · `adapter.link(ID, {pr})` · `adapter.transition(ID, in_review)` ·
  `adapter.comment(ID, "PR open: <url>")`.
- **`mode: local`** (no remote): follow `aidlc:git-workflow` → *Local mode* — show the commit list +
  diffstat, get **explicit user confirmation** (this is the relocated human merge gate), then
  `--no-ff` merge into the default branch. On merge: run-file `pr:` ← `local-merge:<sha>` ·
  `adapter.link(ID, {pr: "local-merge:<sha>"})` · `adapter.comment(ID, "Merged locally: <sha>")`;
  the local merge completes integration, so this run will reach `done` at §10 (no separate human
  merge step remains). If confirmation isn't available (non-interactive) or the user declines: leave
  the branch, `adapter.transition(ID, in_review)`, phase `review-pending`, and STOP with the ≤6-line
  message (how to review the branch + re-run `/aidlc:run {ID}` to integrate). Never merge unattended.

Phase → `docs`. Checkpoint.

## 9 · DOCS

If the change affects README/API/user-facing behavior, dispatch **Agent → aidlc-docwriter** on
the same branch (its `docs(...)` commit amends the PR; push the update). It reports
`NO-DOCS-NEEDED` for internal-only changes — that's a fine outcome, move on.
If the PR's CI checks are red at this point, dispatch **Agent → aidlc-devops** in diagnosis
mode; branch-caused failures feed one extra fix cycle (respect `maxFixCycles` overall).

## 10 · WRAP

Phase → `done`. Final checkpoint + `## Log` summary (phases run, fix cycles, PR URL or local-merge sha).

**Reconcile the bound Tasks once more** (only where plan lines carry `wi:`). The final checkpoint runs
the §6 board sync, so every ticked plan line's Task is closed. Any bound Task still open at this point is an **unticked plan line** — descoped,
deferred, or quietly never done — and it must be **named in the report, not closed to tidy the board**.
A Story going Done over an open Task is either honest (the Task moved out of scope, and a human should
retire it) or a dropped requirement, and only the human can tell which. Closing it here would erase the
one signal that distinguishes them.

**Archive the run file per `aidlc:run-state` → *Archive*, which owns the rule.** This step is where a
poly per-repo run pays it: the archive is the **final commit on the feature branch**
(`git mv` → `runs/archive/{ID}.md`, `chore(aidlc): archive run {ID}`, `--no-verify`), pushed to the
open PR so the file merges in **already archived**. Doing it after the merge would need a
direct-to-`main` commit, which `aidlc:git-workflow` forbids — that is the trap (F23), and the same one
a blocked→resolved run hits on its resolving PR (F36). Local mode archives via `/aidlc:status`
post-merge cleanup instead, because the merge happens in-session at §8; the control-plane epic
coordination file archives at the control plane. If a run file already merged un-archived, do **not**
direct-push — `run-state` names the branch-and-PR fallback.

**Journal one line at the control plane** (`aidlc:journal`) — the run file is about to be archived onto
a feature branch, where the next session cannot see it:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/journal/journal.mjs" append <workspace-root> run \
  "{ID} done · <n> fix cycles · <PR url | local-merge:sha><, repo=<repo> in poly>"
```

A run that ends `blocked` (§7) journals `blocked` with the item, the phase and the blocking finding
instead. Never let a failed append affect the run — it returns null and says nothing by design.

Report to the user in ≤6 lines: item, branch, PR URL (or merge sha), assumptions count, findings
resolved, anything needing human eyes. **Where the run bound Tasks (§5), say so in the item line** —
`PROJ-123 · 5 board Tasks closed` (and name any left open, per the reconciliation above). The board
write is a side effect the human did not explicitly ask for on this run; stating it in the report is
how the default stays honest rather than merely quiet.
- **Remote mode:** **Humans review and merge the PR — never merge it yourself.** The item stays at
  `in_review` until merge. **ADO does NOT auto-close a work item when its PR merges (F22)** (unlike a
  GitHub `Closes #X` / branch-policy setup) — so the DONE transition + parent rollup is a **required
  post-merge step**, not something to rediscover per run. It runs on merge detection via
  `/aidlc:status` → *Post-merge cleanup* (or a later `/aidlc:run {ID}` resume that finds the PR merged).
  Left unhandled, the item sits open silently.

  **`done` here means the pipeline's work is done, not that the change is accepted.** Say so in the last
  line of the report, because the next thing that happens is a person reading the PR:
  `awaiting review — /aidlc:review-feedback {ID} when comments come back`. That command
  (`aidlc:review-feedback`) works a human reviewer's comments as findings through the normal fix cycle.
  Without naming it here the loop is invisible: the run says `done`, and a user with six review comments
  has no reason to think the pipeline handles them.
- **Local mode:** the default-branch merge only happened because the user confirmed it at §8 —
  **never merge into the default branch without that explicit confirmation.** The local merge
  completes integration, so the item reaches `done` here (no separate post-merge step).

## Capability gaps (self-extension protocol)

When you or a dispatched agent conclude "no skill/agent covers X" (an unfamiliar integration,
a recurring procedure):
1. **Search first**: installed plugin skills (core + stack packs) → project `.claude/skills|agents/`
   → `.aidlc/extensions.json`. Most gaps are an existing skill you didn't load.
2. Still missing AND plausibly reusable → follow `aidlc:scaffold-skill` (or
   `aidlc:scaffold-agent` only if the agent test passes) mid-run; the new capability is used
   immediately and committed with the branch.
3. One-off knowledge → just handle it inline; don't mint a skill nobody will load twice.
4. **Reuse tracking**: whenever a run loads a registered local extension, increment its
   `reuseCount` in `.aidlc/extensions.json` (commit with the branch). `/aidlc:status` surfaces
   promotion candidates at `reuseCount >= 2`.

## Orchestrator invariants

- **Never escalate an agent to a larger model to work around a failure.** Each agent's tier is
  deliberate (haiku docwriter, sonnet workhorses, opus architect/security). If a subagent dies
  with a model/API error, do NOT retry it on a bigger model — report the exact error and stop
  the phase; a model that won't load is an environment problem to fix, not a reason to burn a
  higher tier. (Overriding a tier is a human decision, never an automatic recovery.)
- **Every dispatch carries an effort level, resolved — not guessed.** The model tier is fixed per role;
  effort is the dial that fits the thinking (and its tokens) to the work in front of the agent. Before
  each Agent call:
  `node "${CLAUDE_PLUGIN_ROOT}/skills/run/resolve-effort.mjs" .claude/aidlc.config.json <agent> --size <S|M|L|XL> --type <type> [--risk auth,tenant,contract,migration,security] [--phase <phase>] [--fix-cycle <n>]`
  and pass the printed level as the Agent tool's `effort` for that call. Risk is the §7 triggers' list
  (an auth/tenant path, an `apiContracts` path, a migration, the `security` label) — the same facts,
  not a new judgement. Log it on the dispatch line: `- <UTC> dispatch <agent> effort=<level>` —
  `/aidlc:insights` reads it. A second fix cycle raises the implementer one level, once
  (`pipeline.effort.escalateOnRetry`); that is the only automatic raise, and it never touches the
  model tier. If the script is unavailable, omit `effort` and the agent's own default applies.
- Checkpoint the run file BEFORE dispatching any agent and AFTER it returns.
- Agent briefs always include: run-file path, the section(s) they may append to, and
  "return a short verdict + pointer, not a transcript".
- Keep your own context lean: read agents' verdicts, not their full output; the run file is the record.
- **A subagent's non-verdict is NOT a phase result (F37/F40).** Every agent's finish contract forbids
  returning on a pending self-launched background task. So if an agent returns without an explicit
  terminal verdict (`COMPLETE`/`BLOCKED`/`DIAGNOSED`/`APPROVE`/`FINDINGS`) — e.g. "still running, I'll
  wait for the background-task notification" — treat the phase as **unverified**: ground-truth the
  working tree yourself (`git status`, and re-run the phase's gate — tests/lint/CI-parity), commit or
  enumerate any leftover state, and drive the remaining deterministic steps directly. Do **not** stamp
  the phase complete on the agent's word, and do **not** blindly re-resume a yielding agent expecting a
  different result (resume once at most; if it yields again, take over). This pattern has recurred across
  the implementer and devops agents — it is a contract issue, not one agent's prompt.
- Any unexpected state (dirty tree at start, wrong branch, adapter errors) → report precisely; never improvise around safety rules.
- **Plugin self-feedback (when `pluginFeedback.enabled`).** If you — or a dispatched agent whose report
  says so — hit friction with the **plugin itself** (a gap you worked around, wrong/missing guidance, a
  broken shipped template, a per-run step you had to save to memory because the plugin didn't encode it),
  capture it via `aidlc:dogfood` (append to the feedback inbox) and continue — never stop delivery for it.
  This is distinct from project bugs (those are normal findings). Off by default; only dogfood/testing
  workspaces enable it.
