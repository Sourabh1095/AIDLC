---
name: replan
description: Re-order the backlog when priorities change — take a new priority signal (a client's "checkout before search", a phasing directive like "finish all the backend before starting the UI", or a revised requirements doc), re-sequence the not-yet-started work into ordered waves of items that can run concurrently, and persist it as an execution plan that /aidlc:next and /aidlc:sprint follow. Writes nothing to the tracker. Use when priorities change mid-project, when the delivery order needs resetting, or when asked to re-plan, re-prioritize, re-sequence or re-phase.
argument-hint: "[how you want it re-planned — \"checkout before search\", \"all BE first then UI\", or a path to a revised requirements doc; empty = it asks]"
---

# /aidlc:replan $ARGUMENTS — reset the order, keep the parallelism

Priorities change mid-project. That is not an exception to plan for once — it is the normal condition
of a project with a client, and the pipeline has to absorb it without either losing the work in flight
or quietly serializing everything that used to run at the same time.

**Two things this command is, and one it is not.**

- It **re-orders** what has not started yet, from a changed priority signal.
- It **re-packs** that order into **waves** — the sets of items that can run *concurrently* — so a
  reprioritization does not silently cost the concurrency the decomposition was designed for. Reordering
  without re-packing is the failure mode: move one item to the top and a contract-first pair that used to
  run side by side ends up in two different waves for no reason anyone can name.
- It **writes nothing to the tracker.** No priority field, no `dependsOn` edge, no iteration assignment.
  The plan is an **execution overlay**: the board stays exactly as the client left it, and the plan says
  what AIDLC will actually do next. The report lists the board edits that *would* make the two agree —
  applying them is a human's call.

## The one hard rule: in-flight work finishes

A leaf that is already running is **pinned to wave 0 and never touched** — not paused, not reordered,
not retargeted, not abandoned. A change half-applied across many files and, in poly, many repos is far
more expensive to unwind than the wall-clock saved by stopping it, and no new priority is worth that.
If the new order says a running item should have waited, say so in the report and let it land.

**Freezing is leaf-only.** `/aidlc:run` §3a rolls a parent Epic/Feature to `in_progress` the moment its
**first** child starts (F19). Freezing everything marked `in_progress` would therefore freeze whole epics
and make the board unplannable the instant any child moved. Containers are never frozen and never
scheduled — their **children** are the runnable units. `resolve-waves.mjs` enforces this; `/aidlc:next`
applies the same rule when it skips an epic with open children.

## 1 · GROUND

1. **No `.claude/aidlc.config.json`?** There is no backlog to re-plan. Route to `/aidlc:init` (existing
   code → the *"there's existing code — scan it"* answer, which goes to `/aidlc:adopt`) and stop.
2. Read config: `repos[]` (layout), `workspace.crossRepoSplit`, `pipeline.replan`.
3. Route to the active adapter (`aidlc:work-items` → *Routing*).
4. **Sweep the whole backlog, not the first page** (F34). Count first, then page `query()` to completion
   over every non-terminal item — `todo`, `in_progress`, `in_review`, `blocked` — **and the containers**
   (epics/features), which are needed to resolve parent/child structure even though they are never
   scheduled. A plan built on the first 25 of 120 items is worse than no plan, because it will be obeyed.
5. **Find what is in flight.** Scan run files in **every** location — the control-plane `.aidlc/runs/*.md`
   and, in poly, each declared repo's `<repo.path>/.aidlc/runs/*.md` (the same multi-location scan
   `/aidlc:status` uses), plus `runs/archive/` for done-but-unmerged. A **leaf with a non-terminal run
   file** (`phase` not `done`) is frozen — mark it `frozen: true`. A poly item's run file lives in its
   target repo, so a control-plane-only scan would miss it and re-plan a running item.
6. **Read the existing plan** if `.aidlc/plan.md` exists — its `## Item snapshot` and which waves have
   already drained. A replan supersedes it; it does not silently overwrite it (§5).

## 2 · READ THE DRIVER

`$ARGUMENTS` is **how the user wants it re-planned** — the whole judgment this command exists to apply.
Three shapes are first-class, and a fourth means *ask*:

