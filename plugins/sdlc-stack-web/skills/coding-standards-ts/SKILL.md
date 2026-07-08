---
name: coding-standards-ts
description: Bee-Logical TypeScript coding standards — typing discipline, error handling, naming, module structure and async rules. Load when writing or reviewing TypeScript/JavaScript code in any project on the web stack.
user-invocable: false
---

# TypeScript coding standards

Enforced at write time (implementer) and check time (reviewer). Where the project's ESLint
config disagrees with this file, the project config wins — these are the defaults.

## Typing

- `strict: true` assumed. No `any` — use `unknown` + narrowing; a justified `any` needs a
  `// why:` comment. No non-null assertions (`!`) where a guard is possible.
- Types at boundaries: every exported function fully typed; inference is fine inside bodies.
- Model states, not booleans-in-a-trenchcoat: `status: "idle" | "loading" | "error"` over
  `isLoading` + `hasError`. Discriminated unions for variant data.
- Validate at the edge: external data (HTTP bodies, env, DB rows crossing layers, queue
  messages) passes a schema (zod/class-validator per project) before it becomes a typed value.
  Never `as`-cast external data into a type.

## Errors & async

- Throw `Error` subclasses with actionable messages; never throw strings.
- No swallowed errors: every `catch` either handles meaningfully, rethrows with context, or
  logs at the boundary. Empty catch = review finding.
- No floating promises (`@typescript-eslint/no-floating-promises` stance): `await`, `return`,
  or explicitly `void` with a comment.
- `Promise.all` for independent awaits; sequential awaits only for real dependencies.

## Naming & structure

- Files: kebab-case (`user-avatar.service.ts`); classes/types PascalCase; functions/vars
  camelCase; constants SCREAMING_SNAKE only for true module-level constants.
- One exported concept per file as the default; colocate small private helpers.
- Imports: no deep reaches across module boundaries (`../../other-module/internal/x`) — go
  through the module's public surface (index/barrel or exported service).
- Functions do one thing; >~40 lines or >3 nesting levels → extract. Early returns over `else` pyramids.

## Hygiene

- No `console.log` in committed backend code — the project logger, with context fields.
- No commented-out code, no `TODO` without a work-item ref.
- Dates: never `new Date()` arithmetic scattered around — the project's date util (or
  `Temporal`/date-fns per project); always store/transport UTC ISO-8601.
- Magic values get named constants when used twice or non-obvious once.
