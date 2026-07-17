// @ts-check
// Bee-Logical AIDLC — Next.js ESLint overlay (flat config; ESLint 10 + Turbopack).
//
// Use THIS file as a Next.js repo's `eslint.config.mjs` INSTEAD of the plain
// `templates/tooling/eslint.config.mjs` baseline. It composes the SAME strict
// shared baseline (typescript-eslint strictTypeChecked + stylistic + Prettier) with
// `eslint-config-next`, pre-solving the FOUR reconciliations that composing a strict
// shared flat config with eslint-config-next needs on ESLint 10 + Turbopack + a
// `file:../` monorepo. All four preserve full lint coverage (109 @typescript-eslint
// rules + react-hooks + jsx-a11y + @next/next all stay active). See ./README.md for
// the version pins and the workaround-#4 next.config snippet.
//
// devDependencies (baseline + Next layer):
//   eslint  @eslint/js  typescript  typescript-eslint  eslint-config-prettier  prettier
//   eslint-config-next   # pin an ESLint-10-compatible release matching your Next major
//                        # (16.2.10 verified 2026-07-12; peerDep eslint >= 9). It brings
//                        # eslint-plugin-react (^7.37.0) transitively — see README.
//
// If you consume the baseline as the published `@beelogical/dev-config` package,
// import its re-exported config instead of re-listing js/tseslint/prettier here.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
// eslint-config-next ships native flat-config entry points (v15+).
import nextVitals from "eslint-config-next/core-web-vitals";

// Keep in sync with `react` in package.json (19.2.7 as of 2026-07-12). Workaround #2:
// pinning this AVOIDS eslint-plugin-react's `version:"detect"` code path, which calls
// the removed `context.getFilename()` and crashes on ESLint 10.
const REACT_VERSION = "19.2.7";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "build/**",
      ".next/**",
      "out/**",
      "coverage/**",
      "node_modules/**",
      "next-env.d.ts",
    ],
  },

  js.configs.recommended,

  // Next.js layer FIRST: react (+ recommended), react-hooks, jsx-a11y, @next/next
  // (Core Web Vitals promoted to errors). We spread ONLY `core-web-vitals`, NOT
  // `eslint-config-next/typescript` — that separate export re-registers the
  // `@typescript-eslint` plugin, which collides with the strict baseline below
  // ("Cannot redefine plugin"). Omitting it is workaround #1: strictTypeChecked is a
  // strict superset of next's TS rules, so no coverage is lost. It goes first so the
  // type-aware parser set below overrides next's babel parser for .ts/.tsx.
  ...nextVitals,

  // Strict, type-checked baseline — registers `@typescript-eslint` + tseslint.parser.
  // Placed AFTER nextVitals so tseslint.parser wins for TS files (the "keep the parser
  // override" half of workaround #1).
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        // Type-aware linting: auto-discovers the nearest tsconfig per file. Wins over
        // next's babel parser for .ts/.tsx because this block is last to touch them.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Reinforced from coding-standards-ts (see the plain baseline):
      "no-console": ["warn", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "smart"],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-explicit-any": "error",
    },
  },

  // Workaround #2: pin the React version so eslint-plugin-react never runs its
  // ESLint-10-incompatible auto-detect.
  { settings: { react: { version: REACT_VERSION } } },

  // Workaround #3: plain JS/CJS/MJS (config files, scripts) must NOT go through the
  // type-aware TS pipeline — routing them there crashes under ESLint 10. Map them
  // explicitly to the non-type-checked ruleset, AFTER the layers above so this wins.
  // Reviewer-confirmed benign — these are tooling files, not app TS, so nothing is lost.
  {
    files: ["**/*.{js,cjs,mjs}"],
    extends: [tseslint.configs.disableTypeChecked],
  },

  // MUST be last — turns off rules that conflict with Prettier.
  prettier,
);
