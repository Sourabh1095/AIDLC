---
name: ci-cd
description: Authoring and fixing CI pipelines — GitHub Actions and Azure Pipelines conventions, caching, matrices, artifact handling and failure diagnosis. Load when creating or modifying workflow YAML or diagnosing failing checks.
user-invocable: false
---

# CI/CD — pipelines

Host from the **resolved repo entry** for this run (`host`; in mono, `sdlc.config.json → git.host`):
github → `.github/workflows/*.yml`, azure-repos → `azure-pipelines.yml`, written inside that repo
(cwd = its path). Editing these prompts a confirmation hook — expected.

## Baseline PR pipeline (create if the project has none)

Trigger on PRs to the default branch: checkout → setup runtime pinned to the project's version
file (`.nvmrc`/`engines`) → install with lockfile (`npm ci`) + dependency caching →
**typecheck (`tsc --noEmit`) → lint (`eslint`) → format check (`prettier --check`) → boundaries
(`depcruise src`)** → build → test. Fail fast; total target <10 min.

Those steps are the **hard quality gate** for the web-stack baselines scaffolded by `/sdlc:init`:
the tooling baseline (`sdlc-stack-web` → `templates/tooling`) covers typecheck/lint/format; the
**boundary check** (`depcruise`, config from `templates/structure/dependency-cruiser`) enforces the
`sdlc-stack-web:project-structure` layering (no feature→feature internals, no controller→repository,
`ui`↛`store`, …). They run on every PR regardless of `pipeline.verification.mode`, so standards and
structure hold even when the LLM reviewer is toggled off. Skip a step only if the repo genuinely
lacks that script — don't invent one silently; note its absence. Poly: run the gate per repo, in
that repo's checkout.

## Conventions (both hosts)

- **Pin versions**: `uses: actions/checkout@v4` / `task: NodeTool@0` — never `@main`/`@latest`.
- **Cache** dependencies keyed on the lockfile hash (`actions/setup-node` `cache: npm` / `Cache@2`).
- **Secrets**: `${{ secrets.X }}` / pipeline variables marked secret. Never echo them; beware `set -x`.
- **Least privilege** (Actions): top-level `permissions: contents: read`, widen per-job only as needed.
- Matrices only for real support commitments (Node versions actually supported), not decoration.
- Artifacts: upload test reports/coverage on failure too (`if: always()`).
- Services (Postgres/Mongo for integration tests): service containers with health checks, not sleeps.

## Diagnosis protocol (red check)

1. `gh pr checks` / `gh run view <id> --log-failed` (ADO: `az pipelines runs show`) — read the FIRST error, not the last.
2. Classify: **branch-caused** (fix cycle) · **flake** (retry once, note it) · **pre-existing** (verify on default branch, report, don't chase).
3. Reproduce locally before "fixing CI": most CI failures are code failures with better logging.
4. Environment-only failures (works locally): diff the versions — runtime, OS, lockfile respected (`npm ci` not `install`), missing env var, timezone/locale.

## Azure Pipelines specifics

Stages→jobs→steps; templates for reuse across repos; `vmImage: ubuntu-latest`; PR validation
is a **branch policy** on the target branch (build validation), not a YAML trigger — check
policies when "the pipeline didn't run".
