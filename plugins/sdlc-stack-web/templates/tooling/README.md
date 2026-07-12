# Web-stack tooling baseline

The deterministic half of the Bee-Logical quality bar. `coding-standards-ts` says *what good
looks like*; these configs make a machine **reject** most violations on every commit and in CI, so
quality doesn't depend on a reviewer noticing. `/sdlc:init` scaffolds them into a TypeScript repo
(merge-aware — it never clobbers configs you already have).

## Files

| File | Enforces |
|------|----------|
| `tsconfig.base.json` | Strict compiler flags (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, unused locals/params, …). Strictness only — extend it and set your own `module`/`target`/`lib`/`paths`. |
| `eslint.config.mjs` | Type-aware linting: `typescript-eslint` `strictTypeChecked` + `stylisticTypeChecked`, `no-explicit-any`, `consistent-type-imports`, `no-console` (warn), `eqeqeq`. Prettier owns formatting. |
| `.prettierrc.json` | Formatting (100 col, semicolons, double quotes, trailing commas). |
| `.editorconfig` | Editor defaults (LF, UTF-8, 2-space, final newline). |
| `.npmrc` | `engine-strict` + `save-exact` — deterministic installs. |
| `.gitignore` | Node + Next.js baseline. Ignores `.env*` with a `!.env.example` allow-exception (secret hygiene by default) plus `node_modules`/`dist`/`build`/`coverage`/`.next`. |
| `next/eslint.config.mjs` | **Next.js ESLint overlay** — the strict baseline pre-composed with `eslint-config-next` for ESLint 10 + Turbopack + `file:../` monorepos (four reconciliations pre-solved). Use it as a Next repo's `eslint.config.mjs`. See `next/README.md`. |

## Install (per TS repo)

```
npm i -D eslint @eslint/js typescript typescript-eslint eslint-config-prettier prettier
```

Add to `package.json`:

```jsonc
{
  "scripts": {
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "format": "prettier --check .",
    "format:write": "prettier --write ."
  }
}
```

Point your `tsconfig.json` at the baseline:

```jsonc
{ "extends": "./tsconfig.base.json", "compilerOptions": { "module": "…", "target": "…" } }
```

The `ci-cd` skill's baseline pipeline runs `typecheck` + `lint` + `format` + `test` as a **hard PR
gate**, so these can't be skipped by turning the reviewer off.

## Framework layering (don't replace, add on top)

- **Next.js** → use the pre-composed overlay **`next/eslint.config.mjs`** as the repo's
  `eslint.config.mjs` instead of the plain baseline (install `eslint-config-next`). It reconciles the
  strict shared flat config with `eslint-config-next` on ESLint 10 + Turbopack + a `file:../` monorepo
  — four workarounds pre-solved (duplicate `@typescript-eslint` plugin, `eslint-plugin-react`
  `version:"detect"` crash, plain-JS parser routing, `turbopack.root`), all preserving full lint
  coverage. Keep the repo's own `tsconfig` `module`/`moduleResolution`, extending `tsconfig.base.json`
  for strictness. **Pins:** `eslint-config-next` pinned to an ESLint-10-compatible release matching your
  Next major (`16.2.10`, peer `eslint >= 9`, verified 2026-07-12); `eslint-plugin-react` comes in
  transitively (see `next/README.md` for the pins + the "verify at adopt time" caveat and the
  `turbopack.root` snippet).
- **NestJS** → the baseline is sufficient; ensure `tsconfig` has `experimentalDecorators` +
  `emitDecoratorMetadata` for DI.

## Relaxing

Everything here is a default, not a mandate — the project config wins. If a dependency makes
`exactOptionalPropertyTypes` or a specific rule impractical, relax it *in the project config* with a
one-line comment saying why, rather than deleting the baseline.
