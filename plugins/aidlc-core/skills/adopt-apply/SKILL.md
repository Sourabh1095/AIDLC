---
name: adopt-apply
description: Turn an approved adoption profile into configuration — aidlc.config.json (topology, repos, monorepo packages[], per-repo and per-package stack, pipeline.gates.verify, git conventions, the SaaS runtime constraints and the security-review paths they seed), CLAUDE.md's project facts and Commands block, and .claude/rules/git-workflow.md — behind a full shown diff and an explicit approval, merging rather than overwriting anything a human authored. The write half of brownfield adoption: /aidlc:adopt reads the code and derives the facts, this applies them. Use after /aidlc:adopt, or to re-apply an updated profile.
argument-hint: "[--only <repo|package>] [path to profile.json]"
disable-model-invocation: true
---

# /aidlc:adopt-apply — an approved profile becomes this project's configuration

`/aidlc:adopt` derived the facts and wrote nothing. This command turns them into the files that steer
every later run — `aidlc.config.json`, `CLAUDE.md`, `.claude/rules/git-workflow.md`. That makes it the
**dangerous half**, so it operates under one rule that outranks the rest:

> **Propose, then write. Never the reverse.** Show the complete diff, with each changed value's evidence
> beside it, and write only what the user approves. A brownfield project's config and `CLAUDE.md` are
> files the team already owns.

Three failure modes to design against, because each is silent:

1. **Overwriting a human.** A value someone authored by hand carries intent that no scan can see. It is
   never replaced — a disagreement is surfaced as a choice.
2. **Presenting a guess as a fact.** The profile marks confidence; a `low`-confidence fact becomes a
   **question**, not a proposed value. An `unknown` becomes a question or stays absent — never a default
   dressed as a finding.
3. **Rewriting instead of converging.** Re-applying the same profile at the same commit must produce
   **no diff at all**. If it produces one, that is a bug here, not drift in the project.

## 1 · Load and check the profile

Read `.aidlc/adoption/profile.json` (or the path in `$ARGUMENTS`) and **validate it before believing
it** — the scan's own validator ships beside it:

```
node "<plugin>/skills/adopt/validate-profile.mjs" .aidlc/adoption/profile.json
```

- Non-zero ⇒ **stop.** Report the violations and tell the user to re-run `/aidlc:adopt`. Applying an
  invalid profile is how a malformed fact becomes permanent configuration.
- `profileVersion` you do not recognise ⇒ stop and say so. Do not read it optimistically.
- **Staleness check.** Compare `scan.commit` to the control plane's current HEAD. Different ⇒ say so and
  offer to re-scan first; the code has moved since these facts were true. Proceed only if the user
  chooses to.
- If the profile records `scan.writes.sessionOnly: true` there is no file to load — ask the user to
  re-run the scan in a writable workspace.
- `--only <repo|package>` scopes this run to one surface. Everything else is left **unmanaged** and
  recorded in `adoption.unmanaged`, so a later run neither re-proposes it nor mistakes it for missed.

## 2 · Read what already exists — the merge baseline

Before proposing anything, read the current state of every file you would touch: `.claude/aidlc.config.json`,
`CLAUDE.md`, `.claude/rules/git-workflow.md`. Classify every value you intend to write:

| Situation | What to do |
|---|---|
| File/key absent | Propose the derived value, with its evidence. |
| Present and equal to the derived value | **No diff.** Say nothing; this is what idempotency looks like. |
| Present and **different** | A conflict. Surface it as `detected X (evidence) · configured Y — keep / replace / merge` and **default to keep**. |
| Present, and `conventionsSource: "human"` / `saas.source: "human"`, or the config has no `adoption` block | Treat every existing value as hand-authored. Conflicts default to keep, and say why. |
| An **array** a human may have added to (`pipeline.securityReviewPaths`, `labels`) | **Union, never replace.** Add what is missing, keep what is there, and show each addition as its own line. Replacing an array silently deletes a human's entries while the diff looks like a normal change. |
| Derived fact has `confidence: low` | Ask it as a question. Never pre-fill it as a proposal. |
| Derived fact is `unknown` | Ask, or leave absent. Never substitute a default silently. |

`CLAUDE.md` is prose, so merge at the **section** level, exactly as `/aidlc:init` does (`init` Step 2):
fill placeholders and add missing bullets, never rewrite a line a human wrote. If the file already
states a command that contradicts the detected one, that is a conflict for the table above — not an
overwrite.

