---
name: groom
description: Backlog refinement session — sweep todo items, refine weak acceptance criteria, size unsized items, flag blockers and stale items, propose epic decompositions and priority changes. Use when asked to groom, refine or clean up the backlog.
argument-hint: "[label or item-type filter, optional]"
---

# /sdlc:groom — backlog refinement

A grooming sweep makes items *ready* so `/sdlc:next` never picks up junk. Route to the active
adapter (`sdlc:work-items`), then dispatch **Agent → sdlc-analyst** with this protocol
(pass any filter from `$ARGUMENTS`).

## Sweep protocol (analyst)

`query({status: "todo", limit: 25})` plus, for markdown source, epics too. For each item, in
priority order:

1. **AC quality** (per `sdlc:requirements`): weak/missing AC on stories and bugs → refine and
   `updateAC(...)`. Log what changed via `comment` (`SDLC groom: AC refined — <n> criteria`).
2. **Size** unsized items (S/M/L/XL, grounded in a quick codebase look). **XL items are a
   finding**: propose a split into 2–4 children (do not create them yet — see report).
3. **Epics** with no open children → propose decomposition (list the child stories with
   one-line AC summaries; create only on human approval in the report step).
4. **Flags**: items blocked by a dependency (note what unblocks them), duplicates
   (near-identical titles/descriptions), stale in-progress items with no run file, bugs with
   no reproduction steps (comment asking the reporter for steps).
5. **Priority sanity**: note mismatches (e.g. a bug in the auth path at P4) — **suggest, never
   change**: priorities are the product owner's call.

## Autonomy boundaries

Applied automatically: AC refinement, sizing, factual comments/flags.
Proposed only (require human approval): epic decomposition into new items, XL splits,
priority changes, closing duplicates.

## Report

End with a compact grooming report to the user:

```
Groomed 18 items:
- AC refined: PROJ-124, PROJ-131 (+2 criteria each)
- Sized: 5 items (1 XL → split proposal below)
- Ready now: 9 (was 5)
Needs your call:
- PROJ-119 (epic): propose 3 children: …
- PROJ-127 (XL): split into …
- PROJ-140 looks duplicate of PROJ-133 — close?
- Priority suggestions: PROJ-135 P4→P2 (auth-path bug)
```

Apply the "needs your call" actions only after the user picks them.
