---
name: db-migrations
description: Database migration safety — expand-contract sequencing, rollback discipline, backfills and risky-DDL rules for Postgres and MongoDB. Load whenever a change touches schema, adds columns/collections/indexes, or requires a data backfill.
user-invocable: false
---

# DB migrations — expand-contract or it doesn't ship

Deployed code and schema are never in lockstep — every migration must be safe with BOTH the
previous and the next code version running. That is the whole discipline.

## The expand-contract sequence (any breaking reshape)

1. **Expand** (migration N): add the new column/table/collection/field alongside the old. New
   code writes BOTH, reads old.
2. **Backfill** (script or migration N+1): copy/derive old → new, in batches.
3. **Flip reads** (code release): read new, still write both.
4. **Contract** (migration N+2, a LATER release): stop writing old, drop it.

One run ships ONE step of this ladder, never the whole ladder. The plan says which step and
files follow-up items for the rest.

## Rules for every migration

- Through the project's migration tool (TypeORM/Prisma/Knex/migrate-mongo — match what
  exists), sequentially numbered, committed with the code that needs it.
- **Down/rollback defined** — or the migration is explicitly marked irreversible and the plan
  says why + what the recovery is (usually: restore + roll forward).
- Idempotent-safe where the tool allows (`IF NOT EXISTS` guards).
- Never edit a merged migration — fix forward with a new one.
- Test locally against realistic data: up → down → up. A migration only tested on an empty DB
  isn't tested.

## Risky-DDL rules (Postgres)

- New columns: nullable or `DEFAULT` (modern PG fills constant defaults without rewrite);
  adding `NOT NULL` to an existing column = add constraint `NOT VALID` → backfill →
  `VALIDATE CONSTRAINT`.
- Index creation on non-trivial tables: `CREATE INDEX CONCURRENTLY` (outside the transaction —
  most tools need a config flag for this).
- No table rewrites during business hours mentality: type changes, column drops on hot tables →
  expand-contract instead.
- Renames are breaking (old code still runs) → expand-contract, never `RENAME` in place.

## Backfills

Batched (1k–10k rows/docs per iteration, keyset-paged), resumable (track progress), throttled,
and separated from DDL migrations. Long backfills are their own work item.

## MongoDB specifics

"Schemaless" ≠ migration-free: field renames/reshapes follow the same expand-contract via
versioned application handling or batched update scripts (migrate-mongo). Index builds on
large collections: background/rolling; validator changes: `validationLevel: "moderate"` first.
