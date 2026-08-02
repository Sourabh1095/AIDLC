---
name: adopt-apply
description: Turn an approved adoption profile into configuration — aidlc.config.json (topology, repos, monorepo packages[], per-repo and per-package stack, pipeline.gates.verify, git conventions, the SaaS runtime constraints and the security-review paths they seed), CLAUDE.md's project facts and Commands block, and .claude/rules/git-workflow.md — behind a full shown diff and an explicit approval, merging rather than overwriting anything a human authored. Applies drift deltas on a re-adoption, upgrades a config written by an older plugin version in place, supports partial adoption with --only, and records what it wrote so removal can be clean. The write half of brownfield adoption: /aidlc:adopt reads the code and derives the facts, this applies them. Use after /aidlc:adopt, or to re-apply an updated profile.
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
- **Staleness check — compare the *code*, not the commit hash.** Different commits do **not** mean
  stale facts: `adopt` §10 requires the profile be git-tracked, so committing it is what moves HEAD, and a
  raw hash comparison therefore fires on **every** correctly-followed adoption. A check that cries wolf on the
  happy path teaches the user to dismiss it, and then the one time code really has moved it gets dismissed
  too. So ask whether anything outside the adoption artifacts moved:
  
  ```
  git -C "<control plane>" diff --name-only <scan.commit>..HEAD -- . ':(exclude).aidlc/adoption/'
  ```
  
  - **Empty** ⇒ the profile still describes the workspace. Say so in one line — *"the profile is 1 commit
    behind HEAD, and that commit is the one that recorded it"* — and carry on.
  - **Non-empty** ⇒ the code genuinely moved. Name the paths, say what that means for this command
    (a derived value may no longer match the code), and offer to re-scan first. Proceed only if the user chooses to.
  
  `skills/adopt/converged.mjs` exports `onlyAdoptionArtifactsMoved()` for this, so the three commands that
  read a profile all answer it the same way.
- If the profile records `scan.writes.sessionOnly: true` there is no file to load — ask the user to
  re-run the scan in a writable workspace.
- `--only <repo|package>` scopes this run to one surface. Record the scope **positively** in
  `adoption.only` and every excluded surface in `adoption.unmanaged` — a pilot on one repo of six leaves
  five roots that are neither configured nor excluded, and without both lists a later reader cannot tell
  a deliberate pilot from an adoption that fell over halfway.
- **If the profile carries a `drift` block, read it first — it changes what you may propose.** A
  `changes[]` entry is not a value to apply; it is an instruction about one:

  | `action` | What this command does |
  |---|---|
  | `propose` | Include it in the diff, with its `was → now` and evidence |
  | `report-only` | List it in the summary and **propose nothing** — an unmanaged surface, or a difference configuration cannot express |
  | `leave-alone` | **Do not touch that key, and do not show it as a conflict.** `source: "human-edit"` means somebody changed it deliberately after the last apply. Name it once in the summary as *"left as you set it"* so the silence is legible, then move on |

  Getting the last row wrong is the failure this block exists to prevent: a hand-tuned gate command
  reverted under a diff that reads like routine convergence is a change nobody catches in review.

## 2 · Read what already exists — the merge baseline

Before proposing anything, read the current state of every file you would touch: `.claude/aidlc.config.json`,
`CLAUDE.md`, `.claude/rules/git-workflow.md`.

### 2.1 · Upgrade an older config first, as its own diff

A config written by an earlier plugin version may not have the shape this command writes into. Merging
new keys beside stale ones produces a file that is half one contract and half another — which reads as
working and fails at the first consumer that trusts the wrong half. So resolve the version **before**
the merge, and as a **separate, smaller diff** the user can approve on its own.

