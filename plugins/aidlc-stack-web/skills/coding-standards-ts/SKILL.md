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
`.editorconfig`, `.npmrc`) that `/aidlc:init` scaffolds into a TS repo and the `aidlc:ci-cd` baseline
runs as a **hard PR gate** (`typecheck` + `lint` + `format` + `test`). The division of labour:

- **Tools own the mechanical rules** — `no-any`, no floating promises, no non-null assertions,
  unused code, formatting, import hygiene, `eqeqeq`, `strict`/`noUncheckedIndexedAccess`. If it can
  be a lint/tsc rule, it belongs there, not in a human's head. The implementer runs `lint`+
  `typecheck` green before finishing; CI re-checks so a disabled reviewer can't let them through.
- **The reviewer owns judgment** — the sections below that a linter can't decide: validate-at-the-
  edge, modelling states over booleans, error-handling *meaning*, naming *intent*, module boundaries,
  dependency choice. Cite these in review; don't re-flag what the linter already caught.

A repo with no baseline yet → note it and prefer scaffolding the baseline over hand-policing style.

**The shared/base tsconfig is strictness-only.** `templates/tooling/tsconfig.base.json` carries *only*
strictness flags (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, …) — it
deliberately sets **no** `moduleResolution`, **no** `baseUrl`/`paths`, and **no** `target`/`module`.
Those belong in each repo's OWN `tsconfig.json` (which does `"extends": "./tsconfig.base.json"`), for
two reasons. (1) **Clean layering:** module-resolution/target are per-runtime — a Next app, a
`tsc`-built CJS SDK, and a Nest service each need different values, so any shared value is wrong for
someone. (2) **Deprecation:** TypeScript deprecates the older `moduleResolution` values (`"node"` is
now `"node10"`, and both are deprecated), so a shared base that sets one forces **every** consumer to
inherit the deprecation and patch it with `ignoreDeprecations` — a workaround that won't survive a
major TS bump. Leave `moduleResolution` **unset** and use **no `baseUrl`** in the base → zero
deprecation suppression anywhere (empirically validated on a `tsc`-built CJS repo). If you're
hand-authoring a shared config instead of using the template, hold the same line — a strictness-only
base is the invariant, not a template detail. `aidlc-stack-web:project-structure`'s repo-scaffold
checklist enforces this at scaffold time.

**Next.js repos** don't hand-reconcile `eslint-config-next` with the strict flat config — use the
pre-composed overlay at `templates/tooling/next/` (four ESLint-10 / Turbopack / monorepo workarounds
pre-solved) as the repo's `eslint.config.mjs`. See `aidlc-stack-web:nextjs`.

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
- Adding a dependency? Vet it FIRST — safe · latest-stable · peer-compatible — per `aidlc:security`
  → *Dependency policy*, then pin it. The `dep-vet` hook prompts at install time; do the check then,
  not after code depends on it. Prefer what the project/stdlib already provides over a new dep.
