# Brownfield walkthrough — an existing codebase, from first scan to a merged PR

`example-walkthrough.md` starts from an empty folder. This one starts from a codebase that has existed
for four years, has its own conventions, and owes AIDLC nothing. It is the harder and far more common
case: the framework has to *learn* the project rather than define it.

> **What this document is.** A worked example, written to be followed command-for-command. The commands
> and file paths are exact. The **outputs are abridged and representative** — a real report is longer and
> your project's facts will differ. Two steps need a real git host and are marked where they appear
> (opening a PR against an upstream you cannot push to, and reading branch protection). Nothing here is
> a transcript of one recorded session; it is the sequence, with the outputs each step produces.

## The project we are adopting

A VS Code workspace, `acme.code-workspace`, with three folders:

```
D:\work\acme\
  acme.code-workspace          # multi-root: three folders
  billing-api\                 # Django 5 + Postgres, GitFlow, tox, 4 years old
  web\                         # Next.js 15 + TypeScript, squash-only merges, husky, no CI
  notes\                       # markdown scratch — not a repo
```

The facts that matter, and that nobody has written down anywhere:

- `billing-api` merges features into **`develop`**, not `main`. Branches are named `PAY-123-slug`.
- Its tests are `tox -e py312`, its linter `ruff check .`, and **it has no typechecker at all**.
- Tenants share one Postgres schema, keyed by `tenant_id`. Every query filters on it. Migrations run
  against live customer data.
- `web` squashes every PR, runs `prettier` and `eslint` through husky, and has **no CI**.
- `notes/` is not a repo and never will be.

Answering `/aidlc:init`'s stack and command questions from memory would get at least two of these wrong.
So we scan first.

## 0 · Install, and open the workspace

```
/plugin marketplace add bee-logical/AIDLC
/plugin install aidlc@bee-logical
```

Open the **workspace file**, not one of the repos — `code D:\work\acme\acme.code-workspace` — then start
Claude Code from `D:\work\acme`. The control plane resolves to the folder holding the `.code-workspace`
file, which is what keeps it out of a product repo.

## 1 · Scaffold, deferring every question the code can answer

```
/aidlc:init
```

At the setup-path question, choose **"there's existing code — scan it"**. Init writes the permission
posture, the rules and the run-state folders, and leaves `architecture.status: "pending"` with the
command placeholders unfilled. It asks for the project key and the tracker; it does **not** ask you to
recall your test command.

Approve the `.claude/settings.json` write when prompted — Claude Code guards permission files at the
harness level, so that one always asks.

## 2 · Scan — read-only, and it stays that way

```
/aidlc:adopt --depth deep
```

`deep` because this is a live multi-tenant product: tenancy, migration safety and API contracts are
evidenced in source, not in a manifest, and `quick`/`standard` would honestly report them as *"not
sampled at this depth"* rather than guessing.

It writes **two files and nothing else** — `.aidlc/adoption/profile.json` and
`.aidlc/adoption/report.md` — and then proves that claim with `git status --porcelain` at the control
plane and at every root. Along the way it asks you to confirm one thing: its classification of the three
roots.

```
Roots — please confirm:
  billing-api   product-repo   D:\work\acme\billing-api   reachable   nested
  web           product-repo   D:\work\acme\web           reachable   nested
  notes         non-repo       D:\work\acme\notes         reachable   nested
                               ↳ no VCS marker; excluded from repos[]
Topology: poly — three roots, two with their own .git (acme.code-workspace folders[])
```

The report is the deliverable. Abridged, the parts that pay for the scan:

