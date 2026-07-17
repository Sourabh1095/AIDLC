// Bee-Logical AIDLC — lint-staged baseline (pre-commit local enforcement layer).
//
// Runs on STAGED files only, so a commit is auto-fixed + format-clean before it lands — the
// local complement to the CI/merge gate (which enforces the same standards repo-wide). eslint
// --fix first, prettier --write last so the formatter owns final formatting.
//
// Poly note: the shared-config repo can own this preset and the others re-export it:
//   // consumer lint-staged.config.mjs
//   export { default } from "@beelogical/dev-config/lint-staged";
// (an `exports`-map subpath — the depcruise profiles set enhancedResolveOptions so that resolves.)
export default {
  "*.{ts,tsx,js,cjs,mjs}": ["eslint --fix", "prettier --write"],
  "*.{json,jsonc,md,yml,yaml,css,scss,html}": ["prettier --write"],
};
