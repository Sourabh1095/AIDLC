---
name: code-review
description: The AIDLC code-review checklist, severity taxonomy and finding-report format used by the aidlc-reviewer agent in the verify phase. Load when reviewing a pipeline diff against acceptance criteria and standards.
user-invocable: false
---

# Code review — checklist, severities, report format

## Checklist (in value order)

1. **AC traceability** — map every acceptance criterion to the code implementing it. Missing/partial = BLOCKER. Tick verified criteria in the item (`[x]`).
2. **Correctness** — off-by-one, null/undefined paths, error handling (swallowed errors, unhandled rejections), async races, transaction boundaries.
3. **Regression risk** — changed signatures/contracts, altered shared utilities, DB schema impacts, API response shape changes.
4. **Security quick pass** — unsanitized input → SQL/NoSQL/command/HTML sinks; secrets/tokens in diff; missing authn/authz on new endpoints; overly broad CORS/permissions. (Deep security review is a separate phase/agent.)
5. **Reuse & duplication** — read the run file's `reuse:` results (`aidlc:reuse` → *Verifying*: `dup-check` + `catalog similar`, already filed as findings) and judge what a matcher cannot: logic copied with renamed variables (`dup-check --fuzzy`), a new component that is an existing one with one prop changed, a hand-rolled helper the project or one of its dependencies already provides, generic code buried in a feature folder, an "extension" that broke an existing caller. Re-implementing something the catalog lists = `MAJOR`; a speculative abstraction with a single caller = `MINOR`.
6. **Standards** — project naming/idioms, loaded coding-standards skills, dead code, TODOs without item refs, commit hygiene (the project's `commitStyle`, `Refs:` line).
7. **Tests** — new behavior has tests that would FAIL if the behavior broke; boundary cases from the AC covered; no assertion-free tests.
8. **Performance sanity** — N+1 queries, unbounded loops over user data, missing indexes for new queries, large payloads unpaginated. Flag only concrete risks, not hypotheticals.

## Severity taxonomy

| Severity | Meaning | Pipeline effect |
|----------|---------|-----------------|
| `BLOCKER` | AC unmet, correctness bug, security hole, broken build | triggers fix cycle |
| `MAJOR` | probable bug, regression risk, critical test missing | triggers fix cycle |
| `MINOR` | style, naming, small gap | recorded; fixed only if trivial |

## Finding format (run file `## Findings`, append-only)

```
- [BLOCKER][open] reviewer: src/upload.ts:42 — file type never validated; AC-1 unmet. Fix: whitelist png/jpeg before write.
```

- One finding per line; `[open]` flips to `[resolved]` (by the implementer) with a trailing note.
- Findings must be **actionable and specific** — file:line, what, why it matters, suggested fix.
- No duplicate findings across cycles: check existing `## Findings` first; re-raise only if a "resolved" fix didn't hold (note `re-opened`).

## Verdicts

`APPROVE` — zero open BLOCKER/MAJOR. `FINDINGS: <counts>` otherwise. Never approve "with comments" while blockers are open.