```
## The gate, per root
billing-api        (order mirrors .github/workflows/ci.yml)
  1  lint       ruff check .                    tox.ini:12        repo   also in CI
  2  test       tox -e py312                    tox.ini:4         repo   also in CI
                ↳ environment-dependent: needs postgres (compose.yml:3)
  ·  typecheck  ABSENT — coverage hole
                ↳ no mypy/pyright config, no typecheck env in tox.ini, no CI step
  ·  format     ABSENT — coverage hole

web
  1  format     pnpm prettier --check .         package.json:14   repo   provided by husky
  2  lint       pnpm eslint .                   package.json:15   repo   provided by husky
  3  typecheck  pnpm tsc --noEmit               package.json:16   repo
  4  test       pnpm vitest run                 package.json:17   repo
                ↳ parity gap: no CI runs any of these

## Conventions, per root
billing-api   integration branch develop · branches PAY-nn-slug · merge commits · CODEOWNERS (6 rules)
              ↳ branchPattern recovered from merge-commit subjects; refs alone showed only develop/main
web           default main · squash-only · commit style conventional · no CODEOWNERS
              ↳ mergeStrategy: no merge commits on main, so squash OR rebase — medium confidence
active authors  6 across both roots in the last 90 days
              ↳ a signal, not a verdict — apply will ASK whether this is a shared project

## Runtime constraints — billing-api
| Constraint | What it means for a change |
|---|---|
| shared-schema tenancy on tenant_id  | every query filters by tenant; a miss is a cross-tenant read |
| migrations against live data        | expand/contract + backfill; a destructive migration blocks review |
| openapi/public-v1.yaml is public    | a diff touching it triggers breaking-change review |
| no feature-flag system detected     | nothing is asserted; the implementer is not told to flag changes |

Security-review paths, regardless of cadence:
  billing/tenancy/middleware.py · billing/auth/ · billing/subscriptions/

## The gate, per repo — three statuses, and the difference matters
  billing-api   lint  ruff check .      present
                test  tox -e py312      present   (needs postgres — a failure here is
                                                   "environment unavailable", not "code broken")
                typecheck               ABSENT           -> a coverage hole: you could add mypy
                format                  ABSENT           -> a coverage hole: you could add black
                build                   NOT APPLICABLE   -> a Django service is deployed from
                                                            source; there is no artefact to build,
                                                            so this is never reported as a hole

  An `absent` gate appears in every run's `## Findings` until you fill it, which is deliberate.
  A `not-applicable` one is listed once and never again — a finding nobody can ever close is how
  teams learn to skip the section.

## Debt the scan found — 4 findings, nothing created
  high    unreviewed-sensitive-path  tenancy/middleware.py has one commit and no test beside it
  medium  absent-gate                billing-api has no typecheck gate
  medium  absent-gate                billing-api has no format gate
  low     cross-platform-hazard      mixed CRLF/LF in web, no .gitattributes

## Not determined
  web protectedBranches   — gh api is not allowlisted; declined, so UNKNOWN (not "unprotected")
  billing-api freeze windows — no schedule guard in CI and no documented calendar

## Scan budget and coverage
1,204 files · 288 directories · 71s · caps: 5000 files / 256KB / depth 6 — none hit
Skipped: node_modules, .venv, staticfiles (build-output), .env (env-file, never read)
```

Two lines in there are worth more than the rest: **`typecheck ABSENT`** and **`develop`**. The first is a
coverage hole that would otherwise have been silently filled with an npm default that does not exist in
this repo. The second is the difference between a PR that merges and a PR opened against the wrong base.

## 3 · Apply — the one step that writes files you own

```
/aidlc:adopt-apply
```

It shows the complete diff with evidence inline, asks the low-confidence facts as questions rather than
proposing them, and writes nothing until you approve. On this project it asks three:

```
Questions (low confidence or unknown — not proposed as values):
  1. web merge strategy reads as squash OR rebase from history alone. Which is it?  [squash]
  2. No gate duration is known — no CI job timeout is declared and the suite was never run.
     Start with the full suite and revisit, or scope per item now?  [full suite]
  3. 6 authors committed in the last 90 days. Is this a shared project?  [yes]
     → team.mode: shared, team.me from git config (confirm it matches your Jira account)
     → ceremony floors at `tracked`; /aidlc:next will pick only items assigned to you
```

The third is asked rather than inferred on purpose. A contributor count is wrong in both directions —
an inherited repo shows a dozen historical authors and one active maintainer; a repo a team created
last month shows one — and getting it wrong either scopes you out of your own backlog or lets three
people's pipelines pick the same ticket.

And it names one conflict, because `CLAUDE.md` already had a line:

```
Conflict — CLAUDE.md ## Commands
  configured:  make check          (authored by hand, 2024-03)
  detected:    tox -e py312        (tox.ini:4, also in CI)
  keep / replace / merge?  [keep]
