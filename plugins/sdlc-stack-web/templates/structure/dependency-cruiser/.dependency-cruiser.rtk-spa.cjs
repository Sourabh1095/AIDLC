/** @type {import('dependency-cruiser').IConfiguration} */
// Bee-Logical SDLC — RTK-Query SPA layering gate. `/sdlc:init` drops this as
// `.dependency-cruiser.cjs`; `sdlc:ci-cd` runs `depcruise src` in the PR gate.
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Circular dependency — break the cycle.",
      from: {},
      to: { circular: true },
    },
    {
      name: "ui-not-to-store",
      severity: "error",
      comment: "components/ui are presentational — they take props, never import the store.",
      from: { path: "^src/components/ui/" },
      to: { path: "^src/store/" },
    },
    {
      name: "ui-not-to-features",
      severity: "error",
      comment: "ui primitives must not depend on feature components.",
      from: { path: "^src/components/ui/" },
      to: { path: "^src/components/features/" },
    },
    {
      name: "no-feature-to-feature-internals",
      severity: "error",
      comment: "A feature must not reach into another feature's internals.",
      from: { path: "^src/components/features/([^/]+)/" },
      to: { path: "^src/components/features/([^/]+)/", pathNot: "^src/components/features/$1/" },
    },
    {
      name: "components-not-to-services",
      severity: "error",
      comment:
        "Components reach the network through RTK Query (store/api) or a hook — not raw services/.",
      from: { path: "^src/components/" },
      to: { path: "^src/services/" },
    },
    {
      name: "lib-types-are-leaves",
      severity: "error",
      comment:
        "lib/ and types/ are framework-agnostic leaves — no imports from routes/components/store.",
      from: { path: "^src/(lib|types)/" },
      to: { path: "^src/(routes|pages|components|store)/" },
    },
    {
      name: "no-orphans",
      severity: "warn",
      comment: "Orphaned source module — likely dead code.",
      from: { orphan: true, pathNot: "\\.(spec|test|d)\\.tsx?$|(^|/)(main|app)\\.tsx?$" },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true,
    includeOnly: "^src/",
    // Resolve ESM `exports`-map subpaths explicitly — the poly shared-config pattern this plugin
    // promotes (`@beelogical/dev-config/lint-staged`). enhanced-resolve's `exports`-map handling
    // varies by version/package shape (older defaults don't follow subpath maps at all); setting
    // these pins subpath resolution across both import/require conditions so a shared-config
    // subpath isn't false-flagged as unresolvable. Requires dependency-cruiser >= 17 (see the
    // devDep floor in project-structure) — harmless where the default already resolves it.
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require"],
      mainFields: ["main", "module", "types"],
    },
  },
};
