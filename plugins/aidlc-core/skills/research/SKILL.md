---
name: research
description: The AIDLC spike protocol — sharpen the question, gather cited evidence, verify load-bearing claims, deliver a decision report. Load when running a spike work item or researching a technical choice mid-run.
user-invocable: false
---

# Research — spike protocol

A spike retires uncertainty. Success = a decision someone can act on tomorrow; failure = a
survey. Timebox mentality: prefer a good answer with stated unknowns over an exhaustive one.

## Protocol

1. **Sharpen**: rewrite the spike into one decidable question + explicit criteria (constraints
   from stack, codebase, team skills, license posture, budget). If the item hides several
   questions, split — answer the blocking one, file items for the rest.
2. **Gather** (in this order): the codebase (what's already there constrains everything) →
   Context7 for current library docs → WebSearch for comparisons, maintenance signals, issue
   trackers, migration stories. Prefer primary sources (docs, repos, benchmarks with method)
   over listicles.
3. **Verify what the decision rests on**: version/peer-dep compatibility against the actual
   package.json · license · maintenance (last release, open-issue triage) · THE performance or
   capability claim. Best verification is a 30-minute PoC in the scratchpad — run it when the
   claim is checkable.
4. **Decide**: one recommendation. A runner-up with its tipping condition. Risks with
   mitigations. Integration effort (S/M/L). Unknowns stated as unknowns.

## Decision report format (`docs/research/{ID}-<slug>.md`)

```
# <Question>
**Recommendation: <X> (confidence: high|medium|low)** — <one-sentence why>
## Evidence          (claims + inline links / "verified locally: <how>")
## Alternatives      (criteria × options table, honest scores)
## Risks & unknowns
## Suggested follow-ups   (work items to create)
```

## Rules

- Every load-bearing claim: source link or local verification note. No naked assertions.
- Date-stamp the report — research rots; a year-old spike gets re-verified, not trusted.
- PoC code is disposable and lives in scratchpad or `docs/research/poc-{ID}/` — never in `src/`.
