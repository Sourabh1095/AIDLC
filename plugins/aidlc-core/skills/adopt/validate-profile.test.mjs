// Regression tests for validate-profile.mjs. Run: `node validate-profile.test.mjs`
// (tests the sibling validate-profile.mjs) or `node validate-profile.test.mjs <path>`.
//
// Two jobs:
//   1. REFERENCE — a profile of a deliberately nasty workspace must validate clean. It is the
//      proof that the hard shapes from the spec's scenario matrix are actually REPRESENTABLE:
//      a multi-root .code-workspace spanning two drives, a monorepo root beside single-app
//      roots, a UNC path with spaces that is unreachable, a zip drop with no VCS, a Mercurial
//      checkout, a polyglot monorepo, an absent test gate, an unsupported tracker.
//   2. MUTATIONS — each breaks exactly one invariant and must be caught with the right message.
//      A validator that only ever says OK is worth nothing.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as V from "./validate-profile.mjs";

const VALIDATOR = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), "validate-profile.mjs");
const HERE = dirname(fileURLToPath(import.meta.url));
const work = mkdtempSync(join(tmpdir(), "adopt-profile-"));

const pathEv = (p, line, excerpt) => ({ kind: "path", path: p, ...(line ? { line } : {}), ...(excerpt ? { excerpt } : {}) });
const cmdEv = (command, output) => ({ kind: "command", command, output });
const absEv = (note) => ({ kind: "absence", note });
const known = (value, evidence, confidence = "high") => ({ status: "known", value, evidence, confidence });
const absent = (note) => ({ status: "absent", evidence: [absEv(note)] });
const unknown = (reason) => ({ status: "unknown", reason });

