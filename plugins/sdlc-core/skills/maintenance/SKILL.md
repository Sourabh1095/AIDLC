---
name: maintenance
description: Dependency updates, deprecation sweeps and safe-refactor protocol for maintenance work items. Load when updating dependencies, removing deprecated usage, or running scheduled maintenance.
user-invocable: false
---

# Maintenance — updates, sweeps, refactors

## Dependency updates (batched, risk-tiered)

1. `npm outdated` → tier the list: **patch** (batch freely) · **minor** (batch per area:
   build tooling / runtime deps / test tooling) · **major** (ONE per commit, each with its
   migration notes read first — Context7/release notes, never blind).
2. Per batch: update → `npm ci`-clean install → full suite + build → commit
   `chore(deps): <scope> <from>→<to>` with notable changes in the body.
3. A major with breaking API usage in the repo = its own plan tasks (grep usage sites first;
   count them before promising the update in one run).
4. Security advisories jump the queue: see `sdlc:security` §dependency audit.
5. Never mix dependency updates with feature work in one branch.

## Deprecation sweeps

Grep for the deprecated API across the repo FIRST — the count decides: ≤10 sites → fix in one
run; more → file a work item per subsystem. Mechanical replacements get one commit per pattern
(reviewable); behavioral replacements get tests before the swap.

## Safe-refactor protocol

1. Characterization tests first where coverage is thin — lock current behavior before moving it.
2. Small reversible steps, suite green after each; commit each step.
3. Behavior-preserving by definition: any intentional behavior change is a separate item.
4. Rename/move with the language server or grep-verified completeness (imports, string refs, docs).
5. Public API refactors: expand-contract (add new → migrate callers → deprecate old → remove
   in a later release), matching `sdlc-stack-web:db-migrations` shape.

## Hygiene targets worth a maintenance item

Flaky tests quarantined >2 weeks · TODOs without item refs · unused dependencies
(`depcheck`) · node/tooling version drift from `.nvmrc`/engines · lockfile-manifest divergence.
