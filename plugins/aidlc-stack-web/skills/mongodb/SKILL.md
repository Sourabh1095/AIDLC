---
name: mongodb
description: MongoDB conventions — document modeling (embed vs reference), index strategy, aggregation patterns and update discipline. Load when designing collections, writing queries/aggregations or reviewing MongoDB-touching changes.
user-invocable: false
---

# MongoDB — conventions

Ad-hoc access is read-only (`mongodb-mcp-server --readOnly`); schema-shaped changes (new
collections, index changes, backfills) go through migration scripts per `aidlc-stack-web:db-migrations`.

## Document modeling (the embed/reference decision)

- **Embed** what you read together and that grows boundedly (an order's line items).
  **Reference** what grows unboundedly, is shared across parents, or is queried independently
  (a user's activity events). The 16 MB document cap is a design constraint, not a runtime
  surprise — unbounded arrays inside documents are a review finding.
- Model for the access patterns you have: list the top queries FIRST, shape documents to serve
  them; denormalize deliberately (duplicate a display name) with an explicit update story for
  the duplicated field.
- Schema enforcement in the app layer (Mongoose schemas / zod at the boundary) — plus
  `$jsonSchema` validators on collections where corruption would be costly.
- `_id`: default ObjectId unless a natural key is truly immutable. Timestamps: schema-level
  `timestamps: true` or explicit `createdAt/updatedAt` Dates (UTC).

## Indexes

- Every production query filters/sorts on an indexed prefix — ESR rule for compounds:
  Equality, Sort, Range, in that order.
- Unique indexes for business uniqueness (email); partial indexes for hot subsets; TTL indexes
  for expiring data (sessions, tokens) instead of cleanup jobs.
- Verify with `.explain("executionStats")`: `IXSCAN` not `COLLSCAN`, and
  `totalDocsExamined` ≈ `nReturned` on hot paths. Claim performance with the plan.

## Queries & updates

- Update with operators (`$set`, `$inc`, `$push` + `$slice`) — never read-modify-replace whole
  documents (races + clobbering). `findOneAndUpdate` for atomic read-modify-write.
- Projections always on hot paths — don't ship whole documents to render three fields.
- Aggregations: `$match` (indexed) first, `$project` early to shrink, `$lookup` sparingly —
  a pipeline full of `$lookup`s usually means the model fights the access pattern.
- Multi-document invariants: restructure to single-document atomicity first; transactions
  (replica set required) as the deliberate exception, kept short.
- Never construct queries from raw user input as objects (`{ [userKey]: userValue }`) —
  operator injection (`$gt: ""`); sanitize/whitelist fields at the boundary.

## Review checklist for Mongo-touching diffs

Unbounded array growth? · New query's index (ESR)? · Whole-doc replace where operators fit? ·
COLLSCAN on a hot path? · Duplicated field with no update story? · Query-object injection?
