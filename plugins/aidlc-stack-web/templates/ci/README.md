# Web-stack CI templates — the enforced PR gate

`remote` mode's core promise is that **CI enforces the quality gate before a human merges**. But the
gate the pipeline runs during `/aidlc:run` is *local* — unless a CI job runs the same checks as a
required PR check, remote PRs merge **ungated**. These templates run the exact same deterministic gate
(`typecheck → lint → format → boundaries → build → test`) so that promise actually holds.

`/aidlc:init` offers to scaffold the matching one per **remote** repo; `/aidlc:init` and `/aidlc:status`
**warn** when a `mode: remote` repo has no detectable CI / required-check policy.

| Host | File | Drop at |
|------|------|---------|
| Azure Repos / Azure Pipelines | `azure-pipelines.yml` | repo root `azure-pipelines.yml` |
| GitHub | `github-actions-ci.yml` | `.github/workflows/ci.yml` |

## The gate ≠ the merge block

Shipping the YAML is necessary but **not sufficient** — neither host blocks a merge just because a
pipeline exists:

- **Azure Repos:** PR validation is a **branch policy** (Build validation) on the target branch, set
  *blocking*. Not a YAML trigger. Proven pattern: pipeline def + `blocking=true` policy on
  `refs/heads/main`, verified red→green pre-merge.
- **GitHub:** mark the `gate` job a **required status check** in Branch protection.

Setting the policy needs org permissions and may legitimately remain a tracked devops task — but the
plugin gets you ~90% there and never leaves it silent.

## Azure Pipelines gotchas (fresh orgs bite here — see `aidlc:ci-cd`)

- **Hosted parallelism.** A brand-new ADO org has **no free hosted-parallelism grant**
  (`resourceLimit: null`) — every `vmImage` pipeline then *silently can't run at all*. Request it at
  <https://aka.ms/azpipelines-parallelism-request> (~2–3 business days), or set the template's
  `poolName` parameter to run on a **self-hosted** agent instead.
- **`Checkpoint.Authorization` stall.** A first run can stall on authorization. Sometimes a benign
  ~2.5-min wait — but it also hangs on a **missing `pipelinePermissions` grant at the _queue_ id**
  (distinct from the pool id *and* the repo grant). Authorize the pipeline at the queue id first;
  only then treat a residual short stall as benign. "Wait it out" is wrong advice for a missing
  queue authorization.

## Cross-platform lockfile (`npm ci` on Linux)

`npm ci` is exact-lock, no resolution. A `package-lock.json` generated on **Windows/macOS** can be
unsatisfiable on **Linux CI** (npm resolves platform-specific optional deps — `@emnapi/*`, esbuild /
swc / rollup natives — per OS/arch). Generate or refresh the committed lockfile in the **Linux context
CI uses** (e.g. a `node:22` container) — don't loosen the CI to `npm install`. See `aidlc:ci-cd`.

## Boundary gate can't silently no-op

Both templates assert dependency-cruiser analyzed a **non-empty** `.ts` module graph. `dependency-cruiser
< 17` silently no-ops on TypeScript (runs, reports zero violations, passes green while enforcing
nothing). Pin **`dependency-cruiser@^17`** (the devDep floor lives in `aidlc-stack-web:project-structure`)
and let the assertion catch a regression.

## Poly + a cross-repo package dependency (the `file:../sibling` trap)

CI checks out **one** repo. An unpublished `file:../shared-config` sibling link resolves in the local
multi-repo workspace but is **absent** under isolated single-repo checkout, so every config it sources
fails (`Cannot find package '@beelogical/dev-config'`). Two supported resolutions:

1. **Publish** the shared package (Azure Artifacts / GitHub Packages / private registry) and consume
   it by version. **Required** for transitive/**built** cross-repo deps (a repo that needs a *built*
   sibling SDK for type-check, not just flat config files) — multi-checkout degrades badly there.
2. **Multi-repo checkout** — check the sibling out alongside and `npm ci` **it too** (its exported
   configs need their own deps); guard husky's `prepare` so it doesn't exit 127. Workable for a **leaf**
   config dependency only. Both templates carry a commented block showing how.

An unpublished `file:` sibling link is **local-only** and fails isolated CI — decide publish-vs-checkout
before fanning a shared-config pattern out to consumers (see `aidlc:ci-cd` and `aidlc:run` poly pilot).