## 3 · Build the proposal

### 3.1 · Topology, repos and stack (from `workspace` + roots)

- `workspace.layout` from `workspace.topology`: `poly` for many repos, `mono` for `single-app`, and `mono`
  for a `monorepo` root (one git repo) — with its packages carried on the repo entry, not as a new layout
  value.
- `repos[]` from roots classified **`product-repo` or `monorepo` only**. Never from a `non-repo`,
  `reference-only`, or `not-cloned` root; each excluded root gets one line in the summary saying why.
- `repo.path`: **absolute** when `nestedUnderControlPlane` is false, relative otherwise. Carry
  `role` (from the derived one-liner), `labels`, per-repo `stack`, `host`, `defaultBranch`, and
  `mode` — `local` where `vcs.remotes` is `absent`, `remote` where a remote exists.
- `architecture`: `status: "resolved"`, `resolvedBy: "codebase-scan"`, `style` only where the evidence
  actually supports it (many services in many repos ⇒ `microservices`; one repo ⇒ `monolith` or
  `modular-monolith` — if the evidence does not separate those two, ask rather than pick), and a
  one-line `rationale` naming the deciding signal.
- Never fabricate a path for a `not-cloned` root. Offer a clone step; leave it out of `repos[]` until it
  exists.

**`packages[]` — the monorepo dimension.** A root classified `monorepo` carries its packages onto its
`repos[]` entry (`repos[].packages[]`); in a single-repo workspace they go at the top level
(`packages[]`) beside `layout: mono`. Carry `name`, `path`, `role`, `labels`, `stack`, `ux` where the
package has a frontend, `dependsOn` and `releasable` straight through.

- **Do not invent a third `layout` value.** A monorepo is *one git repo*, so it stays `mono` (or one
  poly `repos[]` entry): `repos[]` means a git boundary and `packages[]` means an ownership boundary
  inside it. That is also what makes the hybrid workspace — a monorepo root beside single-app repos —
  representable with no schema break.
- **`name` must match the package's own manifest.** It keys `pipeline.gates.verify…packages.<name>` and
  labels the PR; a folder name substituted here matches nothing and fails silently.
- **Per-package gates** go under `pipeline.gates.verify.packages.<name>.steps` in mono, or
  `…verify.repos.<repo>.packages.<name>.steps` in poly. They **layer** over the repo's rather than
  replacing it (§3.2), so a package that declares its own `test` still inherits the repo's `lint`.
- **`releasable` needs tooling that can cut a release.** Only carry it where the profile's
  `releaseTooling` is `known`; say plainly in the summary when the repo releases as one unit, so
  `/aidlc:release` never promises a per-package cut the project cannot make.
- **`dependsOn` is the sequencing input** for cross-package work, exactly as item `dependsOn` is for
  cross-repo work. If the profile recorded a cycle, do not write the block — report it and ask, because
  an arbitrary order is worse than none.

### 3.2 · `pipeline.gates.verify` (from each root's `gates[]`)

Copy the **order** verbatim — it is the contract the run skill executes. Per root under
`pipeline.gates.verify.repos.<name>.steps`, per package under `…​.packages.<name>.steps`, and
`pipeline.gates.verify.steps` for mono. **Write under `verify`, never at `pipeline.gates` directly** —
that block already holds `ambiguousRequirements`, an unrelated requirements-phase policy, and flattening
the two together would overload one key with two meanings.

- Carry `status`, `cmd`, `cwd`, `required`, `scope`, `timeoutMinutes`, `environmentDependent`, `services`
  and `providedByHook` through unchanged.
- **Keep the `absent` entries.** They are the point: a gate the project does not have must stay visible so
  the run reports it as a coverage hole in `## Findings`. Deleting them to make the config look tidy is
  how a missing gate becomes invisible.
- Set `verify.maxItemMinutes` (default 10). Where a suite's duration is **unknown** — the usual case, since the
  scan never ran it — say so and ask whether to scope it now or start with the full suite and revisit.
  Do not invent a duration.
- Where a gate has `providedByHook`, tell the user plainly that AIDLC's pre-commit layer will **not** be
  installed for it, and why.
- Name every `alsoInCi: false` gate as a local/CI parity gap. Reconciling it is the project's call.

