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

**Don't hand-write it from scratch — start from the shipped template.** `sdlc-stack-web/templates/ci/`
ships `azure-pipelines.yml` and `github-actions-ci.yml` (+ a README) that already encode this gate and
every gotcha below (self-hosted pool, cross-platform lockfile, non-empty-graph assertion, multi-repo
checkout). `/sdlc:init` offers to scaffold the matching one per remote repo. Adapt the template; only
build from zero when no stack pack is installed.

Trigger on PRs to the default branch: checkout → setup runtime pinned to the project's version
file (`.nvmrc`/`engines`) → install with lockfile (`npm ci`) + dependency caching →
**typecheck (`tsc --noEmit`) → lint (`eslint`) → format check (`prettier --check .`, repo-wide — not
just `src/`) → boundaries (`depcruise src` + a non-empty-graph assertion, below)** → build → test.
Fail fast; total target <10 min.

Those steps are the **hard quality gate** for the web-stack baselines scaffolded by `/sdlc:init`:
the tooling baseline (`sdlc-stack-web` → `templates/tooling`) covers typecheck/lint/format; the
**boundary check** (`depcruise`, config from `templates/structure/dependency-cruiser`) enforces the
`sdlc-stack-web:project-structure` layering (no feature→feature internals, no controller→repository,
`ui`↛`store`, …). They run on every PR regardless of `pipeline.verification.mode`, so standards and
structure hold even when the LLM reviewer is toggled off. Skip a step only if the repo genuinely
lacks that script — don't invent one silently; note its absence. Poly: run the gate per repo, in
that repo's checkout.

**Boundary gate must not silently no-op (F30).** `dependency-cruiser < 17` runs but **silently
analyzes zero `.ts` files** — it reports no violations and the gate passes **green while enforcing
nothing** (the exact "looks enforced but isn't" trap `project-structure` warns about). So: (a) the
repo must pin **`dependency-cruiser@^17`** (the devDep floor — see `sdlc-stack-web:project-structure`);
and (b) the gate should **assert a non-empty module graph** — fail if `depcruise` analyzed 0 `.ts`
modules — so a future silent no-op can't slip through. Both shipped CI templates carry this assertion.

## Poly — cross-repo package dependencies in CI (F28)

