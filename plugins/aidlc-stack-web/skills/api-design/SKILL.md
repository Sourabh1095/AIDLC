---
name: api-design
description: REST API contract conventions shared between the Next.js frontend and NestJS backend — resource naming, status codes, error shape, pagination, versioning and OpenAPI discipline. Load when adding or changing API endpoints.
user-invocable: false
---

# API design — the FE↔BE contract

The API is a contract two teams build against simultaneously — breaking it casually costs a
sprint. Changes follow expand-contract (`aidlc:architecture`).

## Resources & verbs

- Nouns, plural, kebab-case: `/api/users/{id}/avatar-uploads`. No verbs in paths — the method
  is the verb. Genuinely non-CRUD actions: sub-resource verb as last resort
  (`POST /orders/{id}/cancel`), documented why.
- `GET` safe + cacheable (never mutates) · `POST` create/actions · `PUT` full replace ·
  `PATCH` partial update · `DELETE` idempotent (repeat-delete → 404 or 204, pick one per project).
- Nesting max one level; deeper relations via query filters (`/comments?postId=…`).

## Status codes (the short honest set)

`200` ok · `201` created (+ `Location`) · `204` no body · `400` malformed/validation ·
`401` unauthenticated · `403` authenticated-but-forbidden · `404` not found (also for
forbidden-by-tenancy where existence itself leaks) · `409` conflict/duplicate ·
`422` semantic validation (if the project distinguishes; else 400) · `500` bug — never a
"business error".

## Error shape (one shape, everywhere)

```json
{ "statusCode": 400, "error": "Bad Request",
  "message": "validation failed",
  "details": [{ "field": "email", "issue": "must be a valid email" }],
  "requestId": "..." }
```
Machine-readable `details` for field errors; `requestId` for log correlation; never stack
traces or internal identifiers. Nest exception filter + Next data layer both speak this shape.

## Collections

- Pagination on every list endpoint from day one (retrofitting breaks clients): cursor-based
  (`?cursor=…&limit=…` + `nextCursor` in the response envelope) preferred; document the max limit.
- Filtering/sorting: whitelisted params (`?status=active&sort=-createdAt`) — never pass-through
  to query objects (injection; see `aidlc-stack-web:mongodb`).
- Envelope: `{ "data": [...], "nextCursor": "...", "total": n? }` — consistent across endpoints.

## Versioning & evolution

- Additive changes (new optional fields, new endpoints) need no version. Breaking changes
  (removing/renaming fields, semantics) → expand-contract; URI version (`/api/v2/...`) only
  when a wholesale break is unavoidable.
- Timestamps: ISO-8601 UTC strings. IDs: strings in the contract (even if numeric inside).
  Booleans never nullable in responses.

## Contract discipline

Every endpoint documented where the project documents (OpenAPI via Nest Swagger decorators is
the default) — the DTO decorators ARE the doc source; keep them true. Shared types package or
generated client (per project) over hand-copied interfaces on the frontend.