// ===== the reference profile =====
const reference = () => ({
  $schema: "https://raw.githubusercontent.com/bee-logical/AIDLC/main/docs/adoption-profile.schema.json",
  profileVersion: 1,
  scan: {
    scannedAt: "2026-07-30T09:15:00Z",
    aidlcVersion: "0.30.0",
    depth: "standard",
    commit: known("4f2a9c1", [cmdEv('git -C "D:/ws" rev-parse HEAD', "4f2a9c1")]),
    controlPlane: {
      path: "D:\\ws",
      resolvedFrom: "code-workspace-file",
      evidence: [pathEv("D:\\ws\\acme.code-workspace", 1)],
      isWorkspaceRoot: true,
      alreadyAdopted: false,
    },
    budget: {
      filesInspected: 812,
      directoriesInspected: 190,
      durationSeconds: 47.5,
      caps: { maxFiles: 5000, maxFileBytes: 262144, maxDepth: 6, maxAdrCandidates: 8, maxDebtFindings: 20, hitCap: false },
    },
    skipped: [
      { path: "D:\\ws\\api\\node_modules", reason: "vendored" },
      { path: "C:\\src\\platform\\dist", reason: "build-output" },
      { path: "D:\\ws\\api\\.env", reason: "env-file", note: "recorded by path only; never read" },
      { path: "D:\\ws\\api\\seed\\customers.csv", reason: "pii-suspect" },
      { path: "C:\\src\\platform\\assets\\hero.psd", reason: "lfs-pointer" },
    ],
    sampling: { applied: true, strategy: "all manifests + config + entry points, then breadth-first across src/", coveragePercent: 62.4 },
    writes: { paths: [".aidlc/adoption/profile.json", ".aidlc/adoption/report.md"], sessionOnly: false },
    network: { sourceTransmitted: false, hostApiCalls: [], offline: true },
  },
  workspace: {
    shape: known("multi-root", [pathEv("D:\\ws\\acme.code-workspace", 2)]),
    codeWorkspaceFile: known("D:\\ws\\acme.code-workspace", [pathEv("D:\\ws\\acme.code-workspace", 1)]),
    topology: known("poly", [
      cmdEv("ls -d */.git", "api/.git"),
      pathEv("D:\\ws\\acme.code-workspace", 2),
    ]),
    roots: [
      {
        name: "api",
        path: "api",
        absolutePath: "D:\\ws\\api",
        nestedUnderControlPlane: true,
        declaredBy: "code-workspace",
        classification: known("product-repo", [pathEv("D:\\ws\\api\\.git", 1), pathEv("D:\\ws\\api\\package.json", 2)]),
        reachable: { value: true },
        trust: { trusted: known(true, [pathEv("D:\\ws\\api\\.claude\\settings.json", 1)]), pluginEnabled: unknown("harness trust state is not readable from inside the session; symptom = /aidlc:sprint exits rc=0 with Unknown command, fix = open Claude Code here once") },
        vcs: {
          system: known("git", [cmdEv('git -C "D:/ws/api" rev-parse --is-inside-work-tree', "true")]),
          support: "supported",
          defaultBranch: known("main", [cmdEv('git -C "D:/ws/api" rev-parse --abbrev-ref origin/HEAD', "origin/main")]),
          remotes: known([{ name: "origin", url: "https://github.com/acme/api.git" }], [cmdEv('git -C "D:/ws/api" remote -v', "origin https://github.com/acme/api.git (fetch)")]),
          shallow: known(false, [cmdEv('git -C "D:/ws/api" rev-parse --is-shallow-repository', "false")]),
          submodules: absent("git submodule status returned nothing"),
          worktrees: known(["D:\\ws\\api"], [cmdEv('git -C "D:/ws/api" worktree list', "D:/ws/api  4f2a9c1 [main]")]),
          lfs: absent("git lfs env reports no LFS configuration"),
        },
        languages: [{ name: "TypeScript", version: "5.6", paths: ["src/"], evidence: [pathEv("D:\\ws\\api\\package.json", 18)], confidence: "high", support: "supported" }],
        packageManagers: [{ name: "pnpm", paths: ["."], evidence: [pathEv("D:\\ws\\api\\pnpm-lock.yaml", 1)], confidence: "high" }],
        frameworks: [{ name: "NestJS", version: "10", paths: ["src/"], evidence: [pathEv("D:\\ws\\api\\package.json", 22)], confidence: "high", support: "supported" }],
        ci: [{ name: "GitHub Actions", paths: [".github/workflows/ci.yml"], evidence: [pathEv("D:\\ws\\api\\.github\\workflows\\ci.yml", 1)], confidence: "high", support: "supported" }],
        hooks: [{ name: "husky", paths: [".husky/pre-commit"], evidence: [pathEv("D:\\ws\\api\\.husky\\pre-commit", 1)], confidence: "high" }],
        migrationTools: [{ name: "Prisma", paths: ["prisma/migrations"], evidence: [pathEv("D:\\ws\\api\\prisma\\schema.prisma", 1)], confidence: "high", support: "supported" }],
        containers: [{ name: "docker compose", paths: ["compose.yml"], evidence: [pathEv("D:\\ws\\api\\compose.yml", 1)], confidence: "high" }],
        entryPoints: {
          install: known({ cmd: "pnpm install --frozen-lockfile", source: "pnpm-lock.yaml present" }, [pathEv("D:\\ws\\api\\pnpm-lock.yaml", 1)]),
          test: known({ cmd: "pnpm test", source: "package.json scripts.test", environmentDependent: true }, [pathEv("D:\\ws\\api\\package.json", 9)]),
          lint: known({ cmd: "pnpm lint", source: "package.json scripts.lint" }, [pathEv("D:\\ws\\api\\package.json", 10)]),
          typecheck: known({ cmd: "pnpm typecheck", source: "package.json scripts.typecheck" }, [pathEv("D:\\ws\\api\\package.json", 11)]),
          format: absent("no format or prettier script in package.json scripts, and no .prettierrc*"),
        },
        coverage: { filesInspected: 240, sampled: false, coveragePercent: 100 },
        // ordered gate proposal: the project's own commands, with the hole named
        gates: [
          { name: "lint", status: "present", cmd: "pnpm lint", source: "package.json scripts.lint", required: true, scope: "repo", providedByHook: "husky", alsoInCi: true, evidence: [pathEv("D:\\ws\\api\\package.json", 10)], confidence: "high" },
          { name: "typecheck", status: "present", cmd: "pnpm typecheck", source: "package.json scripts.typecheck", required: true, scope: "repo", alsoInCi: true, evidence: [pathEv("D:\\ws\\api\\package.json", 11)], confidence: "high" },
          { name: "test", status: "present", cmd: "pnpm test", source: "package.json scripts.test", required: true, scope: "repo", timeoutMinutes: 20, environmentDependent: true, services: ["postgres", "redis"], alsoInCi: true, evidence: [pathEv("D:\\ws\\api\\package.json", 9), pathEv("D:\\ws\\api\\compose.yml", 3)], confidence: "high" },
          { name: "format", status: "absent", required: false, scope: "repo", source: "none", evidence: [absEv("no format/prettier script in package.json scripts and no .prettierrc*")], confidence: "high" },
        ],
        conventions: {
          branchPattern: known("{type}/{id}-{slug}", [cmdEv('git -C "D:/ws/api" for-each-ref --format=%(refname:short) refs/heads', "feature/ACME-31-avatar\nbugfix/ACME-28-null-guard")], "medium"),
          commitStyle: known("conventional", [cmdEv('git -C "D:/ws/api" log -30 --format=%s', "feat(api): add avatar upload\nfix(api): guard null tenant")], "high"),
          mergeStrategy: known("squash", [cmdEv('git -C "D:/ws/api" log --merges -20 --oneline main', "")], "medium"),
          longLivedBranches: known(["main"], [cmdEv('git -C "D:/ws/api" for-each-ref refs/heads', "refs/heads/main")]),
          codeowners: known({ path: ".github/CODEOWNERS", entryCount: 4 }, [pathEv("D:\\ws\\api\\.github\\CODEOWNERS", 1)]),
          requiredReviewers: unknown("the host API was not reachable on this run (offline), so branch policy could not be read — this is not evidence that none is configured"),
          protectedBranches: unknown("same offline host API; unknown is not 'unprotected'"),
          pushAccess: known("direct", [cmdEv('git -C "D:/ws/api" remote -v', "origin https://github.com/acme/api.git (push)")], "medium"),
        },
        // ADOPT-9: the runtime constraints. Shared-schema multi-tenancy + a migration tool means
        // expand/contract is answered, and every auth/isolation/billing path reaches the seeds.
        saas: {
          tenancy: known("shared-schema", [
            pathEv("D:\\ws\\api\\prisma\\schema.prisma", 22, "tenantId String @map(\"tenant_id\")"),
            pathEv("D:\\ws\\api\\src\\common\\tenant.middleware.ts", 14),
          ], "high"),
          tenantKey: known("tenant_id", [pathEv("D:\\ws\\api\\prisma\\schema.prisma", 22)], "high"),
          tenantIsolationPaths: known(["src/common/tenant.middleware.ts", "prisma/rls/"], [pathEv("D:\\ws\\api\\src\\common\\tenant.middleware.ts", 1)], "high"),
          authPaths: known(["src/auth/"], [pathEv("D:\\ws\\api\\src\\auth\\jwt.strategy.ts", 1)], "high"),
          billingPaths: known(["src/billing/"], [pathEv("D:\\ws\\api\\src\\billing\\subscription.service.ts", 1)], "medium"),
          featureFlags: known({ provider: "LaunchDarkly", paths: ["src/flags/"] }, [pathEv("D:\\ws\\api\\package.json", 31, "\"launchdarkly-node-server-sdk\": \"^9\"")], "high"),
          migrations: known({ tool: "Prisma", directory: "prisma/migrations" }, [pathEv("D:\\ws\\api\\prisma\\schema.prisma", 1)], "high"),
          liveDataConstraint: known("expand-contract", [
            pathEv("D:\\ws\\api\\prisma\\schema.prisma", 22),
            cmdEv("ls prisma/migrations", "20250114_add_tenant_id/\n20250220_backfill_tenant_id/"),
          ], "medium"),
          apiContracts: known([
            { kind: "openapi", path: "openapi/public-v1.yaml", public: true },
            { kind: "graphql", path: "src/schema.graphql", public: false },
          ], [pathEv("D:\\ws\\api\\openapi\\public-v1.yaml", 1)], "high"),
          environments: known([
            { name: "staging", kind: "staging" },
            { name: "production", kind: "production" },
            { name: "pr-preview", kind: "preview" },
          ], [pathEv("D:\\ws\\api\\.github\\workflows\\deploy.yml", 12)], "high"),
          deployStrategy: known("canary", [pathEv("D:\\ws\\api\\.github\\workflows\\deploy.yml", 41, "strategy: canary")], "medium"),
          freezeWindows: known([{ when: "Fri 16:00 → Mon 09:00 UTC", source: ".github/workflows/deploy.yml:8 schedule guard" }], [pathEv("D:\\ws\\api\\.github\\workflows\\deploy.yml", 8)], "medium"),
          compliance: known([{ regime: "soc2", signal: "docs/security/soc2-controls.md lists CC6 evidence owners" }], [pathEv("D:\\ws\\api\\docs\\security\\soc2-controls.md", 3)], "medium"),
          messaging: known([{ name: "BullMQ", kind: "queue", paths: ["src/jobs/"] }], [pathEv("D:\\ws\\api\\package.json", 33)], "high"),
          observability: known([{ name: "Sentry", paths: ["src/main.ts"] }], [pathEv("D:\\ws\\api\\src\\main.ts", 9)], "high"),
          integrations: known([{ name: "Stripe", paths: ["src/billing/stripe.client.ts"] }], [pathEv("D:\\ws\\api\\src\\billing\\stripe.client.ts", 1)], "high"),
          experimentation: unknown("no A/B or analytics-rollout library in package.json, and no experiment config directory"),
          securityReviewPathSeeds: [
            "src/common/tenant.middleware.ts", "prisma/rls/", "src/auth/", "src/billing/",
            "prisma/migrations/",
          ],
        },
      },
      {
        // monorepo root, on ANOTHER DRIVE, beside single-app roots — the hybrid shape.
        name: "platform",
        path: "C:\\src\\platform",
        absolutePath: "C:\\src\\platform",
        nestedUnderControlPlane: false,
        declaredBy: "code-workspace",
        classification: known("monorepo", [pathEv("C:\\src\\platform\\pnpm-workspace.yaml", 1), pathEv("C:\\src\\platform\\turbo.json", 1)]),
        reachable: { value: true },
        vcs: {
          system: known("git", [cmdEv('git -C "C:/src/platform" rev-parse --is-inside-work-tree', "true")]),
          support: "supported",
          defaultBranch: known("main", [cmdEv('git -C "C:/src/platform" rev-parse --abbrev-ref origin/HEAD', "origin/main")]),
          shallow: known(true, [cmdEv('git -C "C:/src/platform" rev-parse --is-shallow-repository', "true")]),
          submodules: known(["third_party/protos"], [cmdEv('git -C "C:/src/platform" submodule status', "-a1b2c3 third_party/protos")]),
          upstream: known("https://github.com/acme-oss/platform.git", [cmdEv('git -C "C:/src/platform" remote -v', "upstream https://github.com/acme-oss/platform.git (fetch)")]),
        },
        // polyglot: all languages listed with the paths that carry each
        languages: [
          { name: "TypeScript", paths: ["packages/web", "packages/shared"], evidence: [pathEv("C:\\src\\platform\\packages\\web\\package.json", 1)], confidence: "high", support: "supported" },
          { name: "Python", version: "3.12", paths: ["packages/worker"], evidence: [pathEv("C:\\src\\platform\\packages\\worker\\pyproject.toml", 4)], confidence: "high", support: "partial" },
        ],
        workspaceTooling: known({ tool: "turborepo", affectedGraph: true }, [pathEv("C:\\src\\platform\\turbo.json", 1)]),
        entryPoints: {
          test: known({ cmd: "pnpm turbo run test --filter=...[origin/develop]", source: "turbo.json pipeline.test" }, [pathEv("C:\\src\\platform\\turbo.json", 8)]),
          typecheck: unknown("turbo.json declares no typecheck task and no package defines one; a per-package tsconfig exists but nothing invokes tsc"),
        },
        // ADOPT-8: the package dimension — per-package stack, an internal dependency edge that
        // sequences cross-package work, and only the packages the tooling can actually publish.
        packages: [
          { name: "@acme/shared", path: "packages/shared", role: "shared TypeScript types and API client", labels: ["shared"], languages: ["TypeScript"], stack: { frontend: null, backend: "TypeScript library", databases: [] }, releasable: true, evidence: [pathEv("C:\\src\\platform\\packages\\shared\\package.json", 2)] },
          { name: "@acme/web", path: "packages/web", role: "customer-facing Next.js app", labels: ["web", "frontend"], languages: ["TypeScript"], stack: { frontend: "Next.js 15", backend: null, databases: [] }, dependsOn: ["@acme/shared"], releasable: false, evidence: [pathEv("C:\\src\\platform\\packages\\web\\package.json", 2)] },
          { name: "acme-worker", path: "packages/worker", role: "Celery worker for async billing jobs", labels: ["worker", "python"], languages: ["Python"], stack: { frontend: null, backend: "Python 3.12 / Celery", databases: ["postgres"] }, releasable: false, evidence: [pathEv("C:\\src\\platform\\packages\\worker\\pyproject.toml", 2)] },
        ],
        releaseTooling: known({ tool: "changesets", independentVersioning: true }, [pathEv("C:\\src\\platform\\.changeset\\config.json", 1)], "high"),
        agentConfigs: [{ path: "C:\\src\\platform\\AGENTS.md", tool: "generic", humanAuthored: true }],
        docs: [{ location: "https://acme.atlassian.net/wiki/spaces/PLAT", kind: "wiki", external: true }],
        coverage: { filesInspected: 410, sampled: true, coveragePercent: 48.2 },
        // affected-graph runner ⇒ the per-item gate runs affected targets only; plus a per-package gate
        gates: [
          { name: "test", status: "present", cmd: "pnpm turbo run test --filter=...[origin/main]", source: "turbo.json tasks.test", required: true, scope: "affected", alsoInCi: true, evidence: [pathEv("C:\\src\\platform\\turbo.json", 8)], confidence: "high" },
          { name: "lint", status: "present", cmd: "pnpm turbo run lint --filter=...[origin/main]", source: "turbo.json tasks.lint", required: true, scope: "affected", evidence: [pathEv("C:\\src\\platform\\turbo.json", 12)], confidence: "high" },
          { name: "test", status: "present", cmd: "uv run pytest", cwd: "packages/worker", source: "packages/worker/pyproject.toml [tool.pytest]", required: true, scope: "package", package: "acme-worker", evidence: [pathEv("C:\\src\\platform\\packages\\worker\\pyproject.toml", 18)], confidence: "high" },
          { name: "typecheck", status: "absent", required: false, scope: "affected", source: "none", evidence: [absEv("turbo.json declares no typecheck task and no package defines one")], confidence: "high" },
        ],
        conventions: {
          // GitFlow: feature work targets develop, NOT the default branch
          integrationBranch: known("develop", [cmdEv('git -C "C:/src/platform" for-each-ref refs/heads', "refs/heads/develop\nrefs/heads/main")], "high"),
          longLivedBranches: known(["main", "develop", "release/*"], [cmdEv('git -C "C:/src/platform" for-each-ref --format=%(refname:short) refs/heads', "develop\nmain\nrelease/2026.07")]),
          hotfixRoute: known("hotfix/* cut from the latest release tag, merged to both main and develop", [cmdEv('git -C "C:/src/platform" for-each-ref refs/heads', "refs/heads/hotfix/2026.07.1")], "medium"),
          commitStyle: known("mixed", [cmdEv('git -C "C:/src/platform" log -30 --format=%s', "feat(web): ...\nPLAT-88 tidy worker\nfix typo")], "high"),
          mergeStrategy: known("merge", [cmdEv('git -C "C:/src/platform" log --merges -20 --oneline develop', "b21ce9f Merge pull request #412")], "high"),
          pushAccess: known("fork-only", [cmdEv("gh api repos/acme-oss/platform --jq .permissions.push", "false")], "high"),
        },
      },
      {
        name: "docs",
        path: "docs",
        absolutePath: "D:\\ws\\docs",
        nestedUnderControlPlane: true,
        declaredBy: "folder-scan",
        classification: known("non-repo", [absEv("no .git, .hg or .svn under D:\\ws\\docs; contents are .md only")]),
        reachable: { value: true },
      },
      {
        name: "vendor-sdk",
        path: "vendor-sdk",
        absolutePath: "D:\\ws\\vendor-sdk",
        nestedUnderControlPlane: true,
        declaredBy: "folder-scan",
        classification: known("reference-only", [cmdEv('git -C "D:/ws/vendor-sdk" remote -v', "origin https://github.com/stripe/stripe-node.git (fetch)")], "medium"),
        reachable: { value: true },
      },
      {
        // UNC path WITH SPACES, and unreachable — must name its remedy
        name: "legacy-billing",
        path: "\\\\fileserver\\share\\legacy billing",
        absolutePath: "\\\\fileserver\\share\\legacy billing",
        nestedUnderControlPlane: false,
        declaredBy: "code-workspace",
        classification: unknown("root is declared in acme.code-workspace but could not be read, so nothing about it was established"),
        reachable: {
          value: false,
          remedy: '/add-dir "\\\\fileserver\\share\\legacy billing" in-session, or restart with --add-dir "\\\\fileserver\\share\\legacy billing"',
        },
      },
      {
        // zip drop: no VCS at all, and no test gate
        name: "dropzone",
        path: "dropzone",
        absolutePath: "D:\\ws\\dropzone",
        nestedUnderControlPlane: true,
        declaredBy: "folder-scan",
        classification: known("product-repo", [pathEv("D:\\ws\\dropzone\\pom.xml", 1)], "medium"),
        reachable: { value: true },
        vcs: {
          system: known("none", [absEv("no .git, .hg, .svn, .p4config or $tf marker anywhere under D:\\ws\\dropzone")]),
          support: "unsupported",
        },
        languages: [{ name: "Java", version: "17", paths: ["src/main/java"], evidence: [pathEv("D:\\ws\\dropzone\\pom.xml", 14)], confidence: "high", support: "partial" }],
        entryPoints: {
          build: known({ cmd: "mvn -B package", source: "pom.xml packaging jar" }, [pathEv("D:\\ws\\dropzone\\pom.xml", 8)]),
          test: absent("pom.xml declares no surefire/junit dependency and there is no src/test tree"),
          lint: absent("no checkstyle, spotbugs or pmd plugin in pom.xml"),
        },
      },
      {
        name: "payments-hg",
        path: "payments-hg",
        absolutePath: "D:\\ws\\payments-hg",
        nestedUnderControlPlane: true,
        declaredBy: "folder-scan",
        classification: known("product-repo", [pathEv("D:\\ws\\payments-hg\\Gemfile", 1)], "medium"),
        reachable: { value: true },
        vcs: { system: known("mercurial", [pathEv("D:\\ws\\payments-hg\\.hg", 1)]), support: "unsupported" },
        languages: [{ name: "Ruby", paths: ["app/"], evidence: [pathEv("D:\\ws\\payments-hg\\Gemfile", 1)], confidence: "high", support: "partial" }],
        entryPoints: { test: known({ cmd: "bundle exec rspec", source: "Gemfile rspec-rails dependency" }, [pathEv("D:\\ws\\payments-hg\\Gemfile", 12)]) },
      },
    ],
  },
  surfaces: [
    { kind: "stack", detected: "TypeScript / NestJS / Next.js", root: "api", support: "supported", providedBy: "aidlc-stack-web", consequence: "full coding standards, structure and CI guidance apply.", evidence: [pathEv("D:\\ws\\api\\package.json", 22)] },
    { kind: "stack", detected: "Python 3.12 / Celery", root: "platform", support: "partial", consequence: "the pipeline runs, but no Python stack skill exists — standards and structure guidance fall back to the language-agnostic core.", evidence: [pathEv("C:\\src\\platform\\packages\\worker\\pyproject.toml", 4)] },
    { kind: "stack", detected: "Java 17 / Maven", root: "dropzone", support: "partial", consequence: "core pipeline only; Maven goals are detected as gates but no Java stack skill exists." },
    { kind: "tracker", detected: "GitHub Issues", support: "unsupported", consequence: "no adapter exists, so the board cannot be read or written — the markdown backlog is offered instead, which is local-only and invisible to teammates outside the repo.", evidence: [pathEv("D:\\ws\\api\\.github\\ISSUE_TEMPLATE\\bug.yml", 1)] },
    { kind: "vcs", detected: "Mercurial", root: "payments-hg", support: "unsupported", consequence: "no branch/commit/PR automation is possible in this root; the pipeline can read and profile it but cannot deliver into it." },
    { kind: "vcs", detected: "no version control", root: "dropzone", support: "unsupported", consequence: "nothing can be branched, committed or reverted here until it is a repo." },
    { kind: "ci", detected: "GitHub Actions", root: "api", support: "supported", providedBy: "aidlc:ci-cd", consequence: "the local gate can be reconciled against the CI gate." },
    { kind: "hooks", detected: "husky + lint-staged", root: "api", support: "supported", consequence: "already present — the AIDLC pre-commit layer must not be installed on top of it." },
  ],
  gaps: [
    { name: "aidlc-stack-python", kind: "plugin", surface: "Python 3.12 / Celery", why: "no Python standards, structure or gate expertise is installed.", workaround: "language-agnostic core plus the detected pytest/ruff entry points." },
    { name: "aidlc-stack-java", kind: "plugin", surface: "Java 17 / Maven", why: "no Java/Maven expertise is installed.", workaround: "core pipeline with detected Maven goals as gates." },
    { name: "wi-github-issues", kind: "adapter", surface: "GitHub Issues", why: "the tracker in use has no adapter.", workaround: "markdown backlog (local-only)." },
    { name: "vcs-mercurial", kind: "project-action", surface: "Mercurial", why: "the pipeline's git-workflow layer cannot operate on a Mercurial checkout.", workaround: "profile and report only; delivery into this root stays manual." },
    { name: "git-init-dropzone", kind: "project-action", surface: "no version control", why: "the root has no VCS, so no AIDLC delivery step can run there.", workaround: "run git init in D:\\ws\\dropzone, then re-scan." },
  ],
  // ADOPT-10: decisions the code embeds with nothing recording them. Ranked highest reversibility
  // cost first, no rationale anywhere, and the one already covered is listed rather than dropped.
  adrCandidates: [
    {
      decisionKind: "tenancy-model",
      title: "Isolate tenants in one shared Postgres schema keyed by tenant_id",
      status: "propose",
      reversibilityCost: "high",
      root: "api",
      decidedAt: unknown("the pattern predates the oldest commit in this shallow clone, so no introducing commit can be cited"),
      consequencesObserved: [
        "every repository query filters by tenantId; 3 of 11 do it by hand rather than through the base repository",
        "a missing filter is a cross-tenant read, not a failed test",
      ],
      evidence: [pathEv("D:\\ws\\api\\prisma\\schema.prisma", 22), pathEv("D:\\ws\\api\\src\\common\\tenant.middleware.ts", 14)],
    },
    {
      decisionKind: "api-style",
      title: "Expose a versioned public REST API described by openapi/public-v1.yaml",
      status: "propose",
      reversibilityCost: "high",
      root: "api",
      decidedAt: known("2025-03-11", [cmdEv('git -C "D:/ws/api" log -1 --format=%ad -- openapi/public-v1.yaml', "2025-03-11")], "medium"),
      evidence: [pathEv("D:\\ws\\api\\openapi\\public-v1.yaml", 1)],
    },
    {
      decisionKind: "data-store",
      title: "Use Postgres via Prisma as the single system of record",
      status: "propose",
      reversibilityCost: "medium",
      root: "api",
      evidence: [pathEv("D:\\ws\\api\\prisma\\schema.prisma", 1), pathEv("D:\\ws\\api\\package.json", 24)],
    },
    {
      decisionKind: "build-tooling",
      title: "Drive the monorepo with pnpm workspaces plus Turborepo task orchestration",
      status: "propose",
      reversibilityCost: "low",
      root: "platform",
      evidence: [pathEv("C:\\src\\platform\\turbo.json", 1), pathEv("C:\\src\\platform\\pnpm-workspace.yaml", 1)],
    },
    {
      // already recorded — listed, not proposed, so a re-run's silence is legible
      decisionKind: "framework",
      title: "Build the API on NestJS",
      status: "already-recorded",
      existingAdr: "https://acme.atlassian.net/wiki/spaces/PLAT/pages/nestjs",
      reversibilityCost: "medium",
      root: "api",
      evidence: [pathEv("D:\\ws\\api\\package.json", 22)],
    },
  ],
  // ADOPT-11 — what the scan found that is WORK, ranked by severity, capped. Two entries are
  // `sensitive`: naming their location IS the disclosure, so they carry a tracker-safe title and no
  // paths, and the specifics stay in the report, which stays in the repo.
  debtFindings: [
    {
      kind: "committed-secret",
      severity: "high",
      title: "Rotate the credential committed to the api deploy script and purge it from history",
      sensitive: true,
      trackerSafeTitle: "Rotate a credential found in git history (details in .aidlc/adoption/report.md)",
      root: "api",
      suggestedType: "task",
      suggestedSize: "M",
      evidence: [cmdEv('git -C "D:/ws/api" log --all --format=%H -- scripts/deploy.sh', "9ac31be")],
      confidence: "high",
    },
    {
      kind: "unreviewed-sensitive-path",
      severity: "high",
      title: "Add test and review coverage for the tenant-scoping middleware",
      root: "api",
      paths: ["src/common/tenant.middleware.ts"],
      suggestedType: "story",
      suggestedSize: "S",
      evidence: [cmdEv('git -C "D:/ws/api" log --format=%s -- src/common/tenant.middleware.ts', "feat: scope queries by tenant")],
      confidence: "medium",
      note: "the file that enforces tenant isolation has one commit and no test file beside it",
    },
    {
      kind: "absent-gate",
      severity: "medium",
      title: "Add a formatting gate to the api service so style stops arriving in review",
      root: "api",
      gate: "format",
      suggestedType: "task",
      suggestedSize: "S",
      evidence: [absEv("no format/prettier script in package.json scripts and no .prettierrc*")],
      confidence: "high",
    },
    {
      kind: "eol-dependency",
      severity: "medium",
      title: "Move the payments app off Ruby 2.7",
      root: "payments-hg",
      paths: ["Gemfile"],
      suggestedType: "story",
      suggestedSize: "L",
      evidence: [pathEv("D:\\ws\\payments-hg\\Gemfile", 3, "ruby '2.7.8'")],
      confidence: "medium",
      note: "Ruby 2.7 reached end of life — confirm against ruby-lang.org, since this scan makes no network calls",
    },
    {
      kind: "cross-platform-hazard",
      severity: "low",
      title: "Add a .gitattributes to the platform monorepo to stop CRLF churn in every diff",
      root: "platform",
      paths: [".gitattributes"],
      suggestedType: "task",
      suggestedSize: "S",
      evidence: [cmdEv('git -C "C:/src/platform" ls-files --eol', "i/crlf w/crlf attr/ packages/web/src/app.tsx")],
      confidence: "high",
    },
    {
      kind: "pii-in-fixtures",
      severity: "low",
      title: "Replace the customer seed fixture with generated data",
      sensitive: true,
      trackerSafeTitle: "Replace a seed fixture that appears to carry personal data (path in .aidlc/adoption/report.md)",
      root: "api",
      suggestedType: "task",
      suggestedSize: "S",
      evidence: [absEv("header row declares columns email, phone, date_of_birth; contents were not read")],
      confidence: "medium",
    },
  ],
  // ADOPT-12 — this run had a baseline. Note the mix: code drift proposes, an unmanaged root is
  // report-only, and a value a human changed after the last apply is left alone.
  drift: {
    baseline: {
      kind: "previous-profile",
      path: ".aidlc/adoption/profile.json",
      scannedAt: "2026-06-02T11:00:00Z",
      commit: "0b7e5d2",
      profileVersion: 1,
      depth: "standard",
      appliedAt: "2026-06-02T11:40:00Z",
    },
    depthChanged: false,
    comparedAgainstConfig: true,
    unmanaged: ["legacy-billing"],
    changes: [
      {
        kind: "package-added",
        surface: "repos[].platform.packages[].acme-worker",
        root: "platform",
        package: "acme-worker",
        was: null,
        now: "packages/worker",
        source: "code",
        action: "propose",
        evidence: [pathEv("C:\\src\\platform\\packages\\worker\\pyproject.toml", 2)],
      },
      {
        kind: "gate-changed",
        surface: "repos[].api.pipeline.gates.verify.steps.test",
        root: "api",
        was: "pnpm test",
        now: "pnpm test --runInBand",
        source: "code",
        action: "propose",
        evidence: [pathEv("D:\\ws\\api\\package.json", 9)],
      },
      {
        // A human tightened this after the last apply. Reported, never proposed for overwrite.
        kind: "convention-changed",
        surface: "repos[].api.commitStyle",
        root: "api",
        was: "conventional",
        now: "id-prefixed",
        source: "human-edit",
        action: "leave-alone",
        note: "changed in config after adoption.appliedAt; history still reads conventional, so the team decided this deliberately",
      },
      {
        // The root is gone, so it is not in workspace.roots — the one case where that is correct.
        kind: "root-removed",
        surface: "repos[].website",
        root: "website",
        was: "D:\\ws\\website",
        now: null,
        source: "code",
        action: "propose",
        evidence: [cmdEv('ls "D:/ws/website"', "ls: cannot access 'D:/ws/website': No such file or directory")],
      },
      {
        // legacy-billing is unmanaged by choice: stated once, never re-proposed.
        kind: "stack-changed",
        surface: "repos[].legacy-billing.stack.backend",
        root: "legacy-billing",
        was: "PHP 7.4 / Laravel 8",
        now: "PHP 8.2 / Laravel 10",
        source: "code",
        action: "report-only",
        evidence: [pathEv("D:\\ws\\legacy-billing\\composer.json", 12)],
      },
    ],
  },
  safety: {
    envFiles: [
      { path: "D:\\ws\\api\\.env", contentsRead: false, gitTracked: false },
      { path: "D:\\ws\\api\\.env.example", contentsRead: false, gitTracked: true },
    ],
    secretFindings: [
      { location: "D:\\ws\\dropzone\\src\\main\\resources\\application.properties:14", type: "connection string with password", inHistory: false, redacted: true },
      { location: "history: 9ac31be D:\\ws\\api\\scripts\\deploy.sh", type: "AWS access key id", inHistory: true, redacted: true },
    ],
    piiSuspects: [
      { path: "D:\\ws\\api\\seed\\customers.csv", signal: "header row declares columns email, phone, date_of_birth", quotedInReport: false },
    ],
  },
});