```

Keep. `make check` may do something the scan cannot see, and the gate is recorded separately anyway.
That is *adopt, don't impose* doing its job.

What lands, abridged:

```jsonc
"workspace": { "layout": "poly" },
"architecture": { "status": "resolved", "style": "microservices", "resolvedBy": "codebase-scan" },
"repos": [
  { "name": "billing-api", "path": "billing-api", "defaultBranch": "main",
    "integrationBranch": "develop", "branchPattern": "{id}-{slug}",
    "commitStyle": "id-prefixed", "mergeStrategy": "merge",
    "conventionsSource": "codebase-scan",
    "saas": { "tenancy": "shared-schema", "tenantKey": "tenant_id",
              "liveDataConstraint": "expand-contract", "source": "codebase-scan" } },
  { "name": "web", "path": "web", "defaultBranch": "main", "mergeStrategy": "squash",
    "conventionsSource": "codebase-scan" }
],
"pipeline": {
  "gates": {
    "ambiguousRequirements": "assume-and-log",        // untouched — it was already here
    "verify": {
      "repos": {
        "billing-api": { "steps": [
          { "name": "lint",      "status": "present", "cmd": "ruff check .",  "required": true },
          { "name": "test",      "status": "present", "cmd": "tox -e py312",  "required": true,
            "environmentDependent": true, "services": ["postgres"] },
          { "name": "typecheck", "status": "absent",  "required": false },
          { "name": "format",    "status": "absent",  "required": false },
          { "name": "build", "status": "not-applicable", "required": false }
        ] }
      }
    }
  },
  "securityReviewPaths": [
    "billing/tenancy/middleware.py", "billing/auth/", "billing/subscriptions/"
  ]
}
```

The `absent` entries stay. They are the point: every run will report them in `## Findings` as coverage
holes until the project fills them, instead of a missing typecheck quietly counting as green.

`.claude/rules/git-workflow.md` is re-rendered from this — GitFlow for `billing-api`, squash for `web`,
and every line either cited or labelled *"AIDLC default"*. One caveat the command states plainly: the
`guard` hook matches protected branches by name, and `develop` is on that list, so this project happens
to be covered. A project whose integration branch were called `trunk` would not be, and would be told so.

## 4 · Record the decisions the code already made

```
/aidlc:adopt-adr
```

Five candidates, ranked by how expensive each would be to undo, approved one at a time. The first:

```markdown
# 0001. Isolate tenants in one shared Postgres schema keyed by `tenant_id`

**Status:** accepted (retroactive)
**Date:** 2022-03-14   (billing/models/base.py added — git log --diff-filter=A)
**Work item:** none — retroactive, derived from the codebase at 8c31af2

## Decision
The project isolates tenants within a single Postgres schema. Every tenant-owned table carries a
`tenant_id` column, and `TenantScopedManager` (billing/models/base.py:31) applies the filter.

## Rationale
not recorded — confirm with the team.

## Alternatives considered
not recorded — confirm with the team.

## Consequences
- Every query must filter by `tenant_id`; 3 of 11 repositories do it by hand rather than through the
  base manager (billing/reports/exports.py:88, :141, billing/admin/audit.py:52).
- A migration touching a tenant table runs against every tenant's rows at once.

## Evidence
- billing/models/base.py:31 — TenantScopedManager
- billing/tenancy/middleware.py:18 — request-scoped tenant resolution
- billing/migrations/0001_initial.py:14 — tenant_id on the first table
```

The two blanks are the artifact's most valuable lines. A scan can prove *what* was decided and never
*why*, and one plausible invented sentence in an ADR marked `accepted` becomes history nobody authored
and everybody cites. Fill them from the team's memory now, while the people who remember are still here.

## 5 · File the debt, or don't

```
/aidlc:adopt-backlog --dry-run
```

Read it first. Then, if you want it on the board:

```
From the adoption scan of D:\work\acme at 8c31af2 I propose 3 items (of 4 findings):
  NEW  story "Add test coverage for the tenant-scoping middleware"  [P1, S]  repo=billing-api  — 3 AC
  NEW  task  "Add a typecheck gate to billing-api"                  [P3, M]  repo=billing-api  — 4 AC
  NEW  task  "Add .gitattributes to web to stop CRLF churn"         [P4, S]  repo=web           — 3 AC
  SKIP — "billing-api has no format gate": PAY-1102 (todo) already covers it
  Board sweep: 212 open items; closed items searched by title only.
Create these? [all / pick / adjust / none]
```

Each created item gets the **`adopted`** label and a provenance note naming the scan commit, so the board
can later answer *"what did adopting AIDLC put on our plate?"*.

## 6 · Run one — against this project's gate, on this project's branch

```
/aidlc:run PAY-1147
```