- **An ordering prompt** — *"client wants checkout live before search"*, *"deprioritize the mobile
  work"*, *"security items first for the audit"*. Expressed as `order` (§2a).
- **A grouping prompt** — *"complete all BE first and then start with UI"*, *"everything for the demo,
  then the rest"*, *"all the migrations before any feature work"*. This is **not** an ordering: it says
  *all* of one group before *any* of another. Expressed as `stage` (§2b), because `order` cannot say it.
- **A path to a revised requirements doc** — diff it against what the backlog already reflects; the
  driver is the delta, not the whole document.
- **Empty — ask, do not guess.** Silently re-deriving from the board looks identical to a replan that
  honoured a directive, and the user gets a wave schedule they never asked for. Ask what changed, and
  offer the shapes above plus *"nothing changed — just re-derive from the board as it stands"* (which
  is the right answer after a grooming pass, a decomposition, or a stale-plan report from
  `/aidlc:next`). One question, then proceed.

A driver may be **both** — *"security first, and finish the API before the UI"* is a grouping with an
ordering inside it. Stages and ranks compose: the stage decides the wave band, the rank orders within it.

**Dispatch Agent → aidlc-analyst** to turn the driver into that order. Its brief: the driver text (or
doc), the item list (id, type, title, priority, repo, estimate, parent, `dependsOn`, labels), and these
instructions:

### 2a · `order` — an integer rank per item

1. **Produce an `order` for every schedulable item.** Ground it in the driver, and in what the items
   actually are (read enough of the code or the item bodies to know what "checkout" spans here).
2. **Say what moved and why, per item**, in one line each. A rank with no reason cannot be argued with,
   which means it cannot be corrected.

### 2b · `stage` — only when the driver groups

**Emit stages only if the driver actually asked for a grouping.** Absent one, leave `stage` off every
item and the packer behaves exactly as it always has. Inventing a phasing the user did not ask for is
the expensive mistake here: it serializes a backlog that was designed to run wide, and it does so under
the user's own words.

When the driver *does* group:

- Give every item `stage: <int>` (1, 2, 3… in the order the user named the groups) and
  `stageLabel: "<the user's word for it>"` — `"backend"`, `"demo"`, `"migrations"`. The integer is the
  barrier; the label is what makes the plan readable six weeks later.
- **Classify by what the item is, not by what its repo is called.** "All BE first" means the
  server-side work — which may include a `db` migration and a `control-plane` config item, and may
  exclude a `backend`-repo item that only exists to serve the UI. Read enough to tell.
- **Stage every schedulable item.** Anything left unstaged runs *after* every declared stage and gets
  reported as a question — which is correct, but a plan full of them is an analyst that gave up.
- **Never stage a frozen item.** It is already running; wave 0 is a read.
### 2c · Structure the new order exposes — proposed, never written

1. **Propose `dependsOn` edges to ADD or REMOVE — as proposals, never as writes.** The new order often
   exposes a real edge (the newly-first item needs a migration nobody sequenced) or a stale one (a
   `frontend dependsOn backend` chain that a landed contract already made unnecessary). Both go in the
   report; neither is written.
2. **Apply `aidlc:work-items` → *Contract-first siblings* when the new order pulls a feature forward.**
   Where the interface is new or changing, the right answer is a **contract child + two implementation
   children pointing at it**, not a chain. Where the interface already exists unchanged, there is **no
   edge at all** — and re-deriving a frontend-waits-for-backend edge from the titles is the specific
   mistake that undoes a contract-first decomposition. A proposed new contract child is a **creation
   proposal** (§4), not something this command creates.

   **A grouping driver does not license inventing those edges either.** "All BE first" is a `stage`,
   and the stage barrier already enforces it. Writing `UI-1 dependsOn BE-1` to *simulate* the barrier
   would put a phasing preference into the tracker as though it were a technical dependency, where it
   outlives the replan that wanted it and quietly re-serializes the board forever.
3. **Never propose reordering a frozen item.** It is running; the analyst's job is the rest.

The analyst proposes the *order* and, when asked for, the *stages*. It does **not** compute the waves —
that is §3, and it is code.

## 3 · PACK THE WAVES — deterministic, not judged

