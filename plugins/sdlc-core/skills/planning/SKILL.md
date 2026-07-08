---
name: planning
description: Work decomposition, sizing heuristics and dependency detection for SDLC plans. Load when writing an implementation plan for a work item or sizing/sequencing backlog items.
user-invocable: false
---

# Planning — decompose, size, sequence

## Writing a plan (run file `## Plan`)

- 3–8 ordered checkbox tasks; each one commit-sized (a reviewable logical unit).
- Ground every task in the code: name the files/modules it touches. A plan that never names a
  file is a guess, not a plan.
- Order: schema/data changes → backend logic → API surface → frontend → tests-not-yet-covered → docs touch-ups.
- Last task is always: "run full suite + lint, tick verified AC on the item".
- Note explicit NON-goals when the item borders adjacent scope ("does not touch avatar deletion").

## Sizing heuristics

| Size | Rough shape |
|------|-------------|
| S | ≤2 files, no schema/API changes, obvious tests |
| M | one subsystem, small API surface change, several files |
| L | crosses subsystems (e.g. schema + API + UI), migration involved |
| XL | too big — decompose before implementing; an XL item never enters a single run |

Size drives the pipeline: ≥ `architectThreshold` (default M) ⇒ the architect agent plans
(when available); XL ⇒ send back for decomposition.

## Dependency detection (grooming / sprint selection)

Two items conflict if they plausibly touch the same files/subsystems (compare plans or, cheaper,
their labels + nouns in titles), or one's AC references the other's output, or they share a
parent epic ordering. Conflicting items are serialized, never run in parallel worktrees.