### 3.3 · The `saas` block and the paths it seeds (from each root's `saas`)

Write the resolved constraints onto the repo entry (or the top-level `saas` block in mono):
`tenancy`, `tenantKey`, `tenantIsolationPaths`, `authPaths`, `billingPaths`, `featureFlags`,
`migrations`, `liveDataConstraint`, `apiContracts`, `environments`, `deployStrategy`, `freezeWindows`,
`compliance`, `messaging`, `observability`, and `source: "codebase-scan"`. The config carries **resolved
values, not facts** — the evidence stays in the profile, which is where a reader goes to check it.

Three rules decide whether this block helps or misleads:

1. **Only what the profile evidenced.** An `unknown` fact is **omitted**, not defaulted. This block is
   read as a hard constraint by the implementer, reviewer and security agents, so a guessed `tenancy`
   would misdirect every review from here on — and the most dangerous direction is the reassuring one
   (`single-tenant` when nobody looked is worse than saying nothing).
2. **`source: "human"` means hands off.** As with `conventionsSource`, a block someone authored is never
   overwritten; a disagreement is surfaced as `detected X · configured Y — keep / replace`.
3. **State the consequences, not the fields.** In the summary, say what changes about a run:
   *"tenancy `shared-schema` ⇒ a destructive migration now blocks review"*, *"LaunchDarkly detected ⇒
   the implementer is briefed that user-visible changes ship behind a flag"*, *"`openapi/public-v1.yaml`
   is a contract ⇒ a diff touching it triggers breaking-change review regardless of cadence"*. A user
   approving a list of field names has not been told what they are approving.

**`pipeline.securityReviewPaths` is seeded by UNION, never replaced.** Add every entry of the profile's
`securityReviewPathSeeds` that is not already there and keep everything a human put in. Show the added
paths as their own diff lines with the reason beside each (`src/auth/ — authentication`). This is the
mechanism behind the two criteria that matter most in ADOPT-9: a change to tenant isolation or auth is
security-reviewed **regardless** of the configured cadence, so a path that never reaches this array is a
path recorded as dangerous and treated as routine.

**A compliance regime raises a cadence RECOMMENDATION, not the cadence.** Where `compliance` is
non-empty, recommend raising `pipeline.verification.security` (e.g. `per-epic` → `risk-based` or
`per-item`) and **name the signal that prompted it** — then let the user decide. Gating on an inferred
fact is the higher-risk choice, and a compliance regime silently making every item more expensive is
exactly the surprise that makes a team distrust the tool. Write the new cadence only on an explicit yes.

### 3.4 · Git conventions and `rules/git-workflow.md`

Write the conventions onto the repo entry (or the mono `git` block): `integrationBranch`, `commitStyle`,
`mergeStrategy`, `longLivedBranches`, `hotfixRoute`, `contribution` (`fork` when
`conventions.pushAccess` is `fork-only`) + `upstreamRemote`, and **`conventionsSource`**:

- `"codebase-scan"` where the profile evidenced it,
- `"default"` where the project had none and AIDLC's default is being used — and **say so in the summary**,
  since a default presented as a detected fact is the specific dishonesty this field prevents,
- `"human"` is never written by this command; it means someone else owns the block, and it is a signal to
  leave it alone.

Then render `.claude/rules/git-workflow.md` **from the resolved conventions**, not from the template's
hardcoded assumptions. The shipped template asserts conventional commits, `{type}/{id}-{slug}` branches
and `[KEY-123]` PR titles; a GitFlow shop with `JIRA-123-description` branches and squash-only merges must
get *its* rules. Every line in the rendered file is either detected (cite it) or an AIDLC default (label
it). Where the project's convention **contradicts** an AIDLC default, the project wins — that is the whole
point of adopting rather than imposing.

Two consequences to state explicitly in the summary, because they change how runs behave:

- **`integrationBranch` set** ⇒ feature work branches from and integrates into *that* branch, not `main`.
  One caveat to state, because it is a real gap rather than a detail: the `guard` hook's branch protection
  matches `main`, `master`, `develop` and `release/*` **by name**. If the project's integration branch is
  named something else (`trunk`, `dev`, `integration`), a direct commit or push to it is **not**
  hook-blocked — the pipeline will still route around it correctly, but the safety net does not cover it.
  Say so, and recommend host-side branch protection, which does.