Run the resolver. It takes the items (with the analyst's `order`, any `stage`/`stageLabel` from §2b, and
the `frozen` flags from §1.5) and the config, and returns the wave schedule:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/replan/resolve-waves.mjs" <items.json> <.claude/aidlc.config.json>
```

**Do not hand-compute this and do not overrule it.** Four constraints decide the packing, and each one
fails *silently* when got wrong — which is exactly why it is code with tests
(`resolve-waves.test.mjs`), the same argument `resolve-fanout.mjs` makes one level down:

| Constraint | Why it is not a matter of taste |
|---|---|
| **`dependsOn` order** | A violated edge does not error — the dependent runs against a contract or migration that is not there, and the red build lands a long way from its cause. |
| **The stage barrier** | A grouping driver is unenforceable by ranking. Rank the backend 1–3 and the UI 4–5 and a greedy packer still starts a UI item in wave 1 the moment a slot is free — and in poly the one-per-repo rule *guarantees* a free frontend slot. The user reads "BE first" in their own prompt and gets it in neither. |
| **One item per repo per wave** *(poly only)* | Two items in one repo share one checkout: `/aidlc:sprint` would branch and commit both in the same working tree (sprint §1.3). **In mono this does not bind** — every sprint item gets its own git worktree. |
| **Wave width** | `pipeline.replan.maxWave` (default 3, hard cap 5), matching `/aidlc:sprint`'s own cap. Parallelism multiplies mistakes too. |

**The barrier is a band, not a queue.** Within a stage everything the other three constraints allow
still runs concurrently — "all BE first" means the backend items run *wide* and the UI waits, not that
the backend runs one at a time. That is the same *reset the order, keep the parallelism* promise this
command opens with, applied one grain coarser.

Two things the barrier deliberately yields on, both reported rather than silently absorbed:

- **It gates on schedulable work, not on held work.** One blocked ticket in stage 1 must not freeze
  every later stage — so the next stage opens, and the report says the directive was not fully met.
- **`dependsOn` outranks it.** If everything left in a stage depends on later-stage work, the grouping
  contradicts the graph. A dependency is correctness; a stage is a preference. The stage relaxes, and
  says so.

Four things it refuses to guess, and each refusal shows up as a **held** item you must act on rather
than a silent omission: an **unrouted** item in poly (tree isolation unprovable — route it), a **blocked**
item, an **unknown or self-referential** dependency, and a **cycle** (reported, never broken by dropping
an edge). Held items are grooming work — carry them into the report.

## 4 · PRESENT — approval before the plan is written

The plan changes what `/aidlc:next` and `/aidlc:sprint` will do, so it is proposed before it is written.
Show, compactly:

```
Replan — driver: "client wants checkout live before search"

In flight (wave 0 — finishes as-is, not re-planned):
  PROJ-101  backend   implement   ← now outranked by PROJ-102, but it lands first

  wave 1   PROJ-102 backend  Checkout contract (OpenAPI)   ‖  PROJ-110 frontend  Search filters
  wave 2   PROJ-103 backend  Checkout endpoint             ‖  PROJ-104 frontend  Checkout UI
  wave 3   PROJ-120 db       Search index migration

Moved:  PROJ-102 P3→top (driver), PROJ-110 top→wave 1 (search deprioritized)
Held:   PROJ-111 blocked · PROJ-112 unrouted — route it and re-plan
Needs your call:
  - propose contract child for the checkout interface (new API shape) — create it?
  - drop stale edge PROJ-104 dependsOn PROJ-103 (contract already covers the shape)?
Board deltas (not written): PROJ-102 P3→P1, PROJ-110 P1→P3
```

When the driver grouped, **draw the barrier** — it is the thing the user asked for, and a flat wave list
hides whether it was honoured. Say the wall-clock cost out loud too: a barrier is a deliberate trade of
throughput for order, and the user is the one who should decide it was worth it.

```
Replan — driver: "complete all BE first and then start with UI"   [grouping: backend → ui]

  stage backend
    wave 1   PROJ-102 backend  Orders API   ‖  PROJ-120 db  Schema migration
    wave 2   PROJ-103 backend  Payments API
  ──── barrier ────
  stage ui
    wave 3   PROJ-104 frontend Checkout screen
    wave 4   PROJ-105 frontend Order history

