---
name: requirements
description: Acceptance-criteria quality bar, INVEST checklist and the assumption-logging protocol for the AIDLC requirements phase. Load when validating, refining or writing acceptance criteria for a work item.
user-invocable: false
---

# Requirements — AC quality bar & assumption protocol

## Acceptance-criterion quality bar

A good AC is:
- **Testable** — a test could pass/fail it mechanically. "Works well" fails; "upload completes in <3s for a 5MB file" passes.
- **Unambiguous** — one interpretation. Quantify limits, name exact error behaviors.
- **Complete over its slice** — happy path AND the failure path it implies (invalid input, unauthorized, limits exceeded).
- **Scoped** — describes WHAT, not HOW (implementation belongs in the plan).

Prefer the checkbox form; use Gherkin (`Given/When/Then`) only when sequencing matters.

## INVEST (stories) / decomposition bar (epics)

Independent · Negotiable · Valuable · Estimable · Small (fits one run: ≤ L) · Testable.
Epic children must each be independently shippable and mergeable — no "part 1/2" stories that
only work together.

## Common gaps to check for (add criteria if implied by the description)

authz (who may do this?) · validation limits (size/type/length) · error UX (what does the user
see on failure?) · empty/zero states · concurrency (double-submit) · i18n/timezone if the
project has them · data migration for schema changes.

## Assumption-logging protocol (autonomy = high)

When the item underspecifies and the gate is `assume-and-log`:

1. Make the assumption a senior engineer would defend in review.
2. Record it in the run file `## Assumptions`:
   `- ASSUMED: <what>. Because: <why reasonable>. If wrong: <blast radius>.`
3. Mirror to the work item via `adapter.comment` — the humans watching the tracker must see it
   without opening the repo.
4. Assumptions also land in the PR body ("Assumptions made") — three chances for a human to catch a bad one.

**Do NOT assume** (verdict AMBIGUOUS instead): pricing/billing behavior, data deletion policy,
security/privacy posture changes, anything contractual or irreversible.
