---
name: next
description: Pick the highest-priority ready work item from the backlog and run it through the AIDLC pipeline. Use when asked to work on the next item, pick up work, or continue with the backlog.
argument-hint: "[--mine | --unassigned | --any — override the ownership scope, optional]"
---

# /aidlc:next $ARGUMENTS — pick and run the next item

`$ARGUMENTS` may carry a one-off ownership scope that overrides `team.pickScope` for this pick only:
`--mine`, `--unassigned`, `--any`. Meaningless in solo mode (there is one queue); accept and ignore.

0. **No `.claude/aidlc.config.json`?** There is no backlog to pick from yet. Look at the folder first:
   **existing code** → `/aidlc:init` choosing *"there's existing code — scan it"*, which routes to
   `/aidlc:adopt` so the topology, stack, gate and conventions come from the code rather than from
   memory (one scan covers every repo in the workspace); an **empty folder** → `/aidlc:init`. Say which
   and stop — picking "the next item" from a project that has not been set up is not a useful answer.
1. Route to the active work-item adapter (`aidlc:work-items` → config). **In shared mode, check the
   control plane is current first** (`aidlc:work-items` → *Control-plane freshness*) — one line, never a
   block.
2. `query({status: "todo", limit: 5})` — ready items in priority order.

   **Whose queue is this? (`team.mode: shared` only — skipped entirely in solo.)** A board gives an
   item one assignee, and until this scope existed the pick ignored it: three developers running
   `/aidlc:next` all got the same correctly-assigned item, and the first to reach `run` §3 won while the
   other two had already branched. So resolve the identity (`team.me`, else `git config user.email`) and
   pass it to the query, per `team.pickScope` (or the `$ARGUMENTS` override):

   | `pickScope` | flag | `query` gets | For |
   |---|---|---|---|
   | `mine-then-unassigned` (default) | `--mine` | `assignee: ["me", null]` | the normal case — your work first, then anything nobody has claimed |
   | `mine-only` | — | `assignee: "me"` | a team where every item is assigned at planning, so picking up unassigned work is a process error |
   | *(no config equivalent)* | `--unassigned` | `assignee: null` | deliberately taking unclaimed work and nothing else |
   | `any` | `--any` | no `assignee` filter | solo behaviour — and the explicit override for "yes, I am taking Priya's item" |

   Two failure modes to get right, because both fail quietly:
   - **Identity unresolvable** → say so once and treat every *assigned* item as someone else's (i.e.
     fall back to unassigned-only, not to `any`). Erring toward an empty queue prompts a question; erring
     toward `any` puts two people on one branch.
   - **Your queue is empty but the board is not** → that is a real and useful answer, not a dead end.
     Report it as such (`nothing assigned to you is ready; 6 items are ready for others`) and offer the
     override rather than silently widening scope. Never pick someone else's item without being asked —
     and when the user does ask, name the owner in the pick line: `Next: PROJ-124 (P1, story, M,
     assigned to Priya) — <title>`.
2a. **An execution plan overrides raw priority order.** If `.aidlc/plan.md` exists at the control
   plane, it is an active wave schedule (`aidlc:replan`) and the pick comes from **the earliest wave
   that still has open items**, highest-ranked first — not from the top of the priority query. Check it
   is still trustworthy first — write the plan's `## Item snapshot` and the items you just queried to
   two temp JSON files and run:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/skills/replan/resolve-waves.mjs" --freshness <plan-snapshot.json> <items-now.json>
   ```
   - **none** → follow the plan silently.
   - **additive** (new items, or a **board priority changed**) → follow the plan and say so in one line,
     naming what is unscheduled. A board priority change is the signal to re-plan, not a reason to ignore
     the plan you have.
   - **breaking** (a planned item vanished, was re-typed, re-routed or re-wired) → **do not follow it.**
     Name the item and the drift, fall back to plain priority order for this pick, and suggest
     `/aidlc:replan`. A stale plan must never steer the pipeline silently — and must never stop the user
     working either, which is why this falls back rather than refusing.
3. **Skip** items that already have a run file in a non-terminal phase (in-flight or blocked) —
   those need `/aidlc:run <ID>` resume or human attention, not a fresh start. Scan run files in
   **every location**: the control-plane `.aidlc/runs/*.md` and, in poly, each declared repo's
   `<repo.path>/.aidlc/runs/*.md` (the same multi-location scan `/aidlc:status` uses) — a poly item's
   in-flight state lives in its target repo's run dir, so a control-plane-only scan would miss it and
   restart a running item. Also skip items whose type is `epic` if any child items are still open
   (work the children instead).

   **This scan only sees YOUR machine.** A run file is committed to its feature branch
   (`aidlc:run-state`), so a teammate's in-flight `PROJ-124.md` lives on their branch in their clone and
   this glob will never find it. In shared mode the cross-machine guard is the **board**: step 2 queries
   `status: "todo"`, and `run` §3 moves a started item to `in_progress`, so a started item drops out of
   the query regardless of whose machine started it. The run-file scan is the *local* backstop for the
   window before that transition — do not mistake it for a distributed lock.
4. Announce the pick in one line: `Next: PROJ-124 (P1, story, M) — <title>`. When it came from a plan,
   say which wave — `Next: PROJ-124 (plan wave 2, story, M) — <title>` — so a pick that looks out of
   priority order explains itself. If the top pick was skipped, say why in half a line.
5. Hand off to the run pipeline with that ID — follow it exactly as if the user had typed
   `/aidlc:run <ID>`. **`run` is `disable-model-invocation`, so the Skill tool cannot reach it**
   (deliberate — see `aidlc:run` → *Entry is deliberate*): **read
   `${CLAUDE_PLUGIN_ROOT}/skills/run/SKILL.md` and follow it verbatim** with that ID as its
   `$ARGUMENTS`. The user invoked `/aidlc:next`, which is them choosing to start the next item, so
   this is an explicit handoff — do not stop and ask them to re-type the command.
6. Nothing ready? Report the backlog state (counts by status, blocked items) and suggest
   `/aidlc:status` or grooming.

   **In shared mode, separate "nothing ready" from "nothing ready *for you*"** — they need opposite
   responses. Nothing on the whole board → groom. Nothing in **your** queue while others have work is a
   staffing question for a human, not something to fix by widening the filter:

   ```
   Nothing assigned to you is ready. 4 items are ready for Priya and Rahul.
   Ask for one, or `/aidlc:next --any` to take one anyway.
   ```

   **If a plan exists and its remaining waves are all *held*** (blocked, unrouted, or waiting on a
   cycle — the plan's `## Held` table says which), that is the more useful answer than "nothing ready":
   name the blockers and suggest `/aidlc:groom` then `/aidlc:replan`.