**Do not hand-derive the classification or the moves** — `aidlc:upgrade` ships the migration as a
tested module, and this command and that one must not drift into two different answers about what a
legacy config becomes:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/upgrade/plan-upgrade.mjs" . --plugin-root "${CLAUDE_PLUGIN_ROOT}" --json
```

Read its `config` block: `shape` (`current` · `legacy` · `older` · `newer`), the `signals` that
classified it, the `changes` (one line per key that moves), and any `conflicts`. Two properties of that
module are load-bearing here, so know them rather than re-deriving them:

- **It relocates; it never rewrites.** Every gate command survives verbatim. A genuine value change
  comes back as a `conflict` and is applied to nothing — that is a case for the table below, defaulting
  to keep.
- **`pipeline.gates.ambiguousRequirements` is deliberately left where it is.** It is a
  requirements-phase policy that has always lived at `pipeline.gates`, and moving it under `verify`
  would silently disable it (`run` §4 reads the original path).

A `newer` shape means the config was written by a plugin ahead of the one installed: stop and say so.
Migrating downward would drop keys this version cannot see.

Then: **show the moves as a list** and get approval for the upgrade *before* proposing anything else.
Applying it (`--write`) also records it in `adoption.upgrades[]` with `from` (`"unstamped"` where the
file carried no version), `to`, the plugin version and the change lines — so somebody six months from
now can see which keys moved without diffing releases.

**An upgrade is worth doing alone.** If the user approves the upgrade and declines the rest, write the
upgrade, stamp `configVersion` + `aidlcVersion`, and stop. That is a complete, useful outcome — and it
is exactly what `/aidlc:upgrade` does on its own for a project that never went through adoption.

Stamp `configVersion` and `aidlcVersion` on every write from here on, upgrade or not.

### 2.2 · Classify every value you intend to write

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

### 3.0 · `project` and `workItems` — the two the schema requires, and the one you must never invent

`docs/aidlc.config.schema.json` marks exactly two top-level keys **required**: `project` (`key`, `name`)
and `workItems` (`source`). Everything else in §3 is optional. Write these **first**, or the config you
assemble fails the schema check §4.5 tells you to run — and `/aidlc:adopt-backlog`, the next command in
the sequence, has no adapter to resolve.

Usually `/aidlc:init` wrote them already; then they are existing values and a disagreement is a conflict
for §2.2's table, defaulting to keep. When they are absent — `init` Step 3.0 offers adopt as one of three
setup paths, so this happens — derive them:

- **`workItems.source`** from the profile's `tracker` surface: `markdown` · `jira` · `ado`. An unsupported
  tracker is **not** a blocker (§7 of the scan): offer the markdown backlog with the trade-off stated.
- **`project.name`** from the workspace or the dominant repo, and say which you used.
- **`project.key` is the uppercase work-item ID prefix, and it must never be inferred from a repo name.**
  Read it from the **IDs the existing board already uses** — `backlog/PLAT-14-….md` with `id: PLAT-14`
  means the key is `PLAT` — or from the Jira/ADO project. The prefix a codebase *looks* like it should
  have is routinely not the one its board uses: a workspace whose package names, commit subjects
  (`ACME-402:`) and CODEOWNERS all say `ACME` can have a board keyed `PLAT`, and nothing downstream
  cross-checks a created item's prefix against the items already there. Get it wrong and every item
  `/aidlc:adopt-backlog` files is misfiled, silently. If no board exists to read it from, **ask** — this
  is exactly §2.2's `low`-confidence rule, and a guess here is expensive in a way that is hard to undo.

### 3.1 · Topology, repos and stack (from `workspace` + roots)

- `workspace.layout` from `workspace.topology`: `poly` for many repos, `mono` for `single-app`, and `mono`
  for a `monorepo` root (one git repo) — with its packages carried on the repo entry, not as a new layout
  value.
- `repos[]` from roots classified **`product-repo` or `monorepo` only**. Never from a `control-plane`,
  `non-repo`, `reference-only`, or `not-cloned` root; each excluded root gets one line in the summary
  saying why. The `control-plane` exclusion is the one that bites hardest if it slips: the control plane
  is usually its own git repo, so it *looks* like a product repo, and admitting it to `repos[]` makes it
  a routing target — `/aidlc:run` then dispatches work to a repo with no code.
- `repo.path`: **absolute** when `nestedUnderControlPlane` is false, relative otherwise. Carry
  `role` (from the derived one-liner), `labels`, per-repo `stack`, `host`, `defaultBranch`, and
  `mode` — `local` where `vcs.remotes` is `absent`, `remote` where a remote exists.
- **`repo.name` and the profile's root name are two different namespaces — record the mapping.** A root
  name comes from the `.code-workspace` `name` override, which `adopt` §1 honours, so a root called
  `billing-api` can become the repo `api` here. Everything in the profile that points at a repo —
  `debtFindings[].root`, `adrCandidates[].root` — uses the **root** name. Set
  **`repos[].adoptedFromRoot`** whenever the two differ, so `/aidlc:adopt-adr` and
  `/aidlc:adopt-backlog` can resolve through it.

  **Then cross-check it before you write:** every `debtFindings[].root` and `adrCandidates[].root` in the
  profile must resolve to a `repos[]` entry, by `name` or by `adoptedFromRoot`. Report any that does not
  — it is an error, not a footnote. An item stamped with a repo name that matches no entry does not fail
  loudly: `resolve-gate.mjs` returns an **empty step list**, so the item runs no gate at all and reports
  green. A perfect-looking item that verifies nothing is the most expensive thing this command can
  produce.
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
- **Keep the `not-applicable` entries too, and say what they mean.** A step the stack cannot have is
  carried through so the run can list it as not applicable rather than silently omitting it — but it is
  **not** a coverage hole and must never be reported as one. In the summary, separate the two counts:
  *"`api`: 5 gates — 3 present, 1 coverage hole (`typecheck`), 1 not applicable (`build`, a Django
  service is deployed from source)."* Collapsing them is how a team gets a permanent finding they
  cannot close, and how `/aidlc:adopt-backlog` comes to propose "add a build gate" as real work.
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

**`pipeline.securityReviewPaths` is seeded by a THREE-WAY union, never replaced, and never blindly.**
This is the mechanism behind the two criteria that matter most in ADOPT-9 — a change to tenant isolation
or auth is security-reviewed **regardless** of the configured cadence — so a path that never reaches this
array is a path recorded as dangerous and treated as routine. Use the tested resolver, not a set union:

```
node "<plugin>/skills/adopt-apply/seed-paths.mjs" .claude/aidlc.config.json .aidlc/adoption/profile.json
```

A plain union protects a path a human **added** and destroys a path a human **removed**, because union
only ever adds. `/aidlc:adopt` §9 names *"a deliberately narrowed `securityReviewPaths`"* as precisely the
human edit that must never be reverted — and the drift machinery cannot catch this one, because of a
scalar/set asymmetry: for a scalar, *"config differs from the baseline-derived value"* attributes the
change to a person, but for a set "differs" does not say which **direction**. So `adoption.seeded.
securityReviewPaths[]` records what **we** contributed, which makes the comparison three-way:

| Seed in the config? | In `adoption.seeded`? | What to do |
|---|---|---|
| no | **no** | genuinely new — **add it**, with the reason beside it (`api/acme/auth/ — authentication`) |
| no | **yes** | we seeded it and it is gone, so the team removed it on purpose — **leave it out**, and name it once as *"not re-added: you removed this after the last apply"* |
| yes | either | already there — no diff |

Everything a human added stays either way; this only ever decides what *we* contribute. A withheld seed
**stays in the manifest** — it is the record of "we offered this and the team said no", and dropping it
would re-add the path on the following run. With **no** manifest (a config written before this key
existed) the resolver falls back to plain union and **says so**, which is the conservative direction for a
security array: a false positive costs one review, a false negative costs a missed one.

**A compliance regime raises a cadence RECOMMENDATION, not the cadence.** Where `compliance` is
non-empty, recommend raising `pipeline.verification.security` (e.g. `per-epic` → `risk-based` or
`per-item`) and **name the signal that prompted it** — then let the user decide. Gating on an inferred
fact is the higher-risk choice, and a compliance regime silently making every item more expensive is
exactly the surprise that makes a team distrust the tool. Write the new cadence only on an explicit yes.

### 3.3b · `team.mode` — ask, never infer

The profile's `conventions.activeAuthors` is a **signal, not a verdict**, and it is wrong in both
directions often enough that writing it silently would be a bug: an inherited repo shows a dozen
historical contributors with one active maintainer, and a repo a team just created shows one. So put the
count in front of the user and let them answer:

> *"6 authors committed in the last 90 days. Is this a shared project? (`team.mode: shared` scopes
> `/aidlc:next` to your assigned items, floors ceremony at `tracked`, and makes grooming propose AC
> changes rather than apply them.)"*

On `shared`, collect `team.me` — default it from `git config user.email`, confirm it matches what the
tracker stores (`aidlc:work-items` → *Ownership*), and say plainly that a wrong value yields an empty
queue that looks like an empty backlog. On `solo`, write `team: { mode: "solo", me: "" }` and stop; every
team behaviour is dormant behind that flag.

Two consequences to state at the same time, not later: `pipeline.ceremony` floors at `tracked` in shared
mode unless explicitly set, and `source: markdown` earns a warning (the backlog becomes git files several
people groom concurrently). Neither is a block.

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

### 3.5 · Provenance, and the manifest that makes removal possible

Write the `adoption` block: `scannedAt`, `commit`, `profileVersion`, `profilePath`, `depth`, `appliedAt`,
`only[]` and `unmanaged[]` for a partial adoption, `upgrades[]` from §2.1, and **`seeded`** from §3.3 —
the record of what adoption contributed to each union-merged array, without which the next apply cannot
tell a path the team removed from one it never saw. This is what makes the next
run idempotent and the run after that able to tell drift from a rewrite. Never hand-author these values —
copy them from the profile.

**Also record `adoption.writes[]` — one entry per file you touched, with how you touched it.** This is
the manifest `/aidlc:remove` reads, and without it a clean removal is impossible rather than merely hard:

| `ownership` | Meaning | What removal may then do |
|---|---|---|
| `created` | The file did not exist; adoption made it | Delete it |
| `merged` | The file was the project's; adoption added sections or keys | Revert **those sections**, listed in `sections[]` — and nothing else |
| `rendered` | AIDLC-owned, generated from config (`rules/git-workflow.md`) | Delete, after showing any drift from what was last rendered |

The `merged` row is the whole point. Without `sections[]`, removing AIDLC from a project means guessing
which `CLAUDE.md` lines and which `permissions.allow` entries were ours — and the safe-looking guess
(delete the file) destroys content the team wrote. Be specific: `"CLAUDE.md ## Commands"`,
`"CLAUDE.md ## Project facts (4 bullets)"`, `"permissions.allow[+12 entries]"`.

**Timestamps would break idempotency if written unconditionally, and `appliedAt` is not the only one.**
Compare the proposal to the file on disk with the run-to-run fields excluded — use the shared, tested
rule rather than re-deriving the exclusion list here:

```
node "<plugin>/skills/adopt/converged.mjs" .claude/aidlc.config.json <candidate>.json --config
```

Excluded: **`adoption.appliedAt`** *and* **every `adoption.writes[].at`**. That second one is easy to
miss and worse than the first, because this command **rebuilds the whole manifest every time it runs** —
so each re-apply produced three fresh timestamps, differed from disk, wrote, advanced `appliedAt`, and
did the same again next time. Deliberately **not** excluded: `adoption.scannedAt` (it comes from the
profile, so it changes only when the profile really moved) and `adoption.upgrades[].at` (that array is
history — appended when an upgrade happens, never rebuilt, so a no-op re-apply adds nothing to it; if
you ever rebuild it, add it to the list in `converged.mjs` rather than here).

Then:

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
  coverage hole until the project fills it — that is deliberate, not noise. A `not-applicable` gate will
  not: it is listed once as inapplicable to the stack and never counted as a hole.
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
- **Next, if the scan found debt:** `/aidlc:adopt-backlog` proposes it as work items, deduped against the
  board. This command does not touch a tracker.
- **If this was a partial adoption**, say which surfaces are unmanaged and that a later scan will report
  them as unmanaged-by-choice rather than re-proposing them. Widening the scope is another
  `/aidlc:adopt-apply --only <surface>`.
- **If the evaluation ends**, `/aidlc:remove` reverses this: it reads the `adoption.writes[]` manifest
  written above, deletes what adoption created, reverts only the sections it merged, and leaves the
  project's own files untouched.
- Nothing here remediates a finding — fixing is normal pipeline work through the normal doors.
