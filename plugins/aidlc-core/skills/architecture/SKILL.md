---
name: architecture
description: ADR triggers and format, design-review heuristics and the explore-before-deciding checklist for the AIDLC design phase. Load when planning a medium-or-larger work item or making a hard-to-reverse technical decision.
user-invocable: false
---

# Architecture — deciding well, recording why

## Explore before deciding (checklist)

Before proposing a design, know: (1) how the codebase already solves the nearest similar
problem — copy the pattern unless it's the problem; (2) the data model the change touches and
who else reads/writes it; (3) the module boundaries you'd cross and their contracts; (4) the
current versions/capabilities of the libraries involved (Context7, not memory); (5) what the
item's NON-goals are.

## Decision heuristics

- **Reversible? Decide fast, note it, move on.** Irreversible (schema, public API, new
  dependency, cross-service pattern)? Slow down, write the ADR.
- Prefer boring: the pattern already in the repo > the well-known standard > the clever new thing.
- New dependency bar: actively maintained, license compatible, does ≥80% of the need, and the
  alternative is >1 day of in-house code. Otherwise write the small thing.
- Design for deletion: isolate the change so it can be ripped out — feature flags for risky
  user-facing behavior, adapters at third-party seams.
- Contract changes are expand-contract, never break-and-fix (see `aidlc-stack-web:db-migrations` for the
  DB variant; the same shape applies to APIs: add → migrate consumers → remove).

## ADR — when and how

Write one when the decision is hard to reverse or someone will ask "why is it like this?" in a
year. File: `docs/adr/NNNN-<slug>.md` (NNNN = next number), from
`${CLAUDE_PLUGIN_ROOT}/templates/adr-template.md`:
Status (proposed/accepted/superseded-by-NNNN) · Context (forces, constraints — why now) ·
Decision (one paragraph, active voice) · **Rationale** (why this over the alternatives — the section
the code can never supply) · Alternatives considered (one line each + why not) ·
Consequences (good AND bad — an ADR with no downsides wasn't thought through).

Keep it under a page. Link it from the run file's `## Plan` and reference it in the PR body.

**Retroactive ADRs are a different artifact with the same shape.** On a brownfield project,
`/aidlc:adopt` derives the decisions the code already embodies and `/aidlc:adopt-adr` writes them at
status `accepted (retroactive)`, dated `unknown` where history cannot establish it, citing `path:line`
evidence — with **Rationale and Alternatives left as "not recorded — confirm with the team"**. A scan
sees what was decided, never why, and an invented reason in an accepted ADR is worse than a blank one
because every later reader trusts it. When you read an ADR marked retroactive with a blank rationale,
treat the decision as binding and the reasoning as genuinely unknown — do not fill it in by inference.

## Design review (when reviewing someone else's plan)

Attack in order: does it meet the AC? · what breaks at the boundaries it crosses? · what's the
migration/rollback story? · what happens under failure (timeout, partial write, retry)? ·
is there a simpler shape that loses nothing important?