Staged: backend = PROJ-102, PROJ-103, PROJ-120 (server-side, incl. the db migration)
        ui       = PROJ-104, PROJ-105
Cost:   4 waves, was 2 — PROJ-104/105 could have run alongside the backend. That is the directive.
Held:   PROJ-121 blocked (stage backend) — stage `ui` still opens; the grouping is not fully met
```

Three kinds of thing in that report, with different autonomy:

- **The plan itself** — written on approval (§5).
- **Board deltas** — *never written*. Listed so a human can make the board match if they want it to.
- **Structural proposals** — a new contract child, an added/removed `dependsOn`, a split. These are
  **creations and mutations, so they need their own approval** and are then applied by the **coordinator
  turn** — the session that asked the user — through the adapter, read-back-verified
  (`aidlc:work-items` → *Write verification*). Do **not** re-dispatch the analyst to "execute — the user
  approved": a fresh subagent cannot verify consent it never received first-hand (the same F35 rule
  `aidlc:groom` follows). If any structural proposal is applied, **re-run §3** — the graph changed, so
  the packing did too — and show the corrected waves before writing.

## 5 · WRITE THE PLAN

On approval, from `${CLAUDE_PLUGIN_ROOT}/templates/plan-file.md`:

1. **Supersede the current plan, don't overwrite it.** If `.aidlc/plan.md` exists, move it to
   `.aidlc/plan-archive/{its own `plan:` stamp}.md` first, and set `supersedes:` on the new one. The
   previous plan is how anyone later reconstructs why the order changed.
2. Write `.aidlc/plan.md` at the **control plane** (workspace root). It is cross-cutting workspace
   state — like an epic coordination file, it belongs to no product repo and is **never committed to a
   product branch**. It is durable, tracked control-plane state (the template `.gitignore` keeps
   `.aidlc/` tracked and excludes only ephemera like `sprint-*.json`).
3. Fill `## Item snapshot` with the fields the packing depends on, and `fingerprint:` from
   `planFingerprint()`. **This is what makes the plan checkable later** — `/aidlc:next` and
   `/aidlc:sprint` diff it against the live board before obeying it (§Honoring). `order` and `stage`
   are **not** in the fingerprint: they are this plan's own judgment, not board state, so nothing but
   another replan can change them and fingerprinting them would make every plan look stale.
4. **Record the driver verbatim, and the stages if there were any** — `stages:` from `stageSummary()`,
   and the stage/label of each wave in `## Waves`. A plan whose `driver:` reads "re-prioritized"
   explains nothing later; one that reads "complete all BE first and then start with UI" explains why
   there are four waves where two would have done.
5. Timestamps from the real clock (`date -u` / `Get-Date`), never invented. Record **`cutBy:`** — the
   identity that ran this replan (`team.me`, else `git config user.email`). A plan is a judgment call
   about delivery order, and six weeks later "who decided this" is as load-bearing as `driver:`.
6. **Commit and push it (shared mode).** The plan is a **team decision, not a local file** — `/aidlc:next`
   and `/aidlc:sprint` obey it, so a plan that stays on one laptop means every developer silently follows
   a different schedule and the freshness check cannot detect it (it diffs the plan against the *board*,
   which is exactly the thing that did not change). Commit `.aidlc/plan.md` + the superseded
   `.aidlc/plan-archive/` entry at the **control plane** — `chore(aidlc): replan — <driver, truncated>` —
   and push it through the control plane's normal route: direct on its default branch if that repo is
   unprotected, otherwise a branch + PR like any other control-plane change (`aidlc:work-items` → *Repos
   & routing*, rule 0). It is a `.aidlc/**`-only commit, so `--no-verify`, and verify it landed before
   pushing (`aidlc:git-workflow` → bookkeeping commits). In **solo mode** commit it and skip the push
   question entirely — there is nobody to tell.

Then report in three lines: where the plan is, the schedule summary
(`w0[PROJ-101]* -> w1[PROJ-102|PROJ-110] -> …`, plus the `stages:` line when the driver grouped), and
the single next action — `/aidlc:sprint` to launch wave 1, or `/aidlc:next` for one item from it.

