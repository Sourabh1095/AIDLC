---
name: coding-standards-ts
description: Bee-Logical TypeScript coding standards — typing discipline, error handling, naming, module structure and async rules. Load when writing or reviewing TypeScript/JavaScript code in any project on the web stack.
user-invocable: false
---

# TypeScript coding standards

Enforced at write time (implementer) and check time (reviewer). Where the project's ESLint
config disagrees with this file, the project config wins — these are the defaults.

## Tooling baseline (deterministic first)

Most of the rules below are **machine-enforced**, not left to the reviewer's eye. The stack pack
ships a strict baseline in `${CLAUDE_PLUGIN_ROOT}/templates/tooling/` (`tsconfig.base.json`,
`eslint.config.mjs` = `typescript-eslint` strict-type-checked + stylistic + Prettier, `.prettierrc`,
`.editorconfig`, `.npmrc`) that `/sdlc:init` scaffolds into a TS repo and the `sdlc:ci-cd` baseline
runs as a **hard PR gate** (`typecheck` + `lint` + `format` + `test`). The division of labour:

- **Tools own the mechanical rules** — `no-any`, no floating promises, no non-null assertions,
  unused code, formatting, import hygiene, `eqeqeq`, `strict`/`noUncheckedIndexedAccess`. If it can
  be a lint/tsc rule, it belongs there, not in a human's head. The implementer runs `lint`+
  `typecheck` green before finishing; CI re-checks so a disabled reviewer can't let them through.
- **The reviewer owns judgment** — the sections below that a linter can't decide: validate-at-the-
  edge, modelling states over booleans, error-handling *meaning*, naming *intent*, module boundaries,
  dependency choice. Cite these in review; don't re-flag what the linter already caught.

A repo with no baseline yet → note it and prefer scaffolding the baseline over hand-policing style.

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