CI checks out **one repo**. So a cross-repo package dependency — the poly **shared-package** pattern
this framework promotes (one repo's package, e.g. `@beelogical/dev-config`, consumed by the others) —
must be resolvable **under isolated single-repo checkout**, or the whole gate fails at install
(`Cannot find package '@beelogical/dev-config'`). The natural local-dev choice, an unpublished
**`file:../sibling`** link, resolves in the multi-repo workspace but is **absent in CI** — it is
**local-only and fails isolated CI**. Two supported resolutions:

- **(A) Publish** the shared package (Azure Artifacts / a private registry) and consume it by version.
  **Required, not optional, for transitive/built cross-repo deps** — a repo that consumes a *built*
  sibling (e.g. a compiled SDK it type-checks against), not just flat config files: multi-checkout
  degrades badly there (you'd need multiple sibling checkouts + building the sibling).
- **(B) Multi-repo checkout** — check the sibling out alongside (`resources.repositories` +
  a second `checkout:` on Azure; a second `actions/checkout` with `repository:`+`path:` on GitHub) and
  **`npm ci` the checked-out sibling too** (its exported configs need their own deps), guarding husky's
  `prepare` so it doesn't exit 127 (F21). Workable for a **leaf** config dependency only. Both shipped
  CI templates carry a commented multi-checkout block.

Decide publish-vs-checkout **before** fanning a shared-config pattern out to consumers — and see
`sdlc:run` (poly pilot): piloting the *dependency* repo's own green does NOT prove the *consumers'*
resolution path. `sdlc-stack-web:project-structure` documents the consumption rule at design time.

### Local CI-parity for a `file:`-sibling consumer (F38)

When you must **ground-truth** a consumer's CI gate locally — e.g. an implementer's/devops' verdict
can't be trusted (F37/F40) and you're reproducing the gate yourself — a `file:../sibling` consumer
needs a **two-step install in the right order**, or the result is a false one:

```bash
set -euo pipefail          # and NO '&& echo OK' / '|| true' tails anywhere — they mask a non-zero
                           # exit under set -e (the FALSE GREEN this recipe exists to prevent)
# 1. Install the SIBLING FIRST — its exported eslint/tsconfig/depcruise configs must resolve THEIR
#    own deps, or the consumer's lint dies with "Cannot find package '@eslint/js'".
( cd ../dev-config && npm ci )
# 2. THEN install the consumer.
npm ci
# 3. Run the exact gate steps CI runs — each on its OWN line, exit code standing on its own:
npm run typecheck
npm run lint
npm run format:check
npx depcruise src          # + assert a non-empty module graph (F30)
npm test
```

Run it in the **CI image** (`docker run node:22 …`, F31) for true parity. The two failure modes this
kills: (a) skipping the sibling install (→ `Cannot find package …` — the wrong order gives a false
red); (b) an `&& echo OK` tail that swallows a real non-zero exit (→ a false green). This is the
"trust-but-verify a phase result" recipe the orchestrator uses when a subagent returns a non-verdict —
see `sdlc:run` §7 and the orchestrator invariants.

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
4. **When it doesn't reproduce in your normal workspace, reproduce it in the CI _image_ (F31) — do
   this BEFORE iterating through remote CI.** Push→wait→read-log→repeat is punishingly slow when a
   single self-hosted agent serializes runs (four cascading fixes = four full remote cycles). Instead
   `docker run` the CI runtime (e.g. `node:22`) and replicate the CI layout: an **isolated single-repo
   checkout** + `npm ci`, then run the failing gate step. Validate the fix **green in the container**,
   then push once. Essential for poly isolated-checkout + `file:` sibling issues (F28) and
   cross-platform lock failures (F29) — the two classes that never reproduce in the local workspace.
5. Environment-only failures (works locally): diff the versions — runtime, OS, missing env var,
   timezone/locale, and especially: **lockfile respected (`npm ci` not `install`)** and
   **cross-platform lockfile (F29)** — a `package-lock.json` generated on Windows/macOS can be
   unsatisfiable on Linux CI because npm resolves platform-specific optional deps (`@emnapi/*`,
   esbuild/swc/rollup natives) per OS/arch. Fix: regenerate the lockfile in the **Linux context CI
   uses** (a `node:22` container) and commit that — never loosen CI to `npm install`.

## Azure Pipelines specifics

Stages→jobs→steps; templates for reuse across repos; PR validation is a **branch policy** on the
target branch (build validation), not a YAML trigger — check policies when "the pipeline didn't run".

**`vmImage` is not free on a fresh org (F25).** The default `vmImage: ubuntu-latest` is a
**Microsoft-hosted** agent, and a brand-new Azure DevOps org gets **no hosted-parallelism grant**
(`resourceLimit: null`) until it's requested — so *every* `vmImage` pipeline silently can't run at
all. Before recommending hosted agents on a new org, **check/warn** on hosted parallelism and surface
the request link <https://aka.ms/azpipelines-parallelism-request> (~2–3 business days). Meanwhile,
support a **self-hosted `pool:`** (the shipped template's `poolName` parameter) as the fallback — a
single self-hosted agent runs one job at a time org-wide, so serialize accordingly.

**`Checkpoint.Authorization` — don't just "wait it out" (F25).** A first run can stall on
authorization. It's *sometimes* a benign ~2.5-min first-run wait — but it also hangs on a **missing
`pipelinePermissions` grant**, and that grant is per-resource: authorize the pipeline at the **queue
id** (`pipelinePermissions/queue/<id>`), which is **distinct from the pool id** *and* from the
repository grant. Add the queue authorization first; only then treat a residual short stall as benign.
Telling the user to "wait" is wrong advice when it's actually a missing queue authorization.
