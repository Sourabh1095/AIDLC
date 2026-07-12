# Next.js tooling overlay

The `templates/tooling/` baseline (`eslint.config.mjs`, `tsconfig.base.json`, …) was validated on
plain-`tsc` backend/SDK repos. Next.js brings its own required tooling (`eslint-config-next`) and
bundler (Turbopack) that do **not** compose with the strict shared flat ESLint config out of the box
on **ESLint 10** + a `file:../` monorepo. This overlay pre-solves that, so no Next repo re-derives the
same four fixes by hand.

## Use it

For a Next.js repo, use **`eslint.config.mjs` from this folder as the repo's `eslint.config.mjs`** (it
replaces the plain baseline — it already composes the same strict baseline internally). Then:

1. Install the devDeps — the baseline plus the Next layer:
   ```
   npm i -D eslint @eslint/js typescript typescript-eslint eslint-config-prettier prettier
   npm i -D eslint-config-next   # pinned — see "Version pins" below
   ```
2. Point `tsconfig.json` at the strictness base and set Next's own module settings **locally** (the
   base is strictness-only — see `sdlc-stack-web:coding-standards-ts`):
   ```jsonc
   { "extends": "./tsconfig.base.json", "compilerOptions": { "module": "esnext", "moduleResolution": "bundler" } }
   ```
3. Apply workaround #4 in `next.config` (below).
4. Verify coverage after adopting: `npx eslint --print-config app/page.tsx` should still list the
   `@typescript-eslint/*`, `react-hooks/*`, `jsx-a11y/*` and `@next/next/*` rules, and `npx eslint .`
   should run clean. This overlay is authored to preserve full coverage; re-check per repo because
   ESLint-10 / plugin versions keep moving.

## The four reconciliations (all preserve full lint coverage)

1. **Duplicate `@typescript-eslint` plugin** — both the strict baseline and
   `eslint-config-next/typescript` register it → flat-config *"Cannot redefine plugin"*. The overlay
   spreads only `eslint-config-next/core-web-vitals` (react / react-hooks / jsx-a11y / `@next/next`)
   and lets the strict baseline own the `@typescript-eslint` plugin + parser. `strictTypeChecked` is a
   strict superset of next's TS rules, so nothing is lost.
2. **`eslint-plugin-react` `version:"detect"` crashes on ESLint 10** (it relies on the removed
   `context.getFilename()`). The overlay pins `settings.react.version` explicitly — keep it in sync
   with `react` in `package.json`.
3. **Plain `.js/.cjs/.mjs` crash when routed through the type-aware TS pipeline** on ESLint 10. The
   overlay maps them to `tseslint.configs.disableTypeChecked` after the Next layer. Reviewer-confirmed
   benign (tooling files, not app TS).
4. **`turbopack.root`** must be widened to the workspace parent so Turbopack resolves `file:../`
   sibling packages (dev-config, SDKs). Add to `next.config.*`:
   ```ts
   import path from "node:path";

   const nextConfig = {
     // Resolve file:../ sibling packages (dev-config, SDKs) from the workspace parent.
     turbopack: { root: path.join(import.meta.dirname, "..") },
   };

   export default nextConfig;
   ```
   (For a CommonJS `next.config.js`, use `path.join(__dirname, "..")`.) Ship it as-is for a `file:../`
   workspace; **revisit as the workspace matures** — a narrower root is preferable once sibling
   packages are published rather than linked.

## Version pins

Workarounds #2/#3 exist because ESLint 10 broke plugins the ecosystem hasn't fully absorbed, so the
Next-layer versions must be chosen deliberately. **Verify against the registry at adopt time — don't
trust memory** (`npm view <pkg> version peerDependencies`).

| Package | Pin | Why / verification (2026-07-12) |
|---------|-----|--------------------------------|
| `eslint-config-next` | match your Next major, ESLint-10-compatible (**`16.2.10`** for Next 16) | `npm view eslint-config-next` → latest `16.2.10`, `peerDependencies.eslint: ">=9.0.0"` (accepts ESLint 10). Brings the plugins below transitively (`eslint-plugin-react ^7.37.0`, `typescript-eslint ^8.46.0`, `eslint-plugin-react-hooks ^7.0.0`, `eslint-plugin-jsx-a11y ^6.10.0`, `@next/eslint-plugin-next 16.2.10`). |
| `eslint-plugin-react` | transitive via `eslint-config-next` (`^7.37.0` → `7.37.5`) | **No direct pin.** `7.37.5` is the latest stable and its `peerDependencies.eslint` tops out at `^9.7` — **no stable release yet declares ESLint 10**. Workaround #2 (the `react.version` pin) is precisely what makes it run under ESLint 10. `# verify at adopt time`: if a newer `eslint-plugin-react` adds native ESLint-10 support you may be able to drop the `react.version` pin. If you must pin it directly (e.g. an npm `overrides`), use `7.37.5` and keep workaround #2. |
