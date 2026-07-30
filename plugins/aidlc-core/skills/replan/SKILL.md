---
name: replan
description: Re-order the backlog when priorities change — take a new priority signal (a client's "checkout before search", or a revised requirements doc), re-sequence the not-yet-started work into ordered waves of items that can run concurrently, and persist it as an execution plan that /aidlc:next and /aidlc:sprint follow. Writes nothing to the tracker. Use when priorities change mid-project, when the delivery order needs resetting, or when asked to re-plan, re-prioritize or re-sequence.
argument-hint: "[what changed — a prompt, or a path to a revised requirements doc; empty = re-derive from the board as-is]"
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

`$ARGUMENTS` is what changed. Three shapes, all first-class:

- **A prompt** — *"client wants checkout live before search"*, *"deprioritize the mobile work"*,
  *"security items first for the audit"*. This is the common case.
- **A path to a revised requirements doc** — diff it against what the backlog already reflects; the
  driver is the delta, not the whole document.
- **Empty** — re-derive the waves from the board as it stands. Useful after a grooming pass, a
  decomposition, or when `/aidlc:next` reported the plan had gone stale.

**Dispatch Agent → aidlc-analyst** to turn the driver into a **ranked order** over the schedulable items.
Its brief: the driver text (or doc), the item list (id, type, title, priority, repo, estimate, parent,
`dependsOn`, labels), and these instructions:

1. **Produce an `order` — an integer rank per item.** That ranking is the judgment this command exists
   to capture. Ground it in the driver, and in what the items actually are (read enough of the code or
   the item bodies to know what "checkout" spans here).
2. **Say what moved and why, per item**, in one line each. A rank with no reason cannot be argued with,
   which means it cannot be corrected.
3. **Propose `dependsOn` edges to ADD or REMOVE — as proposals, never as writes.** The new order often
   exposes a real edge (the newly-first item needs a migration nobody sequenced) or a stale one (a
   `frontend dependsOn backend` chain that a landed contract already made unnecessary). Both go in the
   report; neither is written.
4. **Apply `aidlc:work-items` → *Contract-first siblings* when the new order pulls a feature forward.**
   Where the interface is new or changing, the right answer is a **contract child + two implementation
   children pointing at it**, not a chain. Where the interface already exists unchanged, there is **no
   edge at all** — and re-deriving a frontend-waits-for-backend edge from the titles is the specific
   mistake that undoes a contract-first decomposition. A proposed new contract child is a **creation
   proposal** (§4), not something this command creates.
5. **Never propose reordering a frozen item.** It is running; the analyst's job is the rest.

The analyst proposes the *order*. It does **not** compute the waves — that is §3, and it is code.

## 3 · PACK THE WAVES — deterministic, not judged

Run the resolver. It takes the items (with the analyst's `order` and the `frozen` flags from §1.5) and
the config, and returns the wave schedule:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/replan/resolve-waves.mjs" <items.json> <.claude/aidlc.config.json>
```

**Do not hand-compute this and do not overrule it.** Three constraints decide the packing, and each one
fails *silently* when got wrong — which is exactly why it is code with tests
(`resolve-waves.test.mjs`), the same argument `resolve-fanout.mjs` makes one level down:

| Constraint | Why it is not a matter of taste |
|---|---|
| **`dependsOn` order** | A violated edge does not error — the dependent runs against a contract or migration that is not there, and the red build lands a long way from its cause. |
| **One item per repo per wave** *(poly only)* | Two items in one repo share one checkout: `/aidlc:sprint` would branch and commit both in the same working tree (sprint §1.3). **In mono this does not bind** — every sprint item gets its own git worktree. |
| **Wave width** | `pipeline.replan.maxWave` (default 3, hard cap 5), matching `/aidlc:sprint`'s own cap. Parallelism multiplies mistakes too. |

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
   `/aidlc:sprint` diff it against the live board before obeying it (§Honoring).
4. Timestamps from the real clock (`date -u` / `Get-Date`), never invented.

Then report in three lines: where the plan is, the schedule summary
(`w0[PROJ-101]* -> w1[PROJ-102|PROJ-110] -> …`), and the single next action —
`/aidlc:sprint` to launch wave 1, or `/aidlc:next` for one item from it.

## Honoring the plan — what the other commands do with it

A plan nobody reads is decoration, so `/aidlc:next` and `/aidlc:sprint` both check for
`.aidlc/plan.md` and follow it. Both apply the **same freshness gate**, because obeying a stale plan is
worse than having none:

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
- **Held is not omitted.** Every item the packer refused appears in the plan and the report, with why.
- **A replan is cheap and re-runnable.** It creates nothing and mutates nothing, so re-running it after
  grooming, a decomposition or a routing fix is the expected workflow, not a cost.
