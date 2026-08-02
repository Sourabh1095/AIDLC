---
name: ci-cd
description: Authoring and fixing CI pipelines, independent of stack — GitHub Actions and Azure Pipelines conventions, pinning, caching, secrets, artifacts, and the red-check diagnosis protocol. Load when creating or modifying workflow YAML or diagnosing failing checks. For a Node/TypeScript repo, load `aidlc-stack-web:ci-web` alongside it — the npm-specific gate and its traps live there.
user-invocable: false
---

# CI/CD — pipelines

Host from the **resolved repo entry** for this run (`host`; in mono, `aidlc.config.json → git.host`):
github → `.github/workflows/*.yml`, azure-repos → `azure-pipelines.yml`, written inside that repo
(cwd = its path). Editing these prompts a confirmation hook — expected.

**This skill is stack-agnostic on purpose.** A workspace's real gate might be `pytest`, `mvn -B
verify`, `cargo test`, `go test ./...` or npm scripts, and core must not assume one. Where a stack
pack is installed, it owns its own CI half: **`aidlc-stack-web:ci-web`** for Node/TypeScript — the
shipped workflow templates, the typecheck/lint/format/boundaries gate, cross-repo package resolution
under isolated checkout, cross-platform lockfiles, and the local CI-parity recipe. Load it too when
the repo is TS; don't re-derive any of it here.

## Baseline PR pipeline (create if the project has none)

Trigger on PRs to the default branch. **The steps are the project's resolved gate, not a guess** —
take them from `pipeline.gates.verify` (the same source `resolve-gate.mjs` reads for a local run, see
`aidlc:run` §7), so the pipeline and the pipeline-run verify the same thing. Typical shape: checkout →
set up the runtime pinned to the project's version file → install from the lockfile with dependency
caching → static checks (typecheck / lint / format) → boundary or architecture checks → build → test.
Fail fast; total target <10 min. Poly: run the gate per repo, in that repo's checkout.

Two rules regardless of stack:

- **A step recorded `absent` at adoption is a coverage hole, not something to invent.** Don't
  substitute a default command for a gate the project doesn't have; surface it (`aidlc:run` §7).
- **A gate that can pass while enforcing nothing is worse than no gate.** Where a checker can no-op
  silently (an analyzer that matched zero files, a test runner that collected zero tests), assert the
  non-empty result explicitly. The Node instance of this trap is F30 in `aidlc-stack-web:ci-web`.

## Conventions (both hosts)

- **Pin versions**: `uses: actions/checkout@v4` / `task: NodeTool@0` — never `@main`/`@latest`.
- **Cache** dependencies keyed on the lockfile hash (`actions/setup-node` `cache: npm` / `Cache@2`).
- **Secrets**: `${{ secrets.X }}` / pipeline variables marked secret. Never echo them; beware `set -x`.
- **Least privilege** (Actions): top-level `permissions: contents: read`, widen per-job only as needed.
- Matrices only for real support commitments (runtime versions actually supported), not decoration.
- Artifacts: upload test reports/coverage on failure too (`if: always()`).
- Services (Postgres/Mongo for integration tests): service containers with health checks, not sleeps.

## Diagnosis protocol (red check)

1. `gh pr checks` / `gh run view <id> --log-failed` (ADO: `az pipelines runs show`) — read the FIRST error, not the last.
2. Classify: **branch-caused** (fix cycle) · **flake** (retry once, note it) · **pre-existing** (verify on default branch, report, don't chase).
3. Reproduce locally before "fixing CI": most CI failures are code failures with better logging.
4. **When it doesn't reproduce in your normal workspace, reproduce it in the CI _image_ (F31) — do
   this BEFORE iterating through remote CI.** Push→wait→read-log→repeat is punishingly slow when a
   single self-hosted agent serializes runs (four cascading fixes = four full remote cycles). Instead
   `docker run` the CI runtime and replicate the CI layout — an **isolated single-repo checkout**, a
   lockfile install, then the failing step. Validate the fix green in the container, then push once.
   This is the only way to reproduce the two classes that never show up in a local workspace:
   poly isolated-checkout dependency resolution, and platform-specific lockfile failures. The
   per-stack recipe is in that stack's CI skill (`aidlc-stack-web:ci-web` for Node); container
   conventions are `aidlc-stack-web:docker`.
5. Environment-only failures (works locally): diff the versions — runtime, OS, missing env var,
   timezone/locale — and above all check the **lockfile was respected** (the exact-install command,
   not the resolving one) and that the lockfile is **valid for the CI platform**, since some package
   managers resolve platform-specific optional dependencies per OS/arch.

## Azure Pipelines specifics

Stages→jobs→steps; templates for reuse across repos; PR validation is a **branch policy** on the
target branch (build validation), not a YAML trigger — check policies when "the pipeline didn't run".

**`vmImage` is not free on a fresh org (F25).** The default `vmImage: ubuntu-latest` is a
**Microsoft-hosted** agent, and a brand-new Azure DevOps org gets **no hosted-parallelism grant**
(`resourceLimit: null`) until it's requested — so *every* `vmImage` pipeline silently can't run at
all. Before recommending hosted agents on a new org, **check/warn** on hosted parallelism and surface
the request link <https://aka.ms/azpipelines-parallelism-request> (~2–3 business days). Meanwhile,
support a **self-hosted `pool:`** (the shipped templates' `poolName` parameter) as the fallback — a
single self-hosted agent runs one job at a time org-wide, so serialize accordingly.

**`Checkpoint.Authorization` — don't just "wait it out" (F25).** A first run can stall on
authorization. It's *sometimes* a benign ~2.5-min first-run wait — but it also hangs on a **missing
`pipelinePermissions` grant**, and that grant is per-resource: authorize the pipeline at the **queue
id** (`pipelinePermissions/queue/<id>`), which is **distinct from the pool id** *and* from the
repository grant. Add the queue authorization first; only then treat a residual short stall as benign.
Telling the user to "wait" is wrong advice when it's actually a missing queue authorization.
