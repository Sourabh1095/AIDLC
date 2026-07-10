---
name: project-structure
description: Enterprise project structure for the web stack — the canonical folder trees, layering rules and state/data conventions (NestJS backend; Next.js App-Router or RTK-Query SPA frontend) that make a repo read as enterprise-grade at a glance. Load when scaffolding a repo, placing new code, or reviewing that code lives in the right layer.
user-invocable: false
---

# Project structure — the enterprise skeleton

Code quality isn't only how a function reads; it's whether someone opening the repo sees *a place
for everything and everything in its place*. This skill defines the canonical trees and the layering
rules. Structure is guaranteed three ways: **scaffolded** by `/sdlc:init` (repos start enterprise-
shaped), **enforced** by a `dependency-cruiser` boundary gate that fails CI on violations
(`templates/structure/dependency-cruiser/`), and **reviewed** (the architect places new work in the
right layer). The project's established structure always wins where it already differs — adopt it,
don't fork a second one.

Pick the frontend flavor at `init`: **next-app** (App-Router-first, server components own server
data) or **rtk-spa** (client-rendered, RTK Query is the primary data layer). Backend is NestJS.

## Backend — NestJS (`backend-nestjs`)

```
src/
  main.ts
  app.module.ts
  config/                     # @nestjs/config: validated env schema, typed namespaces (no raw process.env elsewhere)
  common/                     # cross-cutting, feature-agnostic
    filters/                  # exception filter → the api-design error shape
    interceptors/             # logging, response transform/serialization
    guards/                   # authn/authz guards
    pipes/                    # custom validation/transform pipes
    decorators/               # @CurrentUser, @Roles, …
    constants/
      http-status.ts          # the sanctioned status-code usage (see api-design)
      messages.ts             # ONE home for user-facing + error messages/codes — never inline strings
  modules/
    <feature>/                # e.g. users/  — owns its whole slice
      <feature>.module.ts
      <feature>.controller.ts # THIN: route + validate + delegate; no business logic
      <feature>.service.ts    # business logic, transactions, authz-next-to-query
      <feature>.repository.ts # data access (or ORM model) — the only layer that talks to the DB
      dto/                    # request/response DTOs (class-validator)
      entities/               # entities/schemas
      <feature>.*.spec.ts     # unit (service) + e2e (controller)
  database/                   # data-source, migrations
```

**Layering (enforced):** `controller → service → repository`. A controller must NOT import a
repository or entity directly; a feature must NOT import another feature's internals (go through its
exported service). `common/` may not import from `modules/`. See `sdlc-stack-web:nestjs` for the
request-pipeline rules and `sdlc-stack-web:api-design` for the error shape the filter emits.

**Status codes & messages:** every user-facing string and error code lives in `common/constants/`
(`http-status.ts`, `messages.ts`) — controllers/services reference them, never hard-code literals.
That single module is what makes copy consistent and i18n/auditing possible later.

## Frontend A — Next.js App Router (`frontend-next-app`)

Server Components own server data (fetch in RSC per `sdlc-stack-web:nextjs`). **RTK is for client
state**; **RTK Query for client-side/dynamic data** that genuinely can't be a server fetch — not a
replacement for RSC data loading.

```
src/
  app/                        # routes: page/layout/loading/error/route.ts (server components default)
  components/
    ui/                       # design-system primitives — consume sdlc-ux tokens; zero business logic
    features/<feature>/       # feature-specific components ("use client" only at the leaves)
  hooks/                      # reusable custom hooks (use-*) — one concern each
  store/
    index.ts                  # configureStore (+ RTK Query middleware)
    hooks.ts                  # typed useAppDispatch / useAppSelector
    slices/                   # createSlice — client state
    api/                      # createApi — RTK Query endpoints (one api slice per domain)
  lib/                        # framework-agnostic utils, clients, config
  types/                      # shared types
  constants/
    messages.ts               # user-facing strings — one home
```

## Frontend B — RTK-Query SPA (`frontend-rtk-spa`)

Client-rendered SPA; **RTK Query is the primary data layer** for all server communication.

```
src/
  main.tsx  app.tsx  routes/  # or pages/ (router per project)
  components/{ui,features}/    # same taxonomy as above
  hooks/
  store/
    index.ts  hooks.ts  slices/
    api/                      # createApi base + injected endpoints — the app's data layer
  services/                   # non-RTKQ side effects (ws, storage, third-party SDK wrappers)
  lib/  types/  constants/
```

## Store & RTK Query conventions (both frontends)

- **One store**, `configureStore`; always the **typed** `useAppDispatch`/`useAppSelector` (never the
  bare hooks). Canonical setup ships in `templates/structure/reference/` — copy it, don't reinvent.
- **RTK Query:** one `createApi` base (`store/api/base-api.ts`) with a shared `baseQuery` (auth
  header, error normalization to the api-design shape); feature endpoints via `injectEndpoints`. Use
  `providesTags`/`invalidatesTags` for cache correctness — no manual refetch plumbing.
- **Slices** hold client/UI state only (auth session, modals, filters) — server data belongs in RTK
  Query, not mirrored into slices.
- **Custom hooks** wrap RTK Query hooks + selectors for a feature (`use-current-user.ts`); components
  call the hook, not the store directly. **`ui/` components never import the store** — they take
  props; only `features/*` and route components wire to state.

## Boundary rules (the CI gate enforces these)

`templates/structure/dependency-cruiser/` ships a config per flavor; `/sdlc:init` drops the matching
one and `sdlc:ci-cd` runs `depcruise` in the gate. The rules:

- **No feature→feature internals** — `modules/a` ↛ `modules/b/*` (backend); `features/a` ↛
  `features/b/*` (frontend). Cross-feature goes through the public/exported surface.
- **Backend layering** — controllers ↛ repositories/entities; `common/` ↛ `modules/`.
- **Frontend layering** — `components/ui` ↛ `store` and ↛ `features`; `lib`/`types` ↛ `app`/`components`/`store`.
- **No circular dependencies** (`no-circular`), **no orphans** for source (warn).

## Scaffold manifest (what `/sdlc:init` creates per repo)

For a TS repo, after the tooling baseline, create the tree above for its role (backend-nestjs, or the
chosen frontend flavor): the directories, `common/constants/{http-status,messages}` (backend) /
`store/` + `constants/messages` (frontend) from `templates/structure/reference/`, an example
`<feature>`/feature slice as a pattern to copy, and the matching `.dependency-cruiser.cjs` +
`depcruise` script/devDep. **Merge-aware:** never overwrite an existing structure — if the repo
already has a layout, adopt it and note the difference instead of imposing this one.
