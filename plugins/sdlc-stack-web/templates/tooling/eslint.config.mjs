// @ts-check
// Bee-Logical SDLC — web-stack ESLint baseline (flat config, type-aware).
//
// This is the DEFAULT strict baseline scaffolded by `/sdlc:init` for a TypeScript
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

  // MUST be last — turns off rules that conflict with Prettier.
  prettier,
);