const referenceReport = `# Adoption report — acme workspace

## Per root
platform holds 3 packages: @acme/shared, @acme/web (depends on shared), acme-worker.

## Runtime constraints
| Root | Constraint | Consequence for a change |
|---|---|---|
| api | shared-schema tenancy on tenant_id | every query filters by tenant; a miss is a cross-tenant read |
| api | migrations run against live data | expand/contract + backfill; a destructive migration blocks review |
| api | releases ride LaunchDarkly flags | user-visible changes ship behind a flag |

## Decisions with no ADR
4 proposed, ranked by reversibility cost. 1 already recorded (framework → Confluence).
Rationale is left blank in each — the scan read code, not the decision.

## Debt the scan found
6 findings, ranked by severity. Two are withheld from any tracker item — their location is the
disclosure — and read as "details in this report". \`/aidlc:adopt-backlog\` proposes them as items.

## Drift since the last scan
Baseline 2026-06-02 at 0b7e5d2, same depth. 5 differences: 3 to propose, 1 reported for an unmanaged
root, 1 left alone because a human changed it after the last apply.

## Supported / partial / unsupported
| Surface | Support | Consequence |
|---|---|---|
| TypeScript / NestJS | supported | full guidance applies |

## Not determined
- platform typecheck entry point — turbo.json declares no typecheck task.

## Scan budget and coverage
812 files, 190 directories, 47.5s. Sampling applied: 62.4% coverage.

Skipped: node_modules (vendored), dist (build-output), .env (env-file), customers.csv (pii-suspect).
`;

