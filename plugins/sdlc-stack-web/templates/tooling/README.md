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

- **Next.js** → also install `eslint-config-next` and include it; keep its own `tsconfig` `module`/
  `moduleResolution`, extending `tsconfig.base.json` for the strictness flags.
- **NestJS** → the baseline is sufficient; ensure `tsconfig` has `experimentalDecorators` +
  `emitDecoratorMetadata` for DI.

## Relaxing

Everything here is a default, not a mandate — the project config wins. If a dependency makes
`exactOptionalPropertyTypes` or a specific rule impractical, relax it *in the project config* with a
one-line comment saying why, rather than deleting the baseline.
