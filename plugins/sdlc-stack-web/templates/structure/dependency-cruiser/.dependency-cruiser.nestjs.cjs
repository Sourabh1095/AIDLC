/** @type {import('dependency-cruiser').IConfiguration} */
// Bee-Logical SDLC — NestJS layering gate. `/sdlc:init` drops this as
// `.dependency-cruiser.cjs`; `sdlc:ci-cd` runs `depcruise src` in the PR gate.
// Layering: controller -> service -> repository. Features are encapsulated.
// Adjust the `^src/` paths if your repo roots elsewhere.
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Circular dependency — break the cycle; don't reach for forwardRef.",
      from: {},
      to: { circular: true },
    },
    {
      name: "controller-not-to-data",
      severity: "error",
      comment: "Controllers must delegate to a service — never import a repository or entity directly.",
      from: { path: "\\.controller\\.ts$" },
      to: { path: "(\\.repository\\.ts$|/entities/)" },
    },
    {
      name: "no-feature-to-feature-internals",
      severity: "error",
      comment: "A feature module must not import another feature's internals — use its exported service.",
      from: { path: "^src/modules/([^/]+)/" },
      to: { path: "^src/modules/([^/]+)/", pathNot: "^src/modules/$1/" },
    },
    {
      name: "common-not-to-modules",
      severity: "error",
      comment: "common/ is cross-cutting and feature-agnostic — it must not depend on modules/.",
      from: { path: "^src/common/" },
      to: { path: "^src/modules/" },
    },
    {
      name: "no-orphans",
      severity: "warn",
      comment: "Orphaned source module — likely dead code.",
      from: {
        orphan: true,
        pathNot: "\\.(spec|test|e2e-spec|d)\\.ts$|(^|/)(main|app\\.module)\\.ts$",
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true,
    includeOnly: "^src/",
  },
};
