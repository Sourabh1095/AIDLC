---
name: testing
description: AIDLC test policy — the test pyramid, what to test per change type, coverage expectations and flaky-test protocol. Load when writing or evaluating tests during the verify phase.
user-invocable: false
---

# Testing — policy

## Pyramid & placement

- **Unit** (most): pure logic, validation, mappers, guards. Fast, no I/O, no network.
- **Integration**: module boundaries — API route ↔ service ↔ DB (test DB/container), auth middleware chains.
- **E2E** (fewest): the AC's user-visible flows, via Playwright when the project has it. Only
  the critical paths — E2E earns its runtime cost or it doesn't exist.

Match the project's existing framework, directory layout and naming exactly. Never introduce a
second test framework.

## What to test, per change type

| Change | Must-have tests |
|--------|-----------------|
| New endpoint | happy path · validation rejects · authz rejects · error mapping |
| Schema/migration | migration runs on realistic data · rollback safe (or documented irreversible) |
| Bug fix | the failing repro test (written BEFORE the fix), now passing · neighbors of the bug |
| UI feature | component behavior · the AC flows; snapshot tests only for genuinely stable output |
| Refactor | existing suite green — usually no new tests; add characterization tests first if coverage was absent |

## Quality bar

- A test must FAIL if the behavior it covers breaks. Assertion-free or tautological tests are findings, not coverage.
- Test the AC's boundaries literally: "up to 5 MB" ⇒ test at 5 MB and just over.
- No sleeps for synchronization; await the actual condition.
- Tests are deterministic: fixed clocks/seeds, no order dependence, no shared mutable state.

## Flaky-test protocol

A test failing intermittently on YOUR branch: fix it if your diff caused it. Pre-existing flake
(fails on default branch too): do not chase it inside the run — record as `MINOR` context in
findings and move on. Never delete or skip a failing test to get green.
