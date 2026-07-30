---
name: next
description: Pick the highest-priority ready work item from the backlog and run it through the AIDLC pipeline. Use when asked to work on the next item, pick up work, or continue with the backlog.
---

# /aidlc:next — pick and run the next item

0. **No `.claude/aidlc.config.json`?** There is no backlog to pick from yet. Look at the folder first:
   **existing code** → `/aidlc:init` choosing *"there's existing code — scan it"*, which routes to
   `/aidlc:adopt` so the topology, stack, gate and conventions come from the code rather than from
   memory (one scan covers every repo in the workspace); an **empty folder** → `/aidlc:init`. Say which
   and stop — picking "the next item" from a project that has not been set up is not a useful answer.
1. Route to the active work-item adapter (`aidlc:work-items` → config).
2. `query({status: "todo", limit: 5})` — ready items in priority order.
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
   `/aidlc:status` or grooming. **If a plan exists and its remaining waves are all *held*** (blocked,
   unrouted, or waiting on a cycle — the plan's `## Held` table says which), that is the more useful
   answer than "nothing ready": name the blockers and suggest `/aidlc:groom` then `/aidlc:replan`.
