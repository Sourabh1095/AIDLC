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

const pathEv = (p, line) => ({ kind: "path", path: p, ...(line ? { line } : {}) });
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
      caps: { maxFiles: 5000, maxFileBytes: 262144, maxDepth: 6, hitCap: false },
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
        packages: [
          { name: "@acme/web", path: "packages/web", role: "customer-facing Next.js app", labels: ["web", "frontend"], languages: ["TypeScript"], evidence: [pathEv("C:\\src\\platform\\packages\\web\\package.json", 2)] },
          { name: "acme-worker", path: "packages/worker", role: "Celery worker for async billing jobs", labels: ["worker", "python"], languages: ["Python"], evidence: [pathEv("C:\\src\\platform\\packages\\worker\\pyproject.toml", 2)] },
        ],
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
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log(`\n${n - fails}/${n} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