The item is *"Export invoices as CSV"*, and the run is now grounded in everything above:

- It branches **`1147-export-invoices-csv` from `develop`**, not `main` — the project's convention, not
  AIDLC's default.
- The implementer brief carries the runtime constraints as *constraints*: every query filters by
  `tenant_id`, and a miss is a cross-tenant read that no test in this repo would catch.
- Verify runs **`ruff check .` then `tox -e py312`**, in that order, from `billing-api`. Nothing runs npm.
- The run file records that `typecheck` and `format` were **absent, not skipped** — and `## Findings`
  says so.
- The diff touches `billing/models/invoice.py`, which is not a security-review path, so security review
  follows the configured cadence. Had it touched `tenancy/middleware.py`, review would have run
  **regardless of cadence**.
- It integrates with a **merge commit** into `develop`, because that is what this repo does.

*(Opening the PR needs a real remote and `gh` auth. Branch protection on `web` came back `unknown` in
§2 — `gh api` is deliberately not allowlisted — so nothing claims that repo's PRs are gated.)*

You review and merge. That is the human gate, unchanged.

## 7 · Six weeks later — the drift report

Somebody added a `mypy` config, `web` gained a GitHub Actions workflow, and a teammate hand-edited a gate
command. Re-scan:

```
/aidlc:adopt --depth deep
```

```
## Drift since the last scan
Baseline 2026-07-30 at 8c31af2, same depth (deep).

The project moved — 2 changes to propose
  gate-added      billing-api typecheck    absent → mypy .            tox.ini:19
  surface-support web CI                   none → GitHub Actions      .github/workflows/ci.yml:1

You changed this by hand — 1 change, left as you set it
  gate-changed    billing-api test         tox -e py312 → tox -e py312 -- -x
                  ↳ changed in config after adoption.appliedAt; not proposed for overwrite

No other differences. 2 findings resolved since the last scan (typecheck gate, web CI parity).
```

`/aidlc:adopt-apply` then proposes exactly those two deltas — and leaves the hand-edited command alone.
Re-run either command at the same commit and it writes **nothing at all**: a clean `git status` is the
observable proof that adoption converges instead of churning.

## 8 · If it doesn't work out

```
/aidlc:remove --dry-run
```

It reads the manifest `adopt-apply` recorded and shows the plan in three tiers: the framework's own files
(delete), the sections it merged into `CLAUDE.md` and `.claude/settings.json` (revert those lines only),
and the directories that are ours by creation but **yours by content** — `docs/adr/`, `backlog/`,
`.aidlc/runs/`, the adoption report — which it keeps by default and asks about individually. Your five
ADRs survive removing the framework that prompted them, which is the correct outcome: they document your
system, not our tooling.

Afterwards it verifies with `git diff` against the pre-adoption commit that your own files are untouched.

## What you end up with

| Before adoption | After |
|---|---|
| Topology, stack and commands live in people's heads | Derived from the code, each with a `path:line` |
| A missing typechecker is invisible | An `absent` gate, reported as a coverage hole every run |
| "Feature work goes into develop" is tribal knowledge | `integrationBranch`, and the pipeline branches from it |
| "Remember to filter by tenant" is said in review | A constraint in every implementer brief |
| Four years of decisions with no record | Five ADRs citing the code, with the *why* marked as owed |
| Debt discussed in retros | Items on the board, labelled `adopted`, with evidence |

## Troubleshooting

| Symptom | Fix |
|---|---|
| A root reports `reachable: false` | Restart with `--add-dir "<abs path>"`, or `/add-dir` in-session. Adopt never reports a repo it could not read as configured |
| Multi-root workspace collapsed to one repo | Your `.code-workspace` failed to parse. It is JSONC — adopt strips comments and trailing commas, and stops loudly rather than degrading. Fix the file and re-scan |
| The runtime-constraints section is nearly empty | You ran `--depth quick` or `standard`. Those constraints live in source; re-run with `--depth deep` |
| `defaultBranch` came back `unknown` | `origin/HEAD` is unset locally — normal when a remote was *added* rather than cloned from. `git remote set-head origin -a`, then re-scan |
| A drift report is enormous after a depth change | It says `depthChanged: true` at the top: most of it is newly-sampled facts, not movement. Compare at the same depth |
| Adoption proposed nothing at all | Re-running at the same commit is a no-op by design. `git log .aidlc/adoption/profile.json` shows when the facts last actually changed |
