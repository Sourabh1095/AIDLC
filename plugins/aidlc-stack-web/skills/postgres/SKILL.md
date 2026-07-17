---
name: postgres
description: PostgreSQL conventions — schema design, indexing strategy, query patterns and review heuristics for the AIDLC pipeline. Load when designing schemas, writing queries or reviewing Postgres-touching changes.
user-invocable: false
---

# PostgreSQL — conventions

Schema CHANGES always go through migrations (`aidlc-stack-web:db-migrations`) — this skill is how to
design and query well. Ad-hoc DB access uses read-only credentials (MCP or approved psql).

## Schema design

- Names: snake_case tables (plural) and columns; `id` PK (`bigint generated always as identity`
  or `uuid` — match the project's existing convention); `created_at`/`updated_at timestamptz`
  everywhere (`timestamptz`, never naive `timestamp`).
- Constraints are documentation that can't lie: `NOT NULL` by default, FKs for every logical
  reference (with a deliberate `ON DELETE` choice), `UNIQUE` where business rules say so,
  `CHECK` for closed value sets (or a lookup table when values change at runtime).
- Prefer normalized until measured; `jsonb` for genuinely schemaless payloads only — with a
  GIN index if queried, and never for fields you filter/join on individually.
- Money: `numeric`, never `float`. Enums: check constraints or lookup tables over native enums
  (native enum ALTERs are painful — see migrations).

## Indexing

- Index: every FK column, every column in frequent WHERE/ORDER BY, composite indexes matching
  the query's column order (equality columns first, then range/sort).
- Partial indexes for hot subsets (`WHERE status = 'active'`), covering indexes (`INCLUDE`)
  when a read path is critical.
- Every new query in review: what index serves it? None → add one in the same migration, or
  justify why the table stays small. `EXPLAIN (ANALYZE, BUFFERS)` on anything non-obvious —
  claim performance with a plan, not vibes.

## Query patterns

- Parameterized always ($1/ORM binding). String-built SQL = security BLOCKER.
- No N+1: batch with `WHERE id = ANY($1)` / joins / ORM eager loading — verify what the ORM
  actually emits (log SQL in dev when unsure).
- Pagination: keyset (`WHERE (created_at, id) < ($1, $2) ORDER BY ... LIMIT n`) for anything
  user-scrollable; OFFSET only for small, bounded admin lists.
- Transactions wrap multi-write invariants, kept short (no network calls inside); use
  `SELECT ... FOR UPDATE` (or optimistic versioning) for read-modify-write races;
  `ON CONFLICT` for upserts instead of check-then-insert.
- Bulk ops: one multi-row statement / `COPY` over row-at-a-time loops.

## Review checklist for Postgres-touching diffs

Every schema change in a migration (never sync-DDL)? · New query's index story? · N+1
introduced? · Transaction where an invariant spans writes? · `timestamptz`? · Money as numeric?
