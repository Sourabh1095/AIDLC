---
name: nestjs
description: NestJS backend conventions — module boundaries, dependency injection, DTO validation, error handling, configuration and testing patterns. Load when implementing, planning or reviewing NestJS backend work.
user-invocable: false
---

# NestJS — conventions

## Module structure

The canonical folder tree, layering rules and the centralized `common/constants/{http-status,
messages}` module live in **`sdlc-stack-web:project-structure`** (`backend-nestjs`) — and a
`dependency-cruiser` gate enforces the layering in CI. This section is the *why*; that skill is the
*where*.

When scaffolding a Nest repo (via `/sdlc:init` **or** a `/sdlc:run` scaffold task), follow that
skill's repo-scaffold checklist — in particular drop `.dependency-cruiser.nestjs.cjs` into the root as
`.dependency-cruiser.cjs` (with the `depcruise` script + a **`dependency-cruiser@^17`** devDep — pin
the floor; `< 17` silently no-ops on `.ts` and the gate passes green enforcing nothing, F30) plus the
hardened `.gitignore` and `.gitattributes`; without the boundary config the layering gate is silently
inert.

- Feature modules own their domain: `users/` = `users.module.ts`, controller, service, repository,
  DTOs (`dto/`), entities/schemas. Cross-feature access ONLY through an exported service —
  never import another module's repository/entity directly.
- `imports` what you use, `exports` only what others need. Circular deps are a design smell —
  restructure before reaching for `forwardRef`.
- Config: `@nestjs/config` with a validated schema (fail fast at boot on missing env), typed
  via `ConfigService` or config namespaces. No raw `process.env` outside the config layer.

## Request pipeline

- **DTO + ValidationPipe for every input**: `class-validator` decorators, global
  `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` — unknown
  fields rejected, types coerced once, then trusted.
- Controllers stay thin: parse/validate → call service → shape response. Business logic lives
  in services; controllers with `if`-trees are a finding.
- Responses: never return entities with sensitive fields — response DTOs or
  `ClassSerializerInterceptor` + `@Exclude`.
- Auth: guards (`@UseGuards`) declare the requirement at controller/route level; authorization
  checks (ownership/tenancy) live in the service, next to the query.

## Errors

- Throw Nest HTTP exceptions (`NotFoundException`, …) at the service boundary for expected
  failures; let an exception filter map domain/unknown errors → 500 with a safe body (no stack
  traces to clients; full detail to the logger).
- Async all the way down — no `.then` chains mixed with `await`; repository/network calls
  always awaited inside try/catch ONLY where handling adds value.

## Data access

Per-project ORM/ODM (TypeORM/Prisma/Mongoose — check package.json, follow `sdlc-stack-web:postgres` /
`sdlc-stack-web:mongodb`): repositories/models injected via DI, transactions at the service layer
around multi-write invariants, no query building in controllers.

## Testing

- Unit: services with mocked deps via `Test.createTestingModule` — assert behavior + calls.
- Integration/e2e: `supertest` against the real Nest app with a test DB (containerized) —
  cover each endpoint's happy/validation/authz paths per `sdlc:testing`.
- Don't mock what you own inside an integration test — mock at the external boundary
  (third-party APIs), exercise your own stack for real.

### ESM-only deps consumed via `import()` (F33)

A CommonJS Nest repo that consumes an **ESM-only** dependency through a dynamic `import()` wrapper
(the endorsed CJS↔ESM interop — e.g. `nest-oidc-provider` wrapping ESM-only `oidc-provider`) will find
that **jest can't execute the dynamic ESM import** under the default CJS transform. The test throws on
the `import()` until you enable VM modules:

```jsonc
// package.json — the test script
{ "scripts": { "test": "NODE_OPTIONS=--experimental-vm-modules jest" } }
```

(Cross-platform: use `cross-env NODE_OPTIONS=--experimental-vm-modules jest`, since bare `NODE_OPTIONS=`
prefixing doesn't work on Windows shells.) Two gotchas that bite together: (1) without the flag the
dynamic import fails at runtime, not compile time — the error points at the wrapper, not the config;
(2) a new e2e file must match the repo's **`testRegex`** or jest silently won't run it. ESM-only
libraries are increasingly common, so any web-stack repo consuming one via `import()` hits this.
