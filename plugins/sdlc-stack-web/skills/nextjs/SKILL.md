---
name: nextjs
description: Next.js App Router conventions — server/client component split, data fetching, server actions, routing, caching and performance patterns. Load when implementing, planning or reviewing Next.js frontend work.
user-invocable: false
---

# Next.js — App Router conventions

Assumes App Router (`app/`). Verify the project's Next major version in package.json and use
Context7 for API specifics — caching semantics have shifted across majors; don't trust memory.

**Structure & state.** Folder tree, component taxonomy (`components/{ui,features}`), custom-hooks
and store layout live in **`sdlc-stack-web:project-structure`** (`frontend-next-app`), enforced by a
`dependency-cruiser` gate. State/data split: **Server Components own server data** (fetch in RSC);
**Redux Toolkit** holds client/UI state; **RTK Query** is the client-side data layer for genuinely
dynamic post-load data — not a replacement for RSC fetching. (The `rtk-spa` flavor is for
client-rendered SPAs where RTK Query *is* the primary data layer.)

## Server/client split (the default decision)

- Server Components by default. `"use client"` ONLY for interactivity (state, effects,
  browser APIs, event handlers) — and push it to the leaves: a client island inside a server
  page, never `"use client"` at a layout/page root out of convenience.
- Never import server-only modules (DB clients, secrets, fs) into client components — mark
  sensitive modules with `import "server-only"`.
- Pass serializable props across the boundary; no functions/class instances.

## Data fetching & mutations

- Fetch in Server Components (direct service/DB call or `fetch`) — not `useEffect`-fetching
  for first render data. Client-side fetching is for genuinely dynamic post-load data
  (the project's SWR/React Query if present).
- Mutations: Server Actions (`"use server"`) or route handlers per the project's existing
  pattern — follow it, don't mix. Validate inputs in the action/handler (zod) — it is a public
  endpoint regardless of who calls it, and enforce auth INSIDE it, not only in middleware.
- After mutations: `revalidatePath`/`revalidateTag` — know what you're invalidating; document
  the choice when non-obvious.

## Routing & files

`page.tsx` (route) · `layout.tsx` (persistent shells — no per-page data) · `loading.tsx` +
`error.tsx` at segment level for every data-bearing route · `route.ts` for APIs · dynamic
segments typed via `params`/`searchParams` (they're async in newer majors — check the version).
Group with `(folders)` for organization without URL impact.

## Performance & correctness

- `next/image` for images, `next/font` for fonts, `next/link` for navigation — no raw
  `<img>`/`<a>` for internal routes.
- `<Suspense>` boundaries around slow subtrees; stream rather than block the whole page.
- Env vars: `NEXT_PUBLIC_` is BUNDLED INTO THE CLIENT — secrets must never carry the prefix.
- Metadata via the `metadata` export / `generateMetadata`, not manual `<head>` tags.
- Middleware for redirects/rewrites/edge auth checks only — keep it thin; no heavy compute or DB.

## Testing

Component behavior: Testing Library (user-visible assertions, not implementation details).
Flows per AC: Playwright E2E. Server actions/route handlers: integration tests calling them
directly with schema-validated fixtures.
