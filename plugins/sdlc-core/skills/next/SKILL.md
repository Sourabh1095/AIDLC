---
name: next
description: Pick the highest-priority ready work item from the backlog and run it through the SDLC pipeline. Use when asked to work on the next item, pick up work, or continue with the backlog.
---

# /sdlc:next — pick and run the next item

1. Route to the active work-item adapter (`sdlc:work-items` → config).
2. `query({status: "todo", limit: 5})` — ready items in priority order.
3. **Skip** items that already have a run file in a non-terminal phase (in-flight or blocked) —
   those need `/sdlc:run <ID>` resume or human attention, not a fresh start. Scan run files in
   **every location**: the control-plane `.sdlc/runs/*.md` and, in poly, each declared repo's
   `<repo.path>/.sdlc/runs/*.md` (the same multi-location scan `/sdlc:status` uses) — a poly item's
   in-flight state lives in its target repo's run dir, so a control-plane-only scan would miss it and
   restart a running item. Also skip items whose type is `epic` if any child items are still open
   (work the children instead).
4. Announce the pick in one line: `Next: PROJ-124 (P1, story, M) — <title>`. If the top pick
   was skipped, say why in half a line.
5. Hand off to the `sdlc:run` skill with that ID — follow it exactly as if the user had typed
   `/sdlc:run <ID>`.
6. Nothing ready? Report the backlog state (counts by status, blocked items) and suggest
   `/sdlc:status` or grooming.