// ===== harness =====
let n = 0;
let fails = 0;

function run(profile, report) {
  const pPath = join(work, `p${n}.json`);
  writeFileSync(pPath, JSON.stringify(profile, null, 2));
  const args = [VALIDATOR, pPath];
  if (report !== undefined) {
    const rPath = join(work, `r${n}.md`);
    writeFileSync(rPath, report);
    args.push(rPath);
  }
  try {
    return { code: 0, out: execFileSync(process.execPath, args, { encoding: "utf8" }) };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

// expect === "ok" → must exit 0. Otherwise a substring that must appear in the output, exit 1.
function check(label, mutate, expect, { report } = {}) {
  n++;
  const profile = reference();
  if (mutate) mutate(profile);
  const { code, out } = run(profile, report);
  let ok;
  if (expect === "ok") ok = code === 0;
  else ok = code === 1 && out.includes(expect);
  if (!ok) {
    fails++;
    console.log(`FAIL  ${label}\n      exit=${code} expected=${expect === "ok" ? "exit 0" : `"${expect}"`}\n${out.split("\n").filter(Boolean).map((l) => "        " + l).join("\n")}`);
  } else {
    console.log(`ok    ${label}`);
  }
}

try {
  // ---- 1. the reference must be clean ----
  check("reference profile validates (multi-root, cross-drive, monorepo+single-app, UNC+spaces, zip drop, hg)", null, "ok");
  check("reference profile + report validates", null, "ok", { report: referenceReport });

  // ---- 2. fact-form invariants ----
  check("unknown fact carrying a value is rejected (the guess the contract forbids)",
    (p) => { p.workspace.roots[1].entryPoints.typecheck.value = { cmd: "tsc --noEmit" }; },
    "must not carry a `value`");
  check("unknown fact without a reason is rejected",
    (p) => { delete p.workspace.roots[1].entryPoints.typecheck.reason; },
    "requires `reason`");
  check("known fact without evidence is rejected",
    (p) => { delete p.workspace.roots[0].vcs.defaultBranch.evidence; },
    "evidence must be a non-empty array");
  check("known fact with empty evidence array is rejected",
    (p) => { p.workspace.roots[0].vcs.defaultBranch.evidence = []; },
    "evidence must be a non-empty array");
  check("known fact without confidence is rejected",
    (p) => { delete p.workspace.roots[0].languages; delete p.workspace.roots[0].vcs.defaultBranch.confidence; },
    "missing `confidence`");
  check("absent fact without evidence is rejected (a coverage hole needs its search stated)",
    (p) => { delete p.workspace.roots[5].entryPoints.test.evidence; },
    "evidence must be a non-empty array");
  check("bogus fact status is rejected",
    (p) => { p.workspace.roots[0].vcs.shallow.status = "probably"; },
    "must be one of known | absent | unknown");
  check("kind=absence evidence without a note is rejected",
    (p) => { p.workspace.roots[5].entryPoints.test.evidence = [{ kind: "absence" }]; },
    "requires `note`");
  check("kind=command evidence without output is rejected",
    (p) => { p.workspace.roots[0].vcs.system.evidence = [{ kind: "command", command: "git rev-parse" }]; },
    "requires `command` and `output`");
  check("kind=path evidence without a path is rejected",
    (p) => { p.workspace.roots[0].classification.evidence = [{ kind: "path", line: 3 }]; },
    "kind=path requires `path`");
  check("over-long excerpt is rejected",
    (p) => { p.workspace.roots[0].classification.evidence[0].excerpt = "x".repeat(201); },
    "cap is 200");

  // ---- 3. the read-only guarantee ----
  check("a write outside .aidlc/adoption/ is rejected",
    (p) => { p.scan.writes.paths.push(".claude/aidlc.config.json"); },
    "outside .aidlc/adoption/");
  check("sessionOnly with persisted paths is rejected",
    (p) => { p.scan.writes.sessionOnly = true; },
    "sessionOnly=true but paths[] is non-empty");
  check("no writes and no sessionOnly flag is rejected",
    (p) => { p.scan.writes.paths = []; },
    "either files were written or the run was session-only");
  check("session-only run (read-only workspace) validates",
    (p) => { p.scan.writes = { paths: [], sessionOnly: true }; },
    "ok");
  check("sourceTransmitted=true is rejected",
    (p) => { p.scan.network.sourceTransmitted = true; },
    "must be false");

  // ---- 4. workspace + roots ----
  check("relative absolutePath is rejected",
    (p) => { p.workspace.roots[0].absolutePath = "api"; },
    "must be absolute");
  check("unreachable root without a remedy is rejected",
    (p) => { delete p.workspace.roots[4].reachable.remedy; },
    "must name its exact remedy");
  check("root with no reachability verdict is rejected",
    (p) => { delete p.workspace.roots[3].reachable; },
    "must not be reported as profiled");
  check("duplicate root names are rejected (names route work items)",
    (p) => { p.workspace.roots[2].name = "api"; },
    "duplicate root name");
  check("bad topology value is rejected",
    (p) => { p.workspace.topology.value = "multi-repo"; },
    "must be one of single-app | monorepo | poly | unknown");
  check("bad classification value is rejected",
    (p) => { p.workspace.roots[0].classification.value = "ours"; },
    "must be one of product-repo");
  check("empty roots array is rejected",
    (p) => { p.workspace.roots = []; },
    "a scan that found no root profiled nothing");
  check("monorepo root with no packages warns but passes",
    (p) => { delete p.workspace.roots[1].packages; },
    "ok");

  // ---- 5. honest degradation ----
  check("unsupported surface with no gap entry is rejected",
    (p) => { p.gaps = p.gaps.filter((g) => g.name !== "wi-github-issues"); },
    "must be recorded as a capability gap");
  check("surface without a consequence is rejected",
    (p) => { delete p.surfaces[1].consequence; },
    "missing `consequence`");
  check("bad support value is rejected",
    (p) => { p.surfaces[0].support = "mostly"; },
    "must be one of supported | partial | unsupported | unknown");
  check("gap with an unknown kind is rejected",
    (p) => { p.gaps[0].kind = "wish"; },
    "must be one of skill | agent | plugin | adapter | project-action");

  // ---- 6. safety ----
  check("secret finding without redacted=true is rejected",
    (p) => { p.safety.secretFindings[0].redacted = false; },
    "`redacted` must be true");
  check("secret finding carrying the value is rejected",
    (p) => { p.safety.secretFindings[0].value = "hunter2"; },
    "carries the secret value");
  check("env file with variableNames but no approved read is rejected",
    (p) => { p.safety.envFiles[0].variableNames = ["DATABASE_URL"]; },
    "only be recorded from an approved read");
  check("env file carrying contents is rejected",
    (p) => { p.safety.envFiles[1].contents = "FOO=bar"; },
    "carries env file content");
  check("PII suspect quoted in the report is rejected",
    (p) => { p.safety.piiSuspects[0].quotedInReport = true; },
    "quotedInReport must be false");
  check("PII sample rows are rejected",
    (p) => { p.safety.piiSuspects[0].sample = "ada@example.com,555-0100"; },
    "carries sample data");

  // ---- 7. the credential backstop: anywhere in the artifact ----
  check("an AWS key anywhere in the profile is rejected",
    (p) => { p.workspace.roots[0].vcs.remotes.evidence[0].output = "AKIAIOSFODNN7EXAMPLE"; },
    "AWS access key id");
  check("an unstripped credential in a remote URL is rejected",
    (p) => { p.workspace.roots[0].vcs.remotes.value[0].url = "https://acme:glpat_secretsecret@gitlab.com/acme/api.git"; },
    "credentials embedded in a URL");
  check("a GitHub token in an evidence excerpt is rejected",
    (p) => { p.workspace.roots[0].ci[0].evidence[0].excerpt = "token: ghp_AbCdEfGhIjKlMnOpQrStUvWxYz012345"; },
    "GitHub token");
  check("a private key block in the profile is rejected",
    (p) => { p.workspace.roots[0].classification.evidence[0].excerpt = "-----BEGIN RSA PRIVATE KEY-----"; },
    "private key block");
  check("a credential in the REPORT is rejected",
    null, "AWS access key id",
    { report: referenceReport + "\nkey: AKIAIOSFODNN7EXAMPLE\n" });

  // ---- 8. scan provenance + report structure ----
  check("wrong profileVersion is rejected",
    (p) => { p.profileVersion = 2; },
    "knows version 1 only");
  check("missing scan budget is rejected",
    (p) => { delete p.scan.budget; },
    "the report must state what the scan cost");
  check("non-ISO scannedAt is rejected",
    (p) => { p.scan.scannedAt = "last tuesday"; },
    "not an ISO-8601 timestamp");
  check("relative control-plane path is rejected",
    (p) => { p.scan.controlPlane.path = "."; },
    "must be an absolute path");
  check("bad resolvedFrom is rejected",
    (p) => { p.scan.controlPlane.resolvedFrom = "cwd"; },
    "must be one of code-workspace-file");
  check("sampling applied without a stated coverage is rejected",
    (p) => { delete p.scan.sampling.coveragePercent; },
    "coverage must be a number 0–100");
  check("sampling applied without a strategy is rejected",
    (p) => { delete p.scan.sampling.strategy; },
    "the strategy must be stated");
  check("bad skip reason is rejected",
    (p) => { p.scan.skipped[0].reason = "boring"; },
    "must be one of vendored");
  check("a hit cap with nothing recorded as skipped is rejected",
    (p) => { p.scan.budget.caps.hitCap = true; delete p.scan.skipped; },
    "say what was left unread");
  check("report missing the Not determined section is rejected",
    null, 'missing "not determined"',
    { report: referenceReport.replace(/## Not determined[\s\S]*?\n\n/, "") });
  check("report missing the scan budget is rejected",
    null, 'missing "scan budget"',
    { report: referenceReport.replace("## Scan budget and coverage", "## Cost") });

  // Regression: the enclosing-repo trap found by the fixture pass. `rev-parse
  // --is-inside-work-tree` answers true for any folder under any repo (this machine's home
  // directory is one), so a naive probe reports the ANCESTOR's branch/remotes/history as the
  // root's, with a citation. A root may not claim both.
  check("root inside another repo, correctly recorded, validates",
    (p) => {
      p.workspace.roots[5].enclosingRepo = known("C:\\Users\\dev", [cmdEv('git -C "D:/ws/dropzone" rev-parse --show-toplevel', "C:/Users/dev")]);
    },
    "ok");
  check("root claiming vcs=git while sitting inside another repo is rejected",
    (p) => {
      p.workspace.roots[5].enclosingRepo = known("C:\\Users\\dev", [cmdEv("git rev-parse --show-toplevel", "C:/Users/dev")]);
      p.workspace.roots[5].vcs.system = known("git", [cmdEv("git rev-parse --is-inside-work-tree", "true")]);
    },
    "these VCS facts describe the ancestor");

  check("root with a bad declaredBy is rejected",
    (p) => { p.workspace.roots[0].declaredBy = "guessed"; },
    "must be one of code-workspace | folder-scan | config | user");
  check("doc entry with a bad kind is rejected",
    (p) => { p.workspace.roots[1].docs[0].kind = "confluence"; },
    "must be one of adr | rfc");

  // ---- 8b. gates (ADOPT-4) ----
  check("gate with status=present but no cmd is rejected",
    (p) => { delete p.workspace.roots[0].gates[0].cmd; },
    "status=present requires `cmd`");
  check("absent gate carrying a cmd is rejected",
    (p) => { p.workspace.roots[0].gates[3].cmd = "prettier --check ."; },
    "status=absent must not carry a `cmd`");
  check("absent gate marked required is rejected (a hole must not read as green)",
    (p) => { p.workspace.roots[0].gates[3].required = true; },
    "cannot be `required: true`");
  check("gate missing required flag is rejected",
    (p) => { delete p.workspace.roots[0].gates[1].required; },
    "missing `required` (boolean)");
  check("gate with a bad scope is rejected",
    (p) => { p.workspace.roots[1].gates[0].scope = "everything"; },
    "must be one of repo | package | affected | changed-paths");
  check("scope=package without naming the package is rejected",
    (p) => { delete p.workspace.roots[1].gates[2].package; },
    "requires `package` naming which one");
  check("duplicate gate names in one scope are rejected (order would be ambiguous)",
    (p) => { p.workspace.roots[0].gates[1].name = "lint"; },
    "duplicate gate `lint`");
  check("same gate name for a different package is fine",
    null, "ok");
  check("fabricated timeoutMinutes shape is rejected",
    (p) => { p.workspace.roots[0].gates[2].timeoutMinutes = 0; },
    "must be an integer >= 1");
  check("gate without evidence is rejected",
    (p) => { delete p.workspace.roots[0].gates[0].evidence; },
    "evidence must be a non-empty array");

  // ---- 8c. conventions (ADOPT-5) ----
  check("bad commitStyle is rejected",
    (p) => { p.workspace.roots[0].conventions.commitStyle.value = "gitmoji"; },
    "must be one of conventional | id-prefixed");
  check("bad mergeStrategy is rejected",
    (p) => { p.workspace.roots[0].conventions.mergeStrategy.value = "fast-forward"; },
    "must be one of merge | squash | rebase | mixed");
  check("bad pushAccess is rejected",
    (p) => { p.workspace.roots[0].conventions.pushAccess.value = "maybe"; },
    "must be one of direct | fork-only | unknown");
  check("fork-only contribution with no upstream is rejected",
    (p) => { delete p.workspace.roots[1].vcs.upstream; },
    "a fork contribution path needs the upstream it targets");
  check("integrationBranch equal to defaultBranch is rejected",
    (p) => { p.workspace.roots[1].conventions.integrationBranch.value = "main"; },
    "equals vcs.defaultBranch");
  check("protectedBranches recorded unknown (offline) validates — unknown is not 'unprotected'",
    null, "ok");
  check("a convention fact with a value but no evidence is rejected",
    (p) => { delete p.workspace.roots[0].conventions.commitStyle.evidence; },
    "evidence must be a non-empty array");

  // ---- 8d. SaaS runtime constraints (ADOPT-9) ----
  check("bad tenancy value is rejected",
    (p) => { p.workspace.roots[0].saas.tenancy.value = "multi-tenant-ish"; },
    "must be one of shared-schema | schema-per-tenant");
  check("bad liveDataConstraint value is rejected",
    (p) => { p.workspace.roots[0].saas.liveDataConstraint.value = "careful"; },
    "must be one of expand-contract | not-required");
  check("bad deployStrategy is rejected",
    (p) => { p.workspace.roots[0].saas.deployStrategy.value = "yolo"; },
    "must be one of rolling | blue-green | canary");
  // THE rule: a multi-tenant project with migrations must answer expand/contract. Silence here
  // leaves the reviewer brief empty while the profile still looks complete.
  check("multi-tenant + migrations with the expand/contract question unanswered is rejected",
    (p) => { delete p.workspace.roots[0].saas.liveDataConstraint; },
    "left unstated, the reviewer brief carries no migration constraint");
  check("answering it `unknown` is not answering it",
    (p) => { p.workspace.roots[0].saas.liveDataConstraint = unknown("did not look at the migration directory"); },
    "this must be answered");
  check("`not-required` under shared-schema warns but passes (evidence must justify it)",
    (p) => { p.workspace.roots[0].saas.liveDataConstraint = known("not-required", [absEv("no migration has run against production yet; the product is pre-launch")], "low"); },
    "ok");
  check("single-tenant with migrations needs no expand/contract answer",
    (p) => { p.workspace.roots[0].saas.tenancy.value = "single-tenant"; delete p.workspace.roots[0].saas.liveDataConstraint; },
    "ok");
  // AC7, mechanically: recorded as sensitive but never seeded = reviewed on the ordinary cadence.
  check("an auth path missing from the security-review seeds is rejected",
    (p) => { p.workspace.roots[0].saas.securityReviewPathSeeds = p.workspace.roots[0].saas.securityReviewPathSeeds.filter((s) => s !== "src/auth/"); },
    "recorded as auth/tenant-isolation/billing but never seeded");
  check("a tenant-isolation path missing from the seeds is rejected",
    (p) => { p.workspace.roots[0].saas.securityReviewPathSeeds = ["src/auth/", "src/billing/"]; },
    "`src/common/tenant.middleware.ts`");
  check("sensitive paths recorded with no seeds array at all is rejected",
    (p) => { delete p.workspace.roots[0].saas.securityReviewPathSeeds; },
    "the seeds are how that reaches config");
  check("a compliance regime with no named signal is rejected",
    (p) => { delete p.workspace.roots[0].saas.compliance.value[0].signal; },
    "the thing that evidenced it must be named");
  check("a bad compliance regime is rejected",
    (p) => { p.workspace.roots[0].saas.compliance.value[0].regime = "sox"; },
    "must be one of soc2 | hipaa");
  check("a freeze window with no source is rejected (an unsourced freeze is a rumour)",
    (p) => { delete p.workspace.roots[0].saas.freezeWindows.value[0].source; },
    "it would block an integration on nothing");
  check("an api contract entry with no path is rejected",
    (p) => { delete p.workspace.roots[0].saas.apiContracts.value[0].path; },
    "an entry without one triggers nothing");
  check("an api contract with a bad kind is rejected",
    (p) => { p.workspace.roots[0].saas.apiContracts.value[1].kind = "swagger"; },
    "must be one of openapi | graphql");
  check("a feature-flag system recorded without naming the provider is rejected",
    (p) => { delete p.workspace.roots[0].saas.featureFlags.value.provider; },
    "name the flag system");
  check("a migration tool recorded without naming the tool is rejected",
    (p) => { delete p.workspace.roots[0].saas.migrations.value.tool; },
    "the migration tool by name");
  check("a bad messaging kind is rejected",
    (p) => { p.workspace.roots[0].saas.messaging.value[0].kind = "pigeon"; },
    "must be one of queue | broker");
  check("a tenancy claim with no evidence is rejected",
    (p) => { delete p.workspace.roots[0].saas.tenancy.evidence; },
    "evidence must be a non-empty array");
  check("a root with no saas block validates (a library is not a SaaS)",
    (p) => { delete p.workspace.roots[0].saas; },
    "ok");

  // ---- 8e. the package dimension (ADOPT-8) ----
  check("a dependsOn naming a package that does not exist is rejected",
    (p) => { p.workspace.roots[1].packages[1].dependsOn = ["@acme/nope"]; },
    "a dependency that resolves to nothing sequences nothing");
  check("a package depending on itself is rejected",
    (p) => { p.workspace.roots[1].packages[1].dependsOn = ["@acme/web"]; },
    "depends on itself");
  check("a dependency cycle is rejected (which lands first has no answer)",
    (p) => {
      p.workspace.roots[1].packages[0].dependsOn = ["acme-worker"];
      p.workspace.roots[1].packages[2].dependsOn = ["@acme/web"];
    },
    "dependency cycle");
  check("a three-package cycle names the loop",
    (p) => {
      p.workspace.roots[1].packages[0].dependsOn = ["acme-worker"];
      p.workspace.roots[1].packages[2].dependsOn = ["@acme/web"];
    },
    "@acme/shared -> acme-worker -> @acme/web -> @acme/shared");
  check("a diamond dependency shape is not mistaken for a cycle",
    (p) => {
      p.workspace.roots[1].packages[2].dependsOn = ["@acme/shared"];
      p.workspace.roots[1].packages.push({ name: "@acme/admin", path: "packages/admin", dependsOn: ["@acme/web", "acme-worker"], evidence: [pathEv("C:\\src\\platform\\packages\\admin\\package.json", 2)] });
    },
    "ok");
  check("duplicate package names are rejected",
    (p) => { p.workspace.roots[1].packages[2].name = "@acme/web"; },
    "duplicate package name");
  check("a package missing its path is rejected",
    (p) => { delete p.workspace.roots[1].packages[0].path; },
    "missing `path`");
  check("a package claiming its own release cadence with no release tooling is rejected",
    (p) => { delete p.workspace.roots[1].releaseTooling; },
    "a per-package release needs tooling that supports independent versioning");
  check("no releasable package needs no release tooling",
    (p) => { delete p.workspace.roots[1].releaseTooling; p.workspace.roots[1].packages[0].releasable = false; },
    "ok");
  check("release tooling recorded absent (no release process at all) validates",
    (p) => {
      p.workspace.roots[1].releaseTooling = absent("no .changeset/, lerna.json, semantic-release config or release workflow");
      p.workspace.roots[1].packages[0].releasable = false;
    },
    "ok");

  // ---- 8f. retroactive ADR candidates (ADOPT-10) ----
  // The one rule the whole story turns on: the scan never saw the why.
  for (const field of ["rationale", "why", "because", "alternatives", "alternativesConsidered"])
    check(`an ADR candidate carrying \`${field}\` is rejected — no rationale is invented`,
      (p) => { p.adrCandidates[0][field] = "the team wanted the simplest thing that could scale"; },
      "becomes permanent history nobody authored");
  check("a candidate with no evidence is rejected",
    (p) => { delete p.adrCandidates[2].evidence; },
    "evidence must be a non-empty array");
  check("a bad decisionKind is rejected",
    (p) => { p.adrCandidates[0].decisionKind = "vibes"; },
    "must be one of framework | data-store");
  check("two candidates for the same decision are rejected",
    (p) => { p.adrCandidates[2].decisionKind = "tenancy-model"; },
    "one decision would get two ADRs");
  check("status=propose carrying an existingAdr is rejected",
    (p) => { p.adrCandidates[0].existingAdr = "docs/adr/0004-tenancy.md"; },
    "must not carry `existingAdr`");
  check("status=already-recorded without naming the ADR is rejected",
    (p) => { delete p.adrCandidates[4].existingAdr; },
    "requires `existingAdr`");
  check("a candidate with no title is rejected",
    (p) => { delete p.adrCandidates[1].title; },
    "it becomes the ADR's H1");
  check("a bad reversibilityCost is rejected",
    (p) => { p.adrCandidates[0].reversibilityCost = "annoying"; },
    "must be one of high | medium | low");
  check("an unranked candidate list is rejected (the cap would drop the expensive decisions)",
    (p) => { const c = p.adrCandidates; [c[0], c[3]] = [c[3], c[0]]; },
    "is not ranked by reversibility cost");
  check("more proposals than the recorded cap is rejected",
    (p) => { p.scan.budget.caps.maxAdrCandidates = 2; },
    "proposes 4 ADRs but the cap is 2");
  check("the cap counts proposals only, not already-recorded entries",
    (p) => { p.scan.budget.caps.maxAdrCandidates = 4; },
    "ok");
  check("a candidate citing a root that does not exist is rejected",
    (p) => { p.adrCandidates[0].root = "billing"; },
    "is not a declared root");
  check("decidedAt unknown on a squashed history validates — the ADR's date reads unknown",
    null, "ok");
  check("decidedAt carrying a value while unknown is rejected",
    (p) => { p.adrCandidates[0].decidedAt.value = "2024-06-01"; },
    "must not carry a `value`");
  check("a consequence that is not a string is rejected",
    (p) => { p.adrCandidates[0].consequencesObserved = [{ note: "queries filter by tenant" }]; },
    "must be a non-empty string");
  check("no adrCandidates block at all validates (nothing worth recording)",
    (p) => { delete p.adrCandidates; },
    "ok");

  // ---- 8h. debt findings (ADOPT-11) ----
  // The severe one first: a finding whose location is the disclosure must never carry that location
  // into something a tracker may publish.
  check("a sensitive finding carrying paths is rejected (a tracker item may be a public issue)",
    (p) => { p.debtFindings[0].paths = ["scripts/deploy.sh"]; },
    "must not carry `paths`");
  check("a sensitive finding with no tracker-safe title is rejected",
    (p) => { delete p.debtFindings[0].trackerSafeTitle; },
    "require `trackerSafeTitle`");
  check("a committed-secret finding that is not marked sensitive is rejected",
    (p) => { p.debtFindings[0].sensitive = false; p.debtFindings[0].paths = ["scripts/deploy.sh"]; },
    "turns adoption into a disclosure");
  check("a pii-in-fixtures finding that is not marked sensitive is rejected",
    (p) => { delete p.debtFindings[5].sensitive; },
    "must set `sensitive: true`");
  check("a finding shipping its own fix is rejected (the scan sampled the code, it did not design the change)",
    (p) => { p.debtFindings[2].fix = "add \"format\": \"prettier --write .\" to package.json"; },
    "carries `fix`");
  check("a finding shipping a patch is rejected",
    (p) => { p.debtFindings[2].patch = "--- a/package.json\n+++ b/package.json"; },
    "carries `patch`");
  check("an absent-gate finding for a gate the project actually has is rejected",
    (p) => { p.debtFindings[2].gate = "lint"; },
    "records it as status=present");
  check("an absent-gate finding without a gate name is rejected",
    (p) => { delete p.debtFindings[2].gate; },
    "requires `gate`");
  check("findings not ranked by severity are rejected (the cap would drop the wrong ones)",
    (p) => { p.debtFindings.reverse(); },
    "is not ranked by severity");
  check("findings over the recorded cap are rejected",
    (p) => { p.scan.budget.caps.maxDebtFindings = 3; },
    "the cap is 3");
  check("a finding with no evidence is rejected",
    (p) => { delete p.debtFindings[1].evidence; },
    "evidence must be a non-empty array");
  check("a finding with no title is rejected",
    (p) => { delete p.debtFindings[1].title; },
    "must state the OUTCOME");
  check("a finding naming a root that does not exist is rejected",
    (p) => { p.debtFindings[1].root = "billing-v2"; },
    "is not a declared root");
  check("a finding naming a package the root does not have is rejected",
    (p) => { p.debtFindings[4].package = "@acme/mobile"; },
    "is not a package in root");
  check("a bogus finding kind is rejected",
    (p) => { p.debtFindings[4].kind = "tech-debt"; },
    "must be one of absent-gate");

  // ---- 8i. drift on re-adoption (ADOPT-12) ----
  // The rule everything else serves: a value a human changed is reported, never proposed away.
  check("drift attributed to a human edit but proposed for overwrite is rejected",
    (p) => { p.drift.changes[2].action = "propose"; },
    "carries intent the scan cannot see");
  check("drift attributed to a human edit but reported as report-only is still rejected",
    (p) => { p.drift.changes[2].action = "report-only"; },
    "must be `leave-alone`");
  check("code drift with no evidence is rejected",
    (p) => { delete p.drift.changes[1].evidence; },
    "evidence must be a non-empty array");
  check("a human-edit attribution without having read the config is rejected",
    (p) => { p.drift.comparedAgainstConfig = false; },
    "the config was never read");
  check("re-proposing a surface adoption.unmanaged excludes is rejected",
    (p) => { p.drift.changes[4].action = "propose"; },
    "deliberately excludes");
  check("a drift entry whose was equals now is rejected (that is not drift)",
    (p) => { p.drift.changes[1].now = p.drift.changes[1].was; },
    "`was` equals `now`");
  check("changes recorded against no baseline are rejected",
    (p) => { p.drift.baseline.kind = "none"; },
    "there is no drift");
  check("a depth change that is not flagged is rejected (it would bury the real drift)",
    (p) => { p.drift.baseline.depth = "quick"; },
    "must be true");
  check("a depth change IS accepted once flagged",
    (p) => { p.drift.baseline.depth = "quick"; p.drift.depthChanged = true; },
    "ok");
  check("a drift block with no baseline is rejected",
    (p) => { delete p.drift.baseline; },
    "must say what it compared itself against");
  check("a drift change with no surface is rejected",
    (p) => { delete p.drift.changes[0].surface; },
    "drift a reader cannot locate is a rumour");
  check("a bogus drift source is rejected",
    (p) => { p.drift.changes[0].source = "probably-us"; },
    "must be one of code | config | human-edit");
  check("a re-adoption with no drift block at all is rejected",
    (p) => { p.scan.controlPlane.alreadyAdopted = true; delete p.drift; },
    "no `drift` block");
  check("an unchanged re-adoption is clean with an empty changes[] (idempotency, observable)",
    (p) => { p.scan.controlPlane.alreadyAdopted = true; p.drift.changes = []; },
    "ok");
  check("a drift change naming an undeclared root is rejected — except for a removed one",
    (p) => { p.drift.changes[0].root = "website"; },
    "is not a declared root in this profile");

  // ---- 8g. the report must show what the profile carries ----
  check("a profile with runtime constraints whose report omits them is rejected",
    null, 'missing "runtime constraints"',
    { report: referenceReport.replace(/## Runtime constraints[\s\S]*?\n\n/, "") });
  check("a profile with ADR candidates whose report omits them is rejected",
    null, 'missing "no adr"',
    { report: referenceReport.replace(/## Decisions with no ADR[\s\S]*?\n\n/, "") });
  check("a profile with packages whose report never mentions one is rejected",
    null, 'missing "package"',
    { report: referenceReport.replace(/## Per root[\s\S]*?\n\n/, "").replace(/packages/gi, "units").replace(/package/gi, "unit") });
  check("a profile with debt findings whose report omits them is rejected",
    null, 'missing "debt"',
    { report: referenceReport.replace(/## Debt the scan found[\s\S]*?\n\n/, "") });
  check("a re-adoption whose report never mentions drift is rejected",
    null, 'missing "drift"',
    { report: referenceReport.replace(/## Drift since the last scan[\s\S]*?\n\n/, "").replace(/drift/gi, "movement") });

  // ---- 9. schema agreement ----
  // The validator duplicates the schema's enums so it can run offline inside an installed
  // plugin. Silent drift between the two is the only way that duplication can hurt, so when
  // this test runs inside the AIDLC repo, every duplicated enum is compared to its source.
  const schemaPath = join(HERE, "..", "..", "..", "..", "docs", "adoption-profile.schema.json");
  if (!existsSync(schemaPath)) {
    console.log("skip  schema agreement — docs/adoption-profile.schema.json not reachable (running outside the AIDLC repo)");
  } else {
    const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
    const at = (path) => path.split(".").reduce((o, k) => o?.[/^\d+$/.test(k) ? Number(k) : k], schema);
    const PAIRS = [
      ["DEPTHS", "properties.scan.properties.depth.enum"],
      ["CONFIDENCES", "definitions.fact.properties.confidence.enum"],
      ["STATUSES", "definitions.fact.properties.status.enum"],
      ["EVIDENCE_KINDS", "definitions.evidence.properties.kind.enum"],
      ["RESOLVED_FROM", "properties.scan.properties.controlPlane.properties.resolvedFrom.enum"],
      ["SHAPES", "properties.workspace.properties.shape.allOf.1.properties.value.enum"],
      ["TOPOLOGIES", "properties.workspace.properties.topology.allOf.1.properties.value.enum"],
      ["CLASSIFICATIONS", "definitions.root.properties.classification.allOf.1.properties.value.enum"],
      ["SKIP_REASONS", "properties.scan.properties.skipped.items.properties.reason.enum"],
      ["SUPPORTS", "definitions.support.enum"],
      ["SURFACE_KINDS", "properties.surfaces.items.properties.kind.enum"],
      ["GAP_KINDS", "properties.gaps.items.properties.kind.enum"],
      ["DOC_KINDS", "definitions.root.properties.docs.items.properties.kind.enum"],
      ["DECLARED_BY", "definitions.root.properties.declaredBy.enum"],
      ["GATE_STATUSES", "definitions.gate.properties.status.enum"],
      ["GATE_SCOPES", "definitions.gate.properties.scope.enum"],
      ["COMMIT_STYLES", "definitions.root.properties.conventions.properties.commitStyle.allOf.1.properties.value.enum"],
      ["MERGE_STRATEGIES", "definitions.root.properties.conventions.properties.mergeStrategy.allOf.1.properties.value.enum"],
      ["PUSH_ACCESS", "definitions.root.properties.conventions.properties.pushAccess.allOf.1.properties.value.enum"],
      ["TENANCY_MODELS", "definitions.saasProfile.properties.tenancy.allOf.1.properties.value.enum"],
      ["LIVE_DATA_CONSTRAINTS", "definitions.saasProfile.properties.liveDataConstraint.allOf.1.properties.value.enum"],
      ["DEPLOY_STRATEGIES", "definitions.saasProfile.properties.deployStrategy.allOf.1.properties.value.enum"],
      ["API_CONTRACT_KINDS", "definitions.saasProfile.properties.apiContracts.allOf.1.properties.value.items.properties.kind.enum"],
      ["ENVIRONMENT_KINDS", "definitions.saasProfile.properties.environments.allOf.1.properties.value.items.properties.kind.enum"],
      ["COMPLIANCE_REGIMES", "definitions.saasProfile.properties.compliance.allOf.1.properties.value.items.properties.regime.enum"],
      ["MESSAGING_KINDS", "definitions.saasProfile.properties.messaging.allOf.1.properties.value.items.properties.kind.enum"],
      ["ADR_DECISION_KINDS", "definitions.adrCandidate.properties.decisionKind.enum"],
      ["ADR_CANDIDATE_STATUSES", "definitions.adrCandidate.properties.status.enum"],
      ["REVERSIBILITY_COSTS", "definitions.adrCandidate.properties.reversibilityCost.enum"],
      ["DEBT_KINDS", "definitions.debtFinding.properties.kind.enum"],
      ["DEBT_SEVERITIES", "definitions.debtFinding.properties.severity.enum"],
      ["DEBT_ITEM_TYPES", "definitions.debtFinding.properties.suggestedType.enum"],
      ["DEBT_SIZES", "definitions.debtFinding.properties.suggestedSize.enum"],
      ["DRIFT_BASELINE_KINDS", "properties.drift.properties.baseline.properties.kind.enum"],
      ["DRIFT_CHANGE_KINDS", "definitions.driftChange.properties.kind.enum"],
      ["DRIFT_SOURCES", "definitions.driftChange.properties.source.enum"],
      ["DRIFT_ACTIONS", "definitions.driftChange.properties.action.enum"],
    ];
    for (const [name, pointer] of PAIRS) {
      n++;
      const fromSchema = at(pointer);
      const mine = V[name];
      const ok = Array.isArray(fromSchema) && Array.isArray(mine) &&
        fromSchema.length === mine.length && fromSchema.every((v, i) => v === mine[i]);
      if (ok) console.log(`ok    schema agreement: ${name}`);
      else {
        fails++;
        console.log(`FAIL  schema agreement: ${name}\n      validator: ${JSON.stringify(mine)}\n      schema (${pointer}): ${JSON.stringify(fromSchema)}`);
      }
    }
    // profileVersion must agree too — the validator hard-refuses anything but 1.
    n++;
    if (at("properties.profileVersion.const") === 1) console.log("ok    schema agreement: profileVersion const");
    else { fails++; console.log(`FAIL  schema agreement: profileVersion const is ${JSON.stringify(at("properties.profileVersion.const"))}, validator knows 1`); }

    // The drift baseline's depth is a second copy of the scan's depth enum, inside the same schema.
    // The whole depthChanged rule compares the two, so they have to be the same set.
    n++;
    const scanDepths = at("properties.scan.properties.depth.enum");
    const baseDepths = at("properties.drift.properties.baseline.properties.depth.enum");
    const depthsAgree = Array.isArray(scanDepths) && Array.isArray(baseDepths) &&
      scanDepths.length === baseDepths.length && scanDepths.every((v, i) => v === baseDepths[i]);
    if (depthsAgree) console.log("ok    schema agreement: drift.baseline.depth matches scan.depth");
    else { fails++; console.log(`FAIL  schema agreement: drift.baseline.depth ${JSON.stringify(baseDepths)} != scan.depth ${JSON.stringify(scanDepths)}`); }
  }

  // ---- 10. SKILL agreement ----
  // The schema is published on GitHub and the skill is forbidden from fetching it: §10's skeleton
  // IS the contract an offline agent works from, and the skill says so ("it is sufficient"). So an
  // enum value the validator enforces but the skill never mentions is unusable by construction --
  // and the failure is not a rejected profile, it is a WRONG one. The live run hit this exactly:
  // `project-action` existed in the schema and the validator, the skeleton listed only
  // skill|agent|plugin|adapter, and the cheapest way to satisfy "an unsupported surface must be
  // recorded as a capability gap" was to invent a `skill` gap for a repo that simply has no CI --
  // pointing /aidlc:scaffold-skill at work with no subject, which is what `project-action` was
  // added to prevent. So: every value of every enum a scan must WRITE has to appear in the skill.
  const skillPath = join(HERE, "SKILL.md");
  if (!existsSync(skillPath)) {
    console.log("skip  SKILL agreement — SKILL.md not reachable");
  } else {
    const skill = readFileSync(skillPath, "utf8");
    const AUTHORED = [
      "STATUSES", "CONFIDENCES", "EVIDENCE_KINDS", "RESOLVED_FROM", "SHAPES", "TOPOLOGIES",
      "CLASSIFICATIONS", "SKIP_REASONS", "SUPPORTS", "SURFACE_KINDS", "GAP_KINDS", "DOC_KINDS",
      "DECLARED_BY", "GATE_STATUSES", "GATE_SCOPES", "COMMIT_STYLES", "MERGE_STRATEGIES",
      "PUSH_ACCESS", "TENANCY_MODELS", "LIVE_DATA_CONSTRAINTS", "DEPLOY_STRATEGIES",
      "API_CONTRACT_KINDS", "ENVIRONMENT_KINDS", "COMPLIANCE_REGIMES", "MESSAGING_KINDS",
      "ADR_DECISION_KINDS", "ADR_CANDIDATE_STATUSES", "REVERSIBILITY_COSTS", "DEBT_KINDS",
      "DEBT_SEVERITIES", "DEBT_ITEM_TYPES", "DEBT_SIZES", "DRIFT_BASELINE_KINDS",
      "DRIFT_CHANGE_KINDS", "DRIFT_SOURCES", "DRIFT_ACTIONS", "DEPTHS",
    ];
    for (const name of AUTHORED) {
      n++;
      const missing = (V[name] ?? []).filter((v) => !skill.includes(v));
      if (missing.length === 0) console.log(`ok    SKILL names every ${name} value`);
      else {
        fails++;
        console.log(`FAIL  SKILL.md never mentions ${missing.length} ${name} value(s): ${JSON.stringify(missing)}
      An offline agent cannot use a value the skill does not name. Add it to §10's skeleton or the relevant section.`);
      }
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log(`\n${n - fails}/${n} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
