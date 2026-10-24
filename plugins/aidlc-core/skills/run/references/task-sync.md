# /aidlc:run — binding the plan to the board's Task tier

Read from `aidlc:run` §5 when `pipeline.taskSync.mode` is not `off` and the item has child Tasks (or
the mode is `author`), and at every checkpoint after that while plan lines carry `wi:` bindings. Part
of the run skill, kept apart so that boards without a Task tier do not load it.

## Binding the plan (§5)

The leaf is the branch/PR unit; the **Task tier is the team's unit of effort**
(`aidlc:work-items` → *The Task tier*). The run file's `## Plan` and the board's child Tasks are the
same breakdown, so bind them rather than keeping a private second copy. Read
`pipeline.taskSync.mode` (default `adopt`) — `off` skips this whole block, plan as above and continue.

Otherwise call **`children(<ID>, {type: "task"})`** *before* writing `## Plan`, and take one of three
paths:

**A · Tasks exist → they ARE the plan.** Seed `## Plan` from them, **in the board's order**, one plan
line per Task, each carrying its ID as a `wi:` binding:

```
- [ ] Add the profile DTOs  ·  paths: src/dto/profile.ts  ·  wi: PROJ-145
```

Then do the work the board cannot do for you: **enrich each line with `paths:`, and with
`foundation:`/`dependsOn:` where they apply**, grounded in the code exactly as above. A Task carries a
title and (sometimes) a description; it never carries a path list, and §6 will hold every unenriched
line serial. Three rules keep the binding honest:

- **Never silently drop or re-order a Task.** The board is the human's record of the work. A Task you
  cannot implement as written stays in the plan, unticked, with the reason on the line — it does not
  vanish because it was inconvenient.
- **A step the Tasks don't cover is a plan-only line** (no `wi:`). Add it, and say in `## Log` that it
  is unbacked. In `author` mode, offer to create the Task for it.
- **`aidlc:planning`'s 3–8 guidance does not apply to an adopted list** — it governs plans *you* author.
  Take however many Tasks the board has. But a leaf arriving with ~15+ Tasks is a **sizing signal**: say
  so in one line (the Story is probably an XL that should have been split), then run it as scoped. Do
  not truncate — a plan that quietly covers 8 of 15 Tasks reports green over work nobody did.

**B · No Tasks, `mode: author` → author them.** Write the grounded plan first (as above), then
**propose the Task list to the user before creating anything** — `create` is externally visible, so it
takes the same gate as `/aidlc:intake` §3. On approval, `create` one Task per plan task (parented to
the leaf, its `paths:` line in the description, no estimate — see below) and write each returned ID
back as that line's `wi:`. On decline, continue with an unbound plan; that is a fine outcome.

**C · No Tasks, `mode: adopt` (the default) → nothing changes.** Write the plan as above with no `wi:`
bindings. A board that does not use the Task tier behaves exactly as it did before this existed.

**Never write an estimate, priority or `dependsOn` onto a Task**, in any mode. Those carry human intent
and the contract has no op for them by design (`aidlc:work-items` → *What the contract deliberately
cannot do*). You move Tasks through their **states**; what the work was supposed to cost stays the
team's number.

**When the architect writes the plan** (size ≥ `architectThreshold`), make the `children` call
**first** and pass the adopted list in its brief. The binding is an input to planning, not an
annotation bolted on afterwards: an architect that has not seen the team's Tasks will author a
different decomposition, and reconciling the two after the fact is exactly the duplication this
removes. It returns the plan already bound — do not re-map it.

In **poly**, `children` may return Tasks routed to a different repo than this run's — that is the
`crossRepoSplit: task` umbrella shape, and it is handled at §2, not here. If you reach this section and
the children span repos, you are running an umbrella as if it were a leaf: go back to §2.

## Mirroring progress to the bound Tasks (§6 onward)

Where §5 bound plan lines to Tasks (`wi:`), the board's effort tier tracks the commits that spend it.
**You do this, not the implementer** — one writer to the board, for the same reason there is one writer
to git in a parallel window.

**Sync on every checkpoint** from this phase onward — after each fan-out window, when the implementer
returns, at phase end, and on resume. Read `## Plan` and, for each line carrying `wi:`:

| Line state | Action |
|---|---|
| checkbox **ticked**, Task not yet terminal | `transition(<task>, done)` |
| checkbox **unticked** and the task is **currently dispatched** (the serial task in hand, or any member of the open window), Task still `todo` | `transition(<task>, in_progress)` |
| anything else | leave it alone |

Driving it off the checkboxes rather than off agent reports is what makes it **idempotent and
resume-safe**: the run file is the durable record, so re-syncing a partially-synced run is a no-op
rather than a double-write. Every transition is **read-back-verified** like any other mutation
(`aidlc:work-items` → *Write verification*).

Four guards, three of them mirroring the parent rollup at §3a:

- **Never reopen a terminal Task.** Not on a fix cycle, not on a scope-change resume, not when a later
  window touches the same files. A Task that a human closed stays closed.
- **Never move a Task that is already ahead of where you would put it** (in_review/done/blocked) —
  leave it and note it. You only ever advance `todo`→`in_progress`→`done`.
- **Never fight the tracker.** A rejected transition (team rollup rules, a required field, a state the
  type does not have) is a `## Log` note and the run continues. This is bookkeeping; it does not gate
  delivery.
- **Blocked stays on the leaf.** When the run blocks on a bound task, `comment` the blocker onto that
  Task and **leave its state alone**. The Story is already `blocked` and that is the item a human
  triages; a Task flipped to blocked that no later phase reliably flips back is board litter.

**Fix cycles** (§7) trail the leaf ID only where the reworked task's Task is already done — the effort
was accounted for and re-opening it would double-count. Where it is still open, the fix commit trails
both, and the finding note names the Task either way.
