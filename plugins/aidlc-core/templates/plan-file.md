---
plan: {{NOW_UTC}}
supersedes: {{SUPERSEDES}}
cutBy: {{CUT_BY}}
driver: "{{DRIVER}}"
source: {{SOURCE}}
layout: {{LAYOUT}}
crossRepoSplit: {{CROSS_REPO_SPLIT}}
maxWave: {{MAX_WAVE}}
schedule: {{WAVE_SUMMARY}}
stages: {{STAGE_SUMMARY}}
waves: {{WAVE_COUNT}}
frozen: {{FROZEN_COUNT}}
held: {{HELD_COUNT}}
fingerprint: {{FINGERPRINT}}
generated: {{NOW_UTC}}
---

## Driver

{{DRIVER_DETAIL}}

<!-- What changed and where it came from: the prompt verbatim, or the requirement doc + the lines that
     moved. A plan whose driver reads "re-prioritized" explains nothing six weeks later.

     If the driver GROUPED the work ("all BE first, then UI"), say which items landed in which stage
     and on what basis — a stage is a judgment about what an item IS, not about which repo it sits in,
     and it is the line most worth arguing with later. Delete `stages:` above and this paragraph when
     the driver expressed no grouping; an empty barrier reads as one that was dropped. -->

<!-- Stage | Items | What put them here
     ------|-------|-------------------
     1 backend | PROJ-102, PROJ-103, PROJ-120 | server-side, incl. the db migration
     2 ui      | PROJ-104, PROJ-105           | everything behind the checkout screen           -->

## Frozen — wave 0 (in flight, NOT re-planned)

<!-- Leaves with a non-terminal run file. They finish as they are: no pause, no reorder, no retarget.
     Containers never appear here — /aidlc:run §3a rolls a parent to in_progress the moment its first
     child starts (F19), which says nothing about the parent being unsafe to re-plan. -->

| Item | Repo | Phase | Run file | Outranked by the new order? |
|------|------|-------|----------|------------------------------|

## Waves

<!-- Wave N+1 starts when every item in wave N is terminal. Within a wave, items are concurrent:
     /aidlc:sprint launches them together. Ordering inside a wave is presentation only.

     When the driver grouped, head each wave with its stage and draw the barrier between stages, as
     `──── barrier: <stage> may start ────`. The barrier is the thing the driver bought; a flat wave
     list hides whether it was honoured, and hides the wall-clock it cost. -->

### Wave 1

| Item | Type | Repo | Pri | Est | Title |
|------|------|------|-----|-----|-------|

## Held — not schedulable yet

<!-- Each with the reason the packer refused it: blocked, unrouted, an unknown or circular dependency.
     Held is a to-do list for grooming, not a silent omission. -->

| Item | Reason |
|------|--------|

## Board deltas — apply by hand if you want the board to match

<!-- This plan is an execution OVERLAY: it writes nothing to the tracker. These are the edits that
     would make the board agree with it. Nothing here is required for the plan to be followed. -->

| Item | Field | Board | Plan | Why |
|------|-------|-------|------|-----|

## Item snapshot

<!-- The fields the packing depends on, as they were when the plan was cut. /aidlc:next and
     /aidlc:sprint diff this against the live board to decide whether the plan can still be trusted
     (resolve-waves.mjs → checkFreshness). Do not hand-edit. -->

```json
{{ITEM_SNAPSHOT_JSON}}
```

## Log

- {{NOW_UTC}} plan cut — {{WAVE_COUNT}} wave(s), {{FROZEN_COUNT}} frozen, {{HELD_COUNT}} held
