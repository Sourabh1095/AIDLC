---
name: ci-web
description: The Node/TypeScript half of CI — the shipped GitHub Actions and Azure Pipelines templates, the typecheck/lint/format/boundaries gate and its dependency-cruiser assertion, cross-repo package resolution under isolated single-repo checkout, cross-platform lockfiles for Linux runners, and how to reproduce a red CI run locally in the CI image. Load alongside `aidlc:ci-cd` when the repo is a Node/TS repo. Host mechanics (triggers, pinning, secrets, Azure pools and queue authorization) live in `aidlc:ci-cd`, not here.
user-invocable: false
---

# CI — the web stack's half

`aidlc:ci-cd` owns everything that is true of a pipeline regardless of language: which file the
workflow lives in, pinning and caching conventions, secret handling, the diagnosis protocol, and the
Azure Pipelines org-level traps. **This skill owns the part that is only true because the repo is
Node/TypeScript.** Load both; neither repeats the other.

## Start from the shipped template, not from scratch

`aidlc-stack-web/templates/ci/` ships `azure-pipelines.yml` and `github-actions-ci.yml` (+ a README)
that already encode the gate and every trap below — self-hosted pool parameter, cross-platform
lockfile note, non-empty-graph assertion, commented multi-repo checkout. `/aidlc:init` offers to
scaffold the matching one per remote repo. Adapt the template; build from zero only when this pack
isn't installed.

## The gate

Checkout → setup Node pinned to the repo's version file (`.nvmrc` / `engines`) → install with the
lockfile (`npm ci`) + dependency caching → **typecheck (`tsc --noEmit`) → lint (`eslint`) → format
check (`prettier --check .`, repo-wide, not just `src/`) → boundaries (`depcruise src` + the
assertion below)** → build → test. Fail fast; total target <10 min. Poly: run it per repo, in that
repo's checkout.

These are the **hard quality gate** for the baselines `/aidlc:init` scaffolds: the tooling baseline
(`templates/tooling/`) covers typecheck/lint/format, and the boundary check enforces the
`aidlc-stack-web:project-structure` layering. They run on every PR regardless of
`pipeline.verification.mode`, so standards and structure hold even when the LLM reviewer is toggled
off. Skip a step only if the repo genuinely lacks that script — don't invent one silently; note its
absence.

### The boundary gate must not silently no-op (F30)

`dependency-cruiser < 17` runs but **silently analyzes zero `.ts` files** — no violations reported,
gate green, nothing enforced. The devDep floor and its rationale are in
`aidlc-stack-web:project-structure` → *Repo-scaffold checklist* item 2; the CI half is the
belt-and-suspenders: **assert a non-empty module graph** — fail the step if `depcruise` analyzed 0
`.ts` modules — so a future silent no-op can't slip through. Both shipped templates carry the
assertion.

## Poly — cross-repo package dependencies under isolated checkout (F28)

CI checks out **one repo**. So the poly shared-package pattern (one repo's package consumed by the
others) must resolve **under isolated single-repo checkout** or the gate dies at install
(`Cannot find package '@scope/dev-config'`). An unpublished **`file:../sibling`** link resolves in the
multi-repo workspace and is **absent in CI**.

`aidlc-stack-web:project-structure` → *Cross-repo dependencies* owns the **decision** (publish vs
multi-checkout, and when each is valid) and it is made at design time, before the pattern fans out.
This section owns the **CI mechanics** for whichever was chosen:

- **Published** — consume by version from the registry (Azure Artifacts / a private registry). Nothing
  special in the workflow beyond registry auth.
- **Multi-repo checkout** — check the sibling out alongside (`resources.repositories` + a second
  `checkout:` on Azure; a second `actions/checkout` with `repository:`+`path:` on GitHub) and
  **`npm ci` the checked-out sibling too** (its exported configs need their own deps), guarding
  husky's `prepare` so it doesn't exit 127 (F21). Both shipped templates carry a commented
  multi-checkout block.

And see `aidlc:run` (poly pilot): piloting the *dependency* repo's own green does NOT prove the
*consumers'* resolution path.

## Cross-platform lockfile for Linux runners (F29)

`npm ci` is exact-lock, and npm resolves platform-specific optional deps (`@emnapi/*`, esbuild/swc/
rollup natives) per OS/arch — so a `package-lock.json` generated on Windows or macOS can be
**unsatisfiable on Linux CI**. Fix: regenerate the lockfile in the **Linux context CI uses** (a
`node:22` container) and commit that. Never loosen CI to `npm install`.

## Reproducing a red run locally

`aidlc:ci-cd` → *Diagnosis protocol* says reproduce in the CI **image** before iterating through
remote CI. For this stack that means `docker run` the CI runtime and replicate the CI layout — an
**isolated single-repo checkout** + `npm ci` + the failing step. Container conventions are
`aidlc-stack-web:docker`.

### Local CI-parity for a `file:`-sibling consumer (F38)

When you must **ground-truth** a consumer's gate locally — an implementer's or devops' verdict can't
be trusted (F37/F40), or you're checking a `file:` sibling's resolution — the install order matters or
the result is a false one:

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

Run it in the **CI image** (`docker run node:22 …`) for true parity. The two failure modes this kills:
(a) skipping the sibling install (→ `Cannot find package …`, a false red); (b) an `&& echo OK` tail
that swallows a real non-zero exit (→ a false green). This is the "trust-but-verify a phase result"
recipe the orchestrator uses when a subagent returns a non-verdict — `aidlc:run` §7 and
`aidlc:agent-contract`.
