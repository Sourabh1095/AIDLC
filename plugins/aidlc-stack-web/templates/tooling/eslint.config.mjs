// @ts-check
// Bee-Logical AIDLC — web-stack ESLint baseline (flat config, type-aware).
//
// This is the DEFAULT strict baseline scaffolded by `/aidlc:init` for a TypeScript
// repo. The project's own rules win where they disagree — edit freely afterwards.
// Prettier owns formatting: `eslint-config-prettier` is applied last to switch off
// any stylistic rules that would fight the formatter.
//
// devDependencies required:
//   eslint  @eslint/js  typescript  typescript-eslint  eslint-config-prettier
// Framework layers (add on top, don't replace):
//   Next.js → `eslint-config-next`;  Nest → this baseline is enough.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["dist/**", "build/**", ".next/**", "coverage/**", "node_modules/**"] },

  js.configs.recommended,
  // Typed linting — the strict, type-checked rule sets (require tsconfig via projectService).
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        // Auto-discovers the nearest tsconfig for each file (typescript-eslint ≥ 8).
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Reinforced from coding-standards-ts (the ones worth stating explicitly):
      "no-console": ["warn", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "smart"],
      "@typescript-eslint/consistent-type-imports": "error",
      // A justified `any` still needs a `// why:` line — keep it loud, not silent.
      "@typescript-eslint/no-explicit-any": "error",
    },
  },

  // Config files and plain JS: keep them lintable but drop type-aware rules.
  {
    files: ["**/*.{js,cjs,mjs}"],
    extends: [tseslint.configs.disableTypeChecked],
  },

  // CommonJS files (e.g. `.dependency-cruiser.cjs`, `*.config.cjs`, `commitlint.config.cjs`)
  // inside an otherwise ESM/TS repo. Without this block the baseline can't lint its own shipped
  // `.cjs` configs: `no-undef` fires on `module`/`require`/`exports`/`__dirname`, and
  // `@typescript-eslint/no-require-imports` (NOT cleared by disableTypeChecked — it isn't
  // type-aware) fires on `require()`. Declare the CommonJS module system + Node globals and
  // switch the require-style rules off for `.cjs` only; `.mjs`/`.js` stay as they are above.
  {
    files: ["**/*.cjs"],
    languageOptions: {
      // `commonjs` auto-provides module/exports/require/__dirname/__filename; add the rest.
      sourceType: "commonjs",
      globals: {
        module: "readonly",
        require: "readonly",
        exports: "writable",
        __dirname: "readonly",
        __filename: "readonly",
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        global: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-var-requires": "off",
    },
  },

  // MUST be last — turns off rules that conflict with Prettier.
  prettier,
);
