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

## Cross-repo dependencies (poly — the shared-package pattern) (F28)

A poly workspace often has one repo own a package the others consume — a shared `@beelogical/dev-config`
(eslint/prettier/tsconfig/lint-staged/depcruise presets), a shared `sdk`, shared types. **How the
consumer resolves that dependency is a design decision, because CI checks out ONE repo.** An
unpublished **`file:../sibling`** link is the natural local-dev choice and resolves in the multi-repo
workspace — but it is **local-only and fails isolated single-repo CI** (`Cannot find package …`). Pick
one, up front:

- **Publish** (Azure Artifacts / a private registry) and consume by version. This is the config's
  usual stated intent ("published `@beelogical/dev-config`"), and it is **required** for a
  **transitive/built** cross-repo dep — a repo that consumes a *built* sibling (a compiled SDK it
  type-checks against), not just flat config files. Multi-checkout degrades badly there (multiple
  sibling checkouts + building the sibling).
- **Multi-repo checkout** in CI — check the sibling out alongside and `npm ci` it too. Workable for a
  **leaf** config dependency only. See `sdlc:ci-cd` → *Poly cross-repo package dependencies* and the
  multi-checkout block in `sdlc-stack-web/templates/ci/`.

Never ship an unpublished `file:` sibling link into a `mode: remote` repo expecting CI to pass — it
won't. Decide publish-vs-checkout before fanning the pattern out to consumers.

## Repo-scaffold checklist (applies to `/sdlc:init` AND any `/sdlc:run` scaffold task)

Whenever a repo is scaffolded to this structure — by `/sdlc:init` Step 4 **or** by an implementer
running a scaffold task via `/sdlc:run` — apply this checklist in full. Items 2–3 are **easy to
forget** because nothing fails loudly without them (there's no CI in local mode to notice a missing
boundary gate), so treat every item as mandatory, not optional. A `/sdlc:run` scaffold has no init
wizard to prompt for these — the implementer owns the checklist.

For a TS repo, after the tooling baseline (`templates/tooling/`), create the tree above for its role
(`backend-nestjs`, `frontend-next-app`, or `frontend-rtk-spa`):

1. **Layout** — the directories for the role, plus `common/constants/{http-status,messages}` (backend)
   / `store/` + `constants/messages` (frontend) copied from `templates/structure/reference/`, and ONE
   example `<feature>`/feature slice as a copy-me pattern.
2. **Boundary gate — do NOT skip (F9).** Drop the matching
   `templates/structure/dependency-cruiser/.dependency-cruiser.<flavor>.cjs` (`<flavor>` =
   `nestjs` / `next-app` / `rtk-spa`) into the repo root as **`.dependency-cruiser.cjs`**, add
   **`dependency-cruiser@^17`** to devDependencies (**pin the `^17` floor, not a bare name — F30**),
   and add a **`depcruise`** script (`"depcruise": "depcruise src"`). Without this file the boundary
   check has nothing to run and is **silently inert** — the layout looks enforced but isn't. Worse,
   **`dependency-cruiser < 17` silently no-ops on `.ts`** — it runs, reports zero violations, and the
   gate passes green while enforcing nothing; that's why the floor is mandatory, not cosmetic. The
   shipped profiles also set `enhancedResolveOptions` (exports-map subpath resolution, F26), which
   likewise needs `>= 17`. Belt-and-suspenders: the CI gate asserts a **non-empty module graph** (fail
   if depcruise analyzed 0 `.ts` files) — see `sdlc:ci-cd`. `sdlc:ci-cd` runs `depcruise` in the PR
   gate; it only bites when the config is present.
3. **Hardened `.gitignore` (F14).** Copy `templates/tooling/.gitignore` — it ignores `.env*` with a
   `!.env.example` allow-exception (plus `node_modules`/`dist`/`build`/`coverage`/`.next`). Secret-
   bearing env files must be ignored by default; a framework's stock `.gitignore` often only covers
   `.env*.local`, which is not enough for auth/identity repos.
3a. **Line endings — `.gitattributes` (F17).** Copy `templates/tooling/.gitattributes` (`* text=auto
   eol=lf` + binary rules). Without it, Windows checkouts churn CRLF↔LF on every touch and tools/agents
   misattribute genuine-or-phantom format diffs to line endings — a Prettier run flags CRLF files as
   "unformatted" even when the content is clean. `.editorconfig` (item covered by the tooling baseline)
   is editor-time; `.gitattributes` is git-time — you need both. **Before ever logging a line-ending
   finding, confirm the truth with `git ls-files --eol <path>`** (`i/`=index, `w/`=working tree,
   `attr/`=applied rule); a wrong CRLF diagnosis costs a correction cycle.
3b. **Format-clean at scaffold (F18).** Run `prettier --write .` **repo-wide** once the tooling baseline
   is in place, so the fresh repo passes its own `format` (`prettier --check .`) gate on the first
   merge. In **local mode there is no CI** to catch a format-dirty merge, so this is the only gate —
   don't skip it. The enforced gate must run `format:check` (prettier), not just eslint.
4. **Base tsconfig stays strictness-only (F10).** Point the repo's `tsconfig.json` at
   `templates/tooling/tsconfig.base.json` via `extends`, and set `module`/`moduleResolution`/`target`/
   `paths` in the repo's OWN tsconfig — never in the shared base (see
   `sdlc-stack-web:coding-standards-ts` for the why).
5. **Framework extras.** RTK flavors also need `@reduxjs/toolkit` + `react-redux`. **Next.js** repos
   use the pre-composed tooling overlay (`templates/tooling/next/`) as their `eslint.config.mjs`
   instead of the plain baseline — see `sdlc-stack-web:nextjs`.
6. **Pre-commit hooks (F21, optional).** The baseline enforces standards at the CI/merge gate but
   nothing at commit time. If the project uses the husky + lint-staged layer, copy
   `templates/tooling/husky/pre-commit` → `.husky/pre-commit` and `templates/tooling/lint-staged.config.mjs`,
   add `husky` + `lint-staged` devDeps, and wire a **CI-safe** `"prepare": "husky || true"` (bare
   `husky` exits 127 on `npm ci` in a CI container or a `file:../` sibling checkout without it). It's
   opt-in at `/sdlc:init`; a `/sdlc:run` scaffold should match whatever the sibling repos already do.

**Merge-aware:** never overwrite an existing structure/config — if the repo already has a layout, a
`.dependency-cruiser.cjs`, a `.gitignore`, or a `.gitattributes`, adopt it, note the difference, and
skip that item. Skip non-TS repos entirely.
