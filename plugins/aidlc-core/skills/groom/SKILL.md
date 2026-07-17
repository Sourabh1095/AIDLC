---
name: groom
description: Backlog refinement session — sweep todo items, refine weak acceptance criteria, size unsized items, flag blockers and stale items, propose epic decompositions and priority changes. Use when asked to groom, refine or clean up the backlog.
argument-hint: "[label or item-type filter, optional]"
---

# /aidlc:groom — backlog refinement

A grooming sweep makes items *ready* so `/aidlc:next` never picks up junk. Route to the active
adapter (`aidlc:work-items`), then dispatch **Agent → aidlc-analyst** with this protocol
(pass any filter from `$ARGUMENTS`).

## Sweep protocol (analyst)

**Count first, then cover the whole backlog — don't groom only the first page (F34).** Get the total
count of `todo` items, then either page through *all* of them or, if you deliberately cap this pass,
say so out loud ("N items ready — grooming the first K this pass"). A silent `limit` that refines 20%
of a 120-item backlog and reports "groomed" is exactly the bug this guards against (see
`aidlc:work-items` → *Full-backlog sweeps*). Fetch with `query({status: "todo"})` (all matches, paged to
completion) plus, for markdown source, epics too. For each item, in priority order:

1. **AC quality** (per `aidlc:requirements`): weak/missing AC on stories and bugs → refine and
   `updateAC(...)`. Log what changed via `comment` (`AIDLC groom: AC refined — <n> criteria`).
2. **Size** unsized items (S/M/L/XL, grounded in a quick codebase look). **XL items are a
   finding**: propose a split into 2–4 children (do not create them yet — see report).
3. **Epics** with no open children → propose decomposition (list the child stories with
   one-line AC summaries; **in poly, propose the repo for each child** and any `dependsOn`
   ordering; create only on human approval in the report step). For epics that already have
   children, flag any cross-repo children missing `dependsOn` sequencing.
4. **Flags**: items blocked by a dependency (note what unblocks them), duplicates
   (near-identical titles/descriptions), stale in-progress items with no run file, bugs with
   no reproduction steps (comment asking the reporter for steps).
5. **Priority sanity**: note mismatches (e.g. a bug in the auth path at P4) — **suggest, never
   change**: priorities are the product owner's call.
6. **Repo routing** (poly only): items whose `repo` is unset and can't be inferred from labels →
   propose a repo (grounded in a quick look at the candidate repos); apply on approval. **Cross-repo
   items are split candidates — flag them per `workspace.crossRepoSplit`** (default `story`; see
   `aidlc:work-items` → *Cross-repo split tier*): in **`story` mode**, a Story whose scope spans repos
   should be re-modelled as a **Feature → per-repo child Stories** (not one fat cross-repo story); in
   **`task` mode**, a cross-repo **Story is fine as an umbrella** — flag it only if it lacks a per-repo
   **Task** breakdown (propose the per-repo tasks). A single **Task** spanning repos is always a split
   candidate. Apply the **AC coverage map** so no original AC is dropped (`aidlc:work-items` →
   *Re-decomposition*). Grooming is the cheap place to fix this — before it reaches a run. Also flag
   items that really target the **`control-plane`** (F8) or an **undeclared repo** (a shared lib /
   future product → offer `/aidlc:repo add`, F2).

## Autonomy boundaries

- **Applied automatically (by the analyst, inline):** AC refinement, sizing, factual comments/flags.
- **Proposed only — require human approval:** epic decomposition into new items, XL/cross-repo splits,
  priority changes, repo-routing writes, closing/superseding duplicates.

**Who applies the approved actions (F35).** The human-approval gate lives in the **coordinator turn** —
the main session that asked the user (e.g. via AskUserQuestion). So the **coordinator applies the gated
actions itself** after approval. Do NOT re-dispatch the analyst to "execute — the user approved": a
fresh subagent cannot verify consent it never received first-hand, and correctly will not act on a
peer's *claim* of consent. Therefore the analyst's sweep is **propose-only for gated actions**; the
approved epic decompositions, splits, priority changes and routing writes are performed by the
coordinator through the adapter (each write read-back-verified per `aidlc:work-items` → *Write
verification*). Re-involve the analyst only for fresh analysis, never as a post-approval executor.

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

Apply the "needs your call" actions only after the user picks them — and the **coordinator** applies
them directly (never a re-dispatched analyst; see *Autonomy boundaries* → F35).