- **`contribution: "fork"`** ⇒ the integration path is push-to-fork + PR-to-upstream; a run will not try
  to push to a remote the user cannot write.
- **A repo whose `protectedBranches` came back `absent`** — the host API answered, and there is no
  protection — has PRs that **merge ungated**. Name it explicitly here, the same way `/aidlc:init` does for
  a `mode: remote` repo with no CI (`init` Step 4.7). Setting the policy needs org permissions, so it may
  stay a tracked devops task; say that rather than implying it is handled. `unknown` (the API was not
  readable) is **not** the same finding and must not be reported as ungated.

### 3.5 · Provenance

Write the `adoption` block: `scannedAt`, `commit`, `profileVersion`, `profilePath`, `depth`, `appliedAt`,
and `unmanaged[]` for anything `--only` left out. This is what makes the next run idempotent and the run
after that able to tell drift from a rewrite. Never hand-author these values — copy them from the profile.

**`appliedAt` is a timestamp, so it would break idempotency if written unconditionally.** Compare the
proposal to the file on disk **with `adoption.appliedAt` excluded from the comparison**:

- **Identical ⇒ write nothing at all.** Report "no changes — this workspace already matches the profile."
  `appliedAt` keeps its original value, the file stays byte-identical, and `git status` is clean. Writing
  a fresh timestamp over an otherwise-unchanged file would turn every re-run into a one-line diff and make
  the no-diff guarantee false.
- **Something else changed ⇒ write, and `appliedAt` advances** to now, because an apply actually happened.

The same rule governs `CLAUDE.md` and `rules/git-workflow.md`: render, compare, and write only on a real
difference. A command that reports "no changes" and leaves the tree clean is the observable proof that
adoption converges instead of churning.

## 4 · Show the diff, get approval, then write

1. **Show it as a diff**, file by file, with each changed value's **evidence inline** (`path:line`, or the
   command and its output). A value the user cannot trace is a value they cannot approve.
2. **List the questions separately** — the `low`-confidence facts and the `unknown`s that matter. Ask
   them (AskUserQuestion where available); a declined question leaves the value absent, which is a
   legitimate outcome, not a failure.
3. **List the conflicts separately**, each as keep / replace / merge, defaulting to keep.
4. **Get explicit approval.** Partial approval is normal: write what was approved, list what was not.
5. **Write, then prove it.** After writing `aidlc.config.json`, **re-read it and `JSON.parse` it** (the
   F49 discipline — a malformed config makes Claude Code skip the whole file, silently disabling every
   AIDLC plugin for the project), and check it against `docs/aidlc.config.schema.json` where reachable.
   `settings.json` is untouched by this command.
6. **Report what changed** — the file list, `git status --porcelain` so the user sees the real change set,
   and the reminder to review and commit it themselves. **Do not commit.**

## 5 · Then what

Say this plainly at the end:

- **The gate is now the project's own.** `/aidlc:run` executes `pipeline.gates.verify` in order; a repo with no
  `package.json` runs its real gate. Every `absent` gate will appear in each run's `## Findings` as a
  coverage hole until the project fills it — that is deliberate, not noise.
- **Work now routes to packages, not just repos.** With `packages[]` written, an item resolves to a
  package inside a repo and its gate, stack and PR label scope to it — the runnable leaf is unchanged
  (one item, one branch, one PR).
- **The runtime constraints are now in every agent brief.** Name the two that change outcomes rather
  than listing the block: a destructive migration is a review blocker where `liveDataConstraint` is
  `expand-contract`, and a diff touching an `apiContracts` / `authPaths` / `tenantIsolationPaths` entry
  is reviewed regardless of the configured cadence. Everything else informs; nothing else gates.
- **Re-running this command against the same commit changes nothing** — literally: no write, a clean
  `git status`, and a "no changes" report (§3.5). Against a later commit it proposes the deltas only.
- **Next, if the scan proposed ADRs:** `/aidlc:adopt-adr` writes the approved ones into `docs/adr/`, each
  with its rationale left for a human. This command does not touch `docs/adr/`.
- **Still not done by adoption:** a debt backlog, drift detection and clean removal
  (`docs/brownfield-adoption.md`, Phase 4). And nothing here remediates a finding — fixing is normal
  pipeline work through the normal doors.