## Honoring the plan — what the other commands do with it

A plan nobody reads is decoration, so `/aidlc:next` and `/aidlc:sprint` both check for
`.aidlc/plan.md` and follow it. Both apply the **same freshness gate**, because obeying a stale plan is
worse than having none:

**Two different kinds of stale, and only one of them is detectable here.** `checkFreshness` diffs the
plan against the **board** — it catches items that moved, split or vanished. It cannot catch *someone
re-cut the plan an hour ago and you have the old file*, because nothing about the board changed. That is
a git question, so shared mode answers it with the control-plane freshness check
(`aidlc:work-items` → *Control-plane freshness*) before reading the plan at all: a control plane N
commits behind origin may be holding a superseded schedule, and `cutBy:` says whose. Report both, then
proceed — a stale-file warning is information, not a blocker.

```
checkFreshness(plan["## Item snapshot"], <items queried now>)   // resolve-waves.mjs
```

| Drift class | What it means | What next/sprint do |
|---|---|---|
| **none** | items merely progressed | follow the plan silently |
| **additive** | new items appeared, or a **board priority changed** | follow the plan, **say so in one line** and name what is unscheduled — a board priority change is precisely the signal to re-plan |
| **breaking** | a planned item vanished, was re-typed, re-routed or re-wired | **do not follow it.** Say which item and why, fall back to plain priority order, and suggest `/aidlc:replan` |

**Falling back rather than refusing is deliberate.** A stale plan must never silently steer the pipeline,
but it must also never *stop* the user working — so the failure mode is a loud fallback to the behaviour
that existed before this command did.

**`/aidlc:run <ID>` is the third reader, and it does not obey — it reports.** A named ID is an explicit
instruction; a schedule does not get to override one. But running silently out of wave order is a
different thing from running deliberately out of wave order, and stages made the difference matter: a
user who asked for *"all BE first"* and then hand-starts a UI item has stepped over their own barrier.
So `run` §1a locates the ID in the plan and emits **one line** — later wave, held, or absent — then
continues. It never refuses, never prompts, never runs the freshness sweep (it quotes the plan's date
instead), and writes nothing. On a **resume** it says nothing at all: a live run file means the item was
frozen into wave 0 and never re-planned, so it is in order by definition.

**Nothing advances the waves on its own.** Wave *N+1* becomes the current wave when wave *N*'s items are
terminal, but no command loops. `/aidlc:sprint` ends by naming the next one (`wave 2 done — wave 3 is
PROJ-120 (db) · /aidlc:sprint to launch it`) and stops. Both `run` and `sprint` are
`disable-model-invocation`, so the pipeline cannot self-start a wave even if it wanted to — crossing a
wave boundary, and especially crossing a **stage barrier**, is a human pressing the key.

## Rules

- **Never write to the tracker from this command.** Not priority, not `dependsOn`, not iteration. The
  overlay is the whole design: the board is the client's, the plan is the pipeline's. (This is also
  honest about the adapter contract — `aidlc:work-items` has no op for any of those three; they are
  create-time-only fields.)
- **Never touch in-flight work** — no pause, no reorder, no transition, no killed process, no edited
  run file. Wave 0 is a read.
- **Never freeze or schedule a container.** Epics, features, and umbrella stories with open children are
  coordination units; their children are the work (F19).
- **Never hand-compute the waves.** Run the resolver, quote its reasons verbatim for held items.
- **Never guess the driver.** With no `$ARGUMENTS`, ask how the user wants it re-planned — "re-derive
  from the board as-is" is one of the answers, not the default.
- **Never invent a grouping.** Stages exist only when the driver asked for phasing. Absent one, no
  item gets a `stage` and the packing is unchanged — a barrier nobody requested is a serialized backlog
  nobody agreed to.
- **Never encode a stage as a `dependsOn`.** The barrier is plan state and dies with the plan; an edge
  written to the tracker is permanent and re-serializes the board long after the phase it served.
- **Held is not omitted.** Every item the packer refused appears in the plan and the report, with why.
- **A replan is cheap and re-runnable.** It creates nothing and mutates nothing, so re-running it after
  grooming, a decomposition or a routing fix is the expected workflow, not a cost.
