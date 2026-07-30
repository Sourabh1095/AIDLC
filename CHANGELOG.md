# Changelog

All notable changes to the Bee-Logical Claude AIDLC marketplace.

> **Rebrand note:** this project was formerly named **SDLC** (marketplace + `sdlc` plugin, `/sdlc:`
> commands, `.sdlc/` state, `sdlc.config.json`). It was renamed to **AIDLC** (AI Development Life Cycle)
> in **0.19.0** — see that entry. CHANGELOG entries below 0.19.0 describe releases made under the old
> SDLC name; the version numbers are unchanged, only the name differs.

## [0.36.0] — 2026-07-31

### `aidlc` — ceremony is proportional to consequence (the adoption fix)

Every release up to here made the pipeline *better*. This one makes it **usable**, which turned out to be
a different problem.

**The gap, in the framework's own words.** `do/SKILL.md` said:

> *"Small changes are not an exception: one item → one branch → one PR still applies (per
> `rules/git-workflow.md`, "even one-liners"). If that feels heavy for a typo, that is a real finding
> about the pipeline — **raise it via `aidlc:dogfood`, don't route around it**."*

That instructed the user to **file a complaint instead of getting their typo fixed**. Nobody files the
complaint. They stop using the tool — and the real cost is not the typo: a pipeline that is unpleasant for
small work loses the audit trail on the **large** work too, because people route around it for everything
or uninstall it. The rigidity wasn't one line, either: `intake` said *"NEVER start implementing from a raw
requirement — items first, always"* and *"never code directly"*; `rules/git-workflow.md` said *"Even
one-liners"*; and `templates/project/CLAUDE.md` carried the heading **`## AIDLC workflow (mandatory)`** —
which lands in **always-loaded context**, so every session opened by telling the model the ceremony was
compulsory.

**The fix — four tiers, picked and announced, never argued** (new `aidlc:ceremony`, D10). It mirrors how
Claude Code itself works: answer → edit → commit → PR, with the user choosing where to stop.

| Tier | Produces | For |
|---|---|---|
| **answer** | nothing | questions, opinions, diagnoses |
| **direct** | a gated commit on the current branch | typos, renames, a log line, an obvious one-liner |
| **tracked** | branch + run file + commits, PR optional | real work nobody needs a ticket for |
| **full** | the pipeline, unchanged | stories, features, team-coordinated work |

- **`/aidlc:do` gained a DIRECT route** and does that work itself — edit, run the project's resolved gate,
  commit, report in four lines. It is now the only place in the framework where `do` writes product code,
  and deliberately so.
- **Committing on the default branch is allowed at tier 1**, because the risk being managed is
  *irreversibility*, not ceremony: a local commit is `git reset` away, and the branch-aware push guard
  still stands between it and anyone else. D6 is restated accordingly — the invariant that survives every
  tier is **"nothing reaches the default branch unattended"**, which is narrower and sharper than "one PR
  per change".
- **`pipeline.ceremony` sets the floor** — `direct` (default) · `tracked` · `full`. It only ever *raises*
  the tier. Absent config resolves to `direct`, so no project needs migrating; `full` reproduces
  pre-0.36.0 behaviour exactly for a team that wants it.
- **De-escalation is first-class, which is the actual behavioural change.** *"just do it"*, *"no ticket"*,
  *"no PR"* are **instructions, not objections to argue with**: drop to the tier named, confirm in one
  line, proceed. Explicitly prohibited — selling the user the tier they just declined, asking twice, and
  quietly re-adding the ceremony later in the same run.
- **Promotion keeps starting light safe.** *"track this"* creates the item and links the commits already
  made, so a tier-1 change that turns out to matter is never trapped at its tier.

**What deliberately did NOT scale down** — the two properties that make this lenient rather than sloppy:

1. **The project's gate runs at every tier**, `direct` included, resolved from the project's own commands
   (`resolve-gate.mjs`). Ceremony is what was cut; verification wasn't.
2. **Five escalation triggers override the floor *and* the user's stated preference**, because each names
   something **not recoverable by noticing it later**: auth/tenant-isolation paths, a destructive migration
   under `expand-contract`, a declared `apiContracts` path, code an in-flight run already owns, and an
   explicit pipeline request. None fire on an absent config field — the pipeline still never invents a
   constraint it has no evidence for. Choosing `direct` is not choosing to be careless; it is choosing not
   to file a ticket for a typo.

**Rewritten at the source, not patched over:** `do` (DIRECT route, tier announcement, the dogfood line
deleted), `intake` (both absolutist rules, now scoped to *this door* rather than to every change),
`rules/git-workflow.md` ("even one-liners" → tier-aware, push-focused), `git-workflow` (scoped to tracked
work up front, so the branch/PR machinery isn't applied to a typo), `run` (states it *is* tier 3 — an
explicit pipeline request is honored, never optimized down), and the project `CLAUDE.md` template (the
`(mandatory)` heading is gone; the always-loaded lines now lead with proportionality). `/aidlc:init` asks
about it at step 5b and is told **not** to present `full` as the "serious" option, because it isn't.

**Unchanged by design:** 0.35.0's fan-out is internal (it never asked the user for ceremony), and
contract-first only applies when a feature is already being decomposed — under the tier model it simply
does not fire below tier 3.

## [0.35.0] — 2026-07-31

### `aidlc` — concurrency inside a single feature: fan-out across files, and frontend beside backend

Until now AIDLC parallelized exactly one thing: independent backlog **items**, via `/aidlc:sprint`.
Inside a feature everything was serial — one implementer per item, and a frontend child chained behind
its backend sibling. Both were defensible, and both were serializing more than the underlying risk
required. This release adds concurrency at two finer grains, each with the safety property it actually
needs rather than the one it inherited.

**1 · The implement phase fans out across provably disjoint files** (`pipeline.implementFanout`).

Ask for *"pagination on every table"* and the plan is a shared component plus one task per screen. Those
screens never touch each other, and D7 was serializing them anyway. Reading D7 again shows why: it
serializes what *mutates a shared tree*, and **the shared thing is git, not the code**. Two agents
racing `git add`/`commit` in one checkout collide; two agents editing `users.tsx` and `orders.tsx` do
not. So the fix removes the racing committer, not the parallelism.

- **The agents edit and report; the orchestrator commits.** Each fan-out implementer gets one plan task
  and a **path allowlist**, must not touch anything outside it, and must not commit or stage. The
  orchestrator commits each task's declared paths in plan order. **One writer to git, always** — and
  still one item, one branch, one PR, so the review unit is unchanged.
- **The gate runs once, after the window lands** — not per agent. A window is a partial change by
  construction, so a mid-window gate failure says nothing, and running the full suite N times is the
  most expensive way to learn that.
- **`skills/run/resolve-fanout.mjs` computes the schedule** (55 test cases pin it), for the same reason
  `resolve-gate.mjs` exists: the failure mode is silent. Two agents handed overlapping paths do not
  error — they interleave edits and the loser's work vanishes mid-file, with the tests passing against
  whatever survived. It refuses to guess three things, each chosen against the asymmetry that
  over-serializing costs wall-clock and *says so*, while under-serializing loses code and says nothing:
  a task with **no declared paths** is never parallelized; **two globs** that can't be compared cheaply
  are assumed to overlap; and **disjoint paths do not imply independence** — a task whose output a later
  task imports must declare `foundation`/`dependsOn`, because no path analysis can see an import edge.
- **Aggregators stay single-writer** by default: manifests and lockfiles, barrel modules (`index.ts`,
  `__init__.py`, `mod.rs`), route tables, i18n catalogs, global styles, tool config, snapshots,
  migrations, and every path in `saas.apiContracts`. `implementFanout.sharedPaths` is where a project
  names **its own** aggregator (a central theme file, a generated registry) — the one setting a stranger
  to the codebase cannot infer.
- **Order is never rearranged.** The resolver only collapses *contiguous* plan tasks into a window, so a
  plan read top to bottom still describes what happens. The run file records the schedule
  (`fanout: 1 -> [2|3|4] -> 5`), and every serialized task carries a stated reason.
- Plans now declare `paths:` per task (`aidlc:planning`, `aidlc:run` §5). `planning` already asked for
  the files a task touches — *"a plan that never names a file is a guess"* — this makes that answer
  load-bearing instead of advisory.
- **Undeclared writes are a finding, not a shrug.** After a window, `git status` must be clean; anything
  left over is a path an agent touched without declaring, and it goes into `## Findings` as a fan-out
  contract violation — an undeclared write is precisely what the disjointness proof assumed away.
- Defaults: **enabled**, `maxAgents: 3` (hard cap 5, mirroring `sprint` — one item must not spawn a
  fleet), `minGroup: 2`. Absent config resolves to those, so **no existing project needs migrating**;
  `enabled: false` restores pre-0.35.0 behaviour exactly.

**2 · Frontend and backend are built at the same time, against a contract that lands first** (D9).

`intake`/`planning` authored `frontend dependsOn backend` reflexively. That edge is right about the
dependency and wrong about its price: it serializes a whole feature to protect one unknown — the
response shape. The tempting alternative, *start both and reconcile at the end*, is worse: two agents
that each wrote code against a shape they guessed don't "sync", one of them gets rewritten, and which
one is decided by whose work is cheaper to discard. **Coordination after the code is the expensive place
to put it.**

- **Decomposition emits three children, not two:** a small **contract child** (OpenAPI path, GraphQL SDL
  type, `.proto` message, JSON Schema, or an exported type in a declared shared package) as a normal
  single-repo leaf, then backend and frontend each `dependsOn` **the contract** and **not each other**.
  That is the edge that makes them concurrent — `sprint`'s independence check reads `dependsOn`, and in
  poly they were already in separate repos.
- **The frontend never idles on a running backend:** its AC are satisfiable against generated types and
  contract-derived fixtures. Without that, the serialization returns through the back door.
- **A ready wave runs as a wave.** `run` §2.5 no longer walks ready children one at a time: once a wave's
  dependencies are terminal, its children are independent *by construction* — that is what the graph
  asserts — so the wave goes to `/aidlc:sprint`. Walking it serially isn't safer, just slower.
- **The join, which is the cost this design pays.** Neither child's own green run proves the feature
  works — each was verified against the contract, never against the other. So the epic/feature
  consolidation pass (§2) now runs an **integration join**: the project's contract tests, or the e2e path
  exercising the real call, resolved from the repos' own gates (**no test framework is invented** for a
  project that has none). A project with neither gets a **`MAJOR` finding, not a pass** — with both sides
  built in parallel the contract is the only thing holding them together, and a team that can't test the
  seam should know that is what it chose. A red join is a feature-level blocker; the parent never closes
  over one.
- **The corollary saves the most time and is the easiest to miss:** where the interface **already exists
  and the feature doesn't change it**, there is **no contract child and no edge at all** — both sides
  start immediately. `sprint` is told explicitly not to re-derive a frontend-waits-for-backend edge from
  item titles or from the fact that one calls the other's API; the contract is the artifact that removed
  that edge, and re-adding it there silently undoes the decomposition.

**Also:** `docs/aidlc.config.schema.json` documents `implementFanout`; the run-file template and
`aidlc:run-state` carry `fanout:` and the per-task `paths:` shape; `aidlc:init` asks about fan-out (step
8); `aidlc-implementer` gains *Fan-out mode* with the allowlist/no-commit contract and a matching
carve-out in its Finish contract, which otherwise mandates the commit it must not make; D7 is narrowed
rather than repealed, and D9 is new. Total suite: **549 test cases**, all passing.

**Not included, deliberately:** `/aidlc:adopt` does not yet *derive* `sharedPaths` from a codebase scan.
It could — aggregators are visible to a scan — but that is its own feature, and the built-in list plus a
documented knob is safe without it. Adoption also needs no migration: absent config resolves to defaults.

## [0.34.5] — 2026-07-31

### `aidlc` — the pipeline can no longer start itself, and QA stops moving the diff under the reviewer

Two defects found by reading the orchestrator against its own D7, rather than by a run. Neither would
ever have failed loudly: one hands the framework a door it did not mean to open, the other produces
review findings that are merely *wrong*.

**1 · `/aidlc:run` was model-invocable.** Every other writing command — `init`, `adopt*`, `sprint`,
`sync`, `repo`, `promote`, `remove`, `bootstrap` — carries `disable-model-invocation: true`. The one
command that branches, commits, pushes and opens a PR did not, so the model could enter the full
pipeline on its own because a prompt *sounded* like work. The blast radius is the largest in the
framework and the trigger was a description match.

- **`run` now carries the flag**, and a new *Entry is deliberate* section names its three doors, all of
  them a human choosing the pipeline: a typed `/aidlc:run`, `sprint`'s headless
  `claude -p "/aidlc:run {ID}"` (a typed prompt in a fresh session, so the flag doesn't bind), or an
  explicit handoff from a sibling skill the user invoked.
- **The flag blocks the Skill tool, which would have broken those handoffs** — `aidlc:next` §5,
  `aidlc:do` §5 (BUILD *and* RESUME) and `aidlc:intake` §4 all continue into the pipeline in-session.
  All three now hand off by **reading `${CLAUDE_PLUGIN_ROOT}/skills/run/SKILL.md` and following it
  verbatim**. This is the better mechanism regardless of the flag: the instruction to enter the pipeline
  is *written down* instead of left to the model's discretion. Fixing the flag without this would have
  silently dead-ended `/aidlc:next`.
- `/aidlc:do` stays deliberately open — it grounds before it routes and creates nothing on its own,
  which is exactly what a front door should be, and it is now where a misinferred `run` gets redirected.

**2 · QA was batched in parallel with the reviewer, and QA commits.** §7 said *"dispatch the due agents
in ONE parallel batch"*; `docs/architecture.md` justified it with *"they only read the diff, so there's
nothing to collide on"*. That is true of the reviewer and security and **false of QA**, whose verify mode
authors tests and commits them (`aidlc-qa` → *Verify mode*, steps 2 and 4). So new commits moved `HEAD`
while the reviewer was mid-review: findings written against a diff that no longer existed, two agents
committing to one branch, and no failure — just a review of the wrong thing.

- **§7 now dispatches in two steps:** reviewer + security in one parallel batch, then **QA after it
  returns**. Fix cycles re-dispatch in the same order. One agent due → no batch; QA alone → run it alone,
  since the ordering exists to protect the reviewer.
- The reviewer's subject is restored to what it should be: **the diff the implementer produced**. QA's
  tests are not part of it.
- `aidlc-qa`'s own contract said *"parallel with the reviewer"* — corrected at the source, with the
  reason, so the agent knows the branch is its alone while it works.
- `docs/architecture.md` D7 carried the false premise and now states the rule it was already claiming to
  follow: **isolation, not similarity**. All three agents look alike (they are all "verification"), which
  is why batching them read as obvious — but only one mutates the tree, and that is the sole deciding
  property. D1 gained the entry-contract half of defect 1, plus the point that the main session is where
  the interactive gates (`ask` mode, security confirm, local-merge confirm, cross-repo split) can exist
  at all: as a subagent each would silently take a default.

Both fixes are prompt-and-contract changes, so the 8 script test suites (all passing) cover neither —
the guard is that each claim is now stated in the one place the actor reads.

## [0.34.4] — 2026-07-31

### `aidlc` — the orchestrator now knows the brownfield door exists

0.34.0–0.34.3 made brownfield adoption work and proved it. This makes the framework *reach for it*, and
corrects the docs those four releases made stale.

**The gap.** `/aidlc:do` — the general front door, which grounds before it routes — handled a missing
config with one line: *"tell the user to run `/aidlc:init`, stop."* No distinction between an empty folder
and an existing codebase. So a user who opened a workspace holding four repos and asked for a change was
pointed at the greenfield setup path, and the brownfield door existed without anything routing to it —
which is exactly the failure the epic was written to prevent: topology, stack, gate commands and git
conventions answered from memory about a codebase nothing has read, then written into `CLAUDE.md` as
ground truth. `/aidlc:next` had the same gap, and neither `sprint`, `status`, `intake`, `groom`,
`planning` nor `requirements` mentioned adoption at all.

- **`do` §1 now looks at the folder before it answers.** Existing code (a manifest, or a `.git` with
  history, here or one level down) ⇒ say *`/aidlc:init` choosing "there's existing code — scan it"*, which
  routes to `/aidlc:adopt` — and say that **one scan covers every repo in the workspace**, so nobody is
  told to adopt them one at a time. An empty folder ⇒ `init` then `bootstrap`. It also gained a grounding
  step for a config that **came from a scan**: `architecture.resolvedBy: "codebase-scan"` means `repos[]`,
  `packages[]`, `pipeline.gates.verify` and `saas` are evidenced and should be trusted over a fresh read
  of the tree — and a staleness note that compares `adoption.commit` to HEAD **excluding
  `.aidlc/adoption/`**, since committing the profile is itself what moves HEAD.
- **`next` gained a step 0** with the same discriminator: picking "the next item" from a project that was
  never set up is not a useful answer.

**Docs corrected, including two lines these releases made wrong.**

- `docs/user-guide.md` said *"a gate you don't have is recorded `absent` and reported per run as a coverage
  hole"* — true but now incomplete, since `not-applicable` exists and is deliberately **never** a finding.
- It also described `/aidlc:remove` verifying with `git diff` that your files are untouched, which is the
  behaviour 0.34.2 replaced: the check is now `git status` ⊆ the approved plan, plus a per-file comparison
  against `git show <adoption.commit>:<file>` where any remainder is **your own edits**, shown to confirm.
- The `saas` row now notes that a security-review path you delete on purpose stays deleted.

**Docs extended**, so the mechanics stop living only in the design spec:

- `docs/adoption-guide.md` gains a table of what adoption does with **each kind of root** it finds
  (product repo · monorepo → `packages[]` · control plane, excluded from routing by name · non-repo ·
  not-cloned · outside the control plane → absolute path), a note that discovery reads the JSONC
  `.code-workspace` **and** scans for nested repos because using one alone collapses a six-root workspace
  into one, the `--add-dir` reachability point, and a new *Reading the profile and the config it produces*
  section covering the five values that mean something narrower than they look: the three gate statuses,
  the four support values, `adoption.writes[]`, `adoption.seeded` and `repos[].adoptedFromRoot`.
- Its **Polyrepo** section now tells a brownfield reader not to hand-fill `repos[]` at all — adopt derives
  every field with evidence, including the ones easiest to get wrong from memory.
- `README.md` states the claim directly (brownfield and multi-repo are the same door; the unit is the
  workspace) with an honest **verification status**: every command run end to end against a purpose-built
  multi-root fixture, 14 defects found and fixed, 373 guarding test cases — and no adoption of a real
  third-party repository yet.
- `docs/brownfield-walkthrough.md` shows all three gate statuses where a reader first meets them, since a
  Django service really does have `build: not-applicable`.

## [0.34.3] — 2026-07-31

### `aidlc` — brownfield: the last two adoption commands, and two more defects

0.34.0–0.34.2 ran the scan, the apply, and the drift/upgrade/removal legs against a live fixture. This
closes the set: **`/aidlc:adopt-adr`** and **`/aidlc:adopt-backlog`**. Two more defects, both about routing
and naming rather than about the artifacts themselves — and both invisible. **Every command in the adoption
set has now been run end to end.** Spec: `docs/brownfield-adoption.md`.

**`/aidlc:adopt-adr` came through clean — the only command in the set that did.** Numbering continued from
the fixture's existing `0007` without restarting; all five ADRs carry `accepted (retroactive)`; `## Rationale`
and `## Alternatives considered` are the verbatim *"not recorded — confirm with the team."* in every one,
checked mechanically; the two already-recorded candidates were listed rather than dropped; the external RFC
and Confluence page were linked from the index and never copied; and one candidate was skipped with a
stated reason, after which a re-run proposed only that one.

**`/aidlc:adopt-backlog`'s board sweep produced the most useful output of any adoption command so far**, and
it was not a finding: **`PLAT-40` is closed** with every criterion ticked including *"no credential literal
remains in any script"* — and the credential is still there, still in history. The new item references
PLAT-40 so a reviewer sees the history rather than re-litigating it. Meanwhile **`PLAT-14` is open** for a
typecheck gate that has since shipped, so it was not proposed and closing it was recommended. Neither is
derivable from the code.

- **All three staleness checks compared raw commit hashes**, so `adopt-apply`, `adopt-adr` and
  `adopt-backlog` each announced *"the code has moved since these facts were true"* on every
  correctly-followed adoption — because the one commit between `scan.commit` and HEAD was the commit that
  **recorded the profile**, which §10 requires be tracked. Nothing outside `.aidlc/adoption/` had moved. It
  never errors and each warning is individually plausible; the damage is cumulative, because a check that
  cries wolf on the happy path teaches the user to dismiss the one that matters. This is the same
  self-referential trap 0.34.0 fixed in the convergence rule, in a second mechanism the fix did not reach.
  All three now use the `onlyAdoptionArtifactsMoved()` predicate that already existed.
- **Profile root names and config repo names are different namespaces, so adoption-born items routed to
  nothing.** `adopt` §1 honours the `.code-workspace` `name` override (root `billing-api`), while
  `adopt-apply` derives `repos[].name` (`api`). Findings and candidates carry the **root** name, and
  `adopt-backlog` §3 said to use it as the repo — so `resolve-gate` returned **`(nothing runnable)`**. The
  item is created successfully and looks perfect on the board; it fails only when someone runs it, and it
  fails **silently green**, because an empty gate has nothing to execute and nothing to fail. The feature
  that causes it is the `name` override, which exists to make the profile readable — so the more carefully
  a team names their folders, the more certainly their adoption-born work is misrouted. Fixed with an
  explicit mapping (**`repos[].adoptedFromRoot`**), resolution rules in both downstream commands, and a
  cross-check in `adopt-apply` that every finding and candidate root resolves to a real entry — an error,
  not a footnote.

**Open questions 4 and 5 are now answered from experience** rather than guessed, and both answers argue
*against* tightening the caps. The full reasoning is in the spec; briefly: a retroactive ADR's value is its
evidence and observed consequences, not its blank rationale, and the discriminator for whether a finding
becomes an item is **"can you name what goes wrong if nobody does this?"** — not severity. Two `low`
findings were proposed and a `medium` was skipped on exactly that test.

**Suites:** 373 cases across five files.

## [0.34.2] — 2026-07-31

### `aidlc` — brownfield: the drift, upgrade and removal legs, and two more defects

0.34.0 fixed the adoption scan against a live run and 0.34.1 the write half. This closes ADOPT-12: the
**drift**, **in-place upgrade** and **clean removal** legs, including the one the spec had singled out as
least testable by fixture — `human-edit` drift, which *"needs a config that was really applied, really
hand-edited afterwards, and re-scanned."* **Two more defects, both invisible, and both about a human's
deliberate decision being quietly undone.** Spec: `docs/brownfield-adoption.md`.

**What the run confirmed.** A re-scan after four committed changes on distinct surfaces produced a `drift`
block with **7 changes across 3 sources and 5 kinds**, attributed correctly in every case: two hand edits
as `human-edit`/`leave-alone`, a renamed gate and a new package as `code`/`propose`, a retired non-repo root
as `report-only`. The validator caught a stale `absent-gate` finding unprompted — the code had closed the
typecheck hole, and `/aidlc:adopt-backlog` would otherwise have re-filed shipped work. The **upgrade** leg
ran against a pre-0.31 unstamped config: shape-based classification named all four signals, 5 commands
relocated **byte-identical**, `pipeline.gates.ambiguousRequirements` left exactly where `run` §4 reads it,
every other key untouched, and the result resolved correctly through `resolve-gate.mjs`. The **removal**
leg stopped on a dirty tree as §1 requires, then deleted the tier-A paths, reverted `CLAUDE.md` section by
section, and kept `docs/adr/`, all three `backlog/` items and the secret-finding report — with `git status`
containing **nothing outside the approved plan** and `CLAUDE.md` **byte-identical** to its pre-adoption
state, checked against both the scan commit and an independent pre-adoption snapshot.

- **A union-seeded array cannot express a human deletion.** §3.3 seeds `pipeline.securityReviewPaths` by
  union, never replacement — which protects a path a human *added* and destroys one a human *removed*,
  because union only ever adds. The team had narrowed the array on purpose, with the reason in the commit
  message; the next apply put the entry straight back. **`/aidlc:adopt` §9 names this exact case** — *"a
  deliberately narrowed `securityReviewPaths` … produces a diff that looks exactly like routine convergence
  and reverts a decision nobody will notice in review"* — and the drift machinery could not catch it either,
  because for a set "differs from the baseline" does not say which *direction*, and nothing recorded that a
  seed had ever been applied. Fixed with a manifest rather than a heuristic: **`adoption.seeded`** records
  what adoption contributed, making the union three-way, and a withheld seed stays listed so it does not
  return next run. With no manifest the resolver falls back to plain union and says so — the conservative
  direction for a security array. New `skills/adopt-apply/seed-paths.mjs` + 27 cases.
- **`/aidlc:remove`'s verification compared against the scan commit**, so the team's own commits between
  adopting and removing came back as a list indistinguishable from files removal had touched by mistake. It
  does not error, it just prints — so it gets ignored, retiring the only mechanical check of removal's
  central promise, and it fails hardest on the long-lived projects where it matters most. §5 now separates
  the two questions it had conflated: *"did removal touch anything outside the plan?"* is a working-tree
  question `git status` answers exactly, and *"is each merged file back to its pre-adoption content?"* is a
  per-file history question — compare against `git show <adoption.commit>:<file>`, report *restored* when
  identical, and where it differs, show the remaining hunks as the team's own edits and confirm.

**Suites:** validate-profile 238, resolve-gate 38, resolve-root 38, converged 32, seed-paths 27 — 373 cases.

**Still unexercised.** `/aidlc:adopt-adr` and `/aidlc:adopt-backlog`; `--only` partial adoption; feeding
the derived drift deltas back through `adopt-apply`'s routing table; and removal with no manifest, which §1
declares a supported case and which needs its own fixture.

## [0.34.1] — 2026-07-31

### `aidlc` — brownfield: the first live run of `/aidlc:adopt-apply`, and three more defects

0.34.0 fixed the adoption **scan** against a live run. This does the same for the **write half**.
`/aidlc:adopt-apply` was run end to end against the same fixture — load, validate, read the merge
baseline, build the proposal, write, verify — and found **three more defects, none of which raised an
error**. Two were in code 0.34.0 had just added, which is its own lesson: a fix that is not exercised
downstream is a fix on probation. Spec: `docs/brownfield-adoption.md` (*the live apply run*).

**What the run confirmed.** `repos[]` built from the product and monorepo roots with the `control-plane`,
`non-repo` and `not-cloned` roots each excluded and the reason stated; the non-nested repo carrying an
absolute path while the others stay relative; `packages[]` with manifest names and the full dependency
chain, `releasable` false only for the private changeset-ignored package; every `unknown` **omitted rather
than defaulted** from the `saas` block; `securityReviewPaths` union-seeded with a cross-check proving no
auth, tenant-isolation or billing path was left out; compliance producing a **recommendation** not a
silent cadence change; `rules/git-workflow.md` rendered per repo with AIDLC defaults labelled as defaults;
and `CLAUDE.md` merged additively — checked mechanically, all 16 hand-written lines byte-identical and in
their original order, 38 added below. Gate resolution off the written config puts `@acme/web` on
*typecheck → test → build* and reports its missing `lint` as that package's own coverage hole — Phase 2's
gate-layering defect confirmed fixed at the package layer, on a real config.

- **`/aidlc:adopt-apply` could not produce a schema-valid config.** The schema's `required` is
  `["project", "workItems"]` and §3 never mentioned either, so a config built exactly as documented fails
  the schema check §4.5 tells you to run. Worse than a validation error: `project.key` is the work-item ID
  prefix, so an agent that cannot find it infers one — and the fixture's board is keyed `PLAT` while every
  loud signal in the workspace says `ACME` (package name, commit prefix, CODEOWNERS). Guess wrong and every
  item `/aidlc:adopt-backlog` creates is misfiled, silently, because nothing cross-checks a new item's
  prefix against the board. New **§3.0** writes both keys first, takes `workItems.source` from the tracker
  surface, and derives `project.key` from **the IDs the board already uses** — never a repo name, and asked
  outright when there is no board to read. `adopt` §7 now records that prefix as tracker evidence.
- **`not-applicable` gates were handed to the runner as `undefined`.** 0.34.0 added the third gate status
  and taught `coverageHoles()` to skip it, but *what actually executes* was an inline predicate in the
  CLI — `status !== "absent"` — which let `not-applicable` through. The Django service's resolved order
  read `… → build` with the command printed as `undefined`. The rule also lived in two places with only one
  tested, so `runnableSteps(steps)` is now exported, used by the CLI, referenced by `run` §7, and pinned by
  tests including *"no runnable step is ever missing its command"*. A sweep of the written config: **20
  runnable steps, 0 without a command.**
- **Re-applying was never idempotent, because the manifest carries its own timestamps.** §3.5 excluded
  `adoption.appliedAt` — but `adoption.writes[]` has an `at` per entry and this command **rebuilds the
  manifest every run**, so every re-apply differed, wrote, advanced `appliedAt`, and repeated. That is the
  fourth time this codebase has lost the same rule by omitting a field from an ignore list, so the rule
  stopped being prose in two places: **`converged.mjs` now answers "should I write?" for the config too**
  (`--config`), ignoring `appliedAt` and every `writes[].at` while still comparing `scannedAt` (it moves
  only when the profile moved) and `upgrades[].at` (history, appended not rebuilt).

Caught before it could bite: the gate status enum had been extended in the **profile** schema and not the
**config** schema, so carrying the status through would have written a config violating its own schema.
There is now a **cross-schema agreement check** over every enum `adopt-apply` copies between the two.

**Suites:** `validate-profile` 238, `resolve-gate` 38, `resolve-root` 38, `converged` 32 — 346 cases.

**Still unexercised.** Inside `adopt-apply`: the in-place upgrade (§2.1), `--only` partial adoption, and
applying drift deltas — the fixture's `changes[]` was legitimately empty, so the
`propose`/`report-only`/`leave-alone` table has still never been driven. Beyond it: `/aidlc:adopt-adr`,
`/aidlc:adopt-backlog`, the `human-edit` drift attribution, and `/aidlc:remove`.

## [0.34.0] — 2026-07-31

### `aidlc` — brownfield: the first live run of the Phase 3/4 scan, and the seven defects it found

Phases 3 and 4 shipped specified-but-unexercised, with the lesson from Phase 2's run written down at the
time: *each of those would fail by producing a plausible result rather than an error.* It held exactly.
`/aidlc:adopt` was run end to end against a purpose-built multi-root workspace — once at `--depth standard`
and again at `--depth deep` — and found **seven defects, not one of which raised an error**. Every one
produced a well-formed, fully-cited profile that passed validation and was wrong. Spec:
`docs/brownfield-adoption.md` (*Phase 3/4 — the live scan run*).

**What the run confirmed.** JSONC workspace parsing (a strict `JSON.parse` genuinely throws on a
hand-edited file, and the documented fallback would have collapsed six roots into three); the two-file
write guarantee, *verified* with `git status --porcelain` at every root rather than asserted; `--depth
standard` leaving all six source-evidenced runtime constraints honestly `unknown` with *"not sampled at
this depth"*, then `--depth deep` resolving tenancy to `shared-schema` on `tenant_id` with the two
alternative models explicitly excluded as counter-evidence; `expand-contract` derived from **paired
migration bodies** rather than from the policy document that also states it; per-package `dependsOn`
resolving to siblings while an external dependency in the same block is excluded; and a re-scan producing
`changes: []` with `depthChanged: true`, so eleven newly-known facts did not masquerade as movement.

**Two defects were structural, and both are now code with test suites rather than prose.**

- **Every git repo was classified "not a repo, enclosed by itself."** `git rev-parse --show-toplevel`
  always answers in Windows drive form (`C:/Users/…`), while the folder scan hands you MSYS form
  (`/c/Users/…`) — because Claude Code's Bash tool on Windows *is* Git Bash. The skill named exactly two
  normalisations, separators and case, and drive form is neither. The control plane failing this check
  drops `scan.commit` to `unknown`, which is the value both `adopt-apply`'s staleness check and
  `/aidlc:remove`'s verification baseline read. A second face: MSYS paths are invalid to non-MSYS tools, so
  `fs.existsSync("/c/…")` is false for a directory that exists — and because `not-cloned` is a legitimate
  classification, a root that is right there reads as *"declared but never cloned."* Both look like a
  working check, because the negative case still comes out right. New **`skills/adopt/resolve-root.mjs`**
  (+38 cases) canonicalises once at discovery and owns the boundary verdict. It is code because this is the
  *second* defect in this one probe, and because a mid-run attempt at the same normalisation in shell
  silently answered "equal" for every root including the genuine non-repo.
- **The profile could never converge, because tracking it is what moves HEAD.** §10 requires the profile be
  git-tracked and promises a second run at an unchanged commit writes nothing — but `scan.commit` was not
  among the fields excluded from that comparison. Scan at `A`, commit the profile as instructed, HEAD is
  `B`; the next scan records `B` and rewrites; commit that, and so on forever on a project that never
  changed — each rewrite also moving the baseline the next scan compares against, which is verbatim the
  failure Phase 4 said the rule existed to prevent. New **`skills/adopt/converged.mjs`** (+21 cases) makes
  the exclusion **evidence-based rather than blanket**: `scan.commit` is ignored only when
  `git diff --name-only <recorded>..HEAD -- . ':(exclude).aidlc/adoption/'` is empty, so a project that
  really moved still records the commit it was read at.

**Five more, each fixed where it was wrong.**

- **`defaultBranch` came back `unknown` on the least ambiguous repo possible** — one local branch, checked
  out — because it was named `trunk` and the chain's local-branch step tested for `main`/`master` while the
  step above it already counted `trunk` as trunk-ish. The chain now asks **cardinality before naming**.
- **A gate the stack cannot have had to be recorded `absent`, which is defined as a coverage hole.** A
  Django service has no `build` step; Go type-checks during `go build`. So every run would print permanent
  unfillable findings, and `/aidlc:adopt-backlog` would propose *"add a build gate"* as the first item a
  brownfield team reads. New third status **`not-applicable`**, which must carry evidence saying *why*, and
  which `resolve-gate.mjs` keeps out of `coverageHoles()`. It is a **gate** status, not a fourth fact form:
  `entryPoints` stays `known`/`absent`/`unknown`, because that map records which commands exist.
- **The control plane had no classification.** It is normally its own git repo, so `non-repo` was factually
  false and `product-repo` made it a **routing target** — work dispatched to a repo with no code. New
  **`control-plane`** classification, excluded from `repos[]` by name rather than by omission.
- **§10's skeleton, which the skill declares *sufficient* for offline use, had drifted from the contract the
  validator enforces.** The expensive instance: `gaps[].kind` omitted **`project-action`**, the value that
  exists precisely for a gap only the project can close. Since the validator demands every `unsupported`
  surface name a gap and its error does not suggest a kind, the cheapest repair was to invent a `skill` gap
  for a repo that simply has no CI — pointing `/aidlc:scaffold-skill` at work with no subject. Fixed by
  naming it in §7, adding a **`not-present`** support value for "the project does not have this surface",
  and syncing the skeleton. Both are now pinned by a **SKILL-agreement check**: every enum value a scan must
  write has to appear literally in `SKILL.md`. It caught a third instance on its first run — all 14
  `DRIFT_CHANGE_KINDS` were missing from the skill.
- **§5 had no rule for a root that serves tenants but owns no schema, and the naive answer is the dangerous
  one.** An 18-line untested Go handler that reads a tenant slug off the `Host` header decides which tenant
  every request is treated as; following the tenancy table literally lands on `not-multi-tenant`, which
  tells every later reviewer that cross-tenant leaks are impossible in the one file where they would
  originate — and empties that root's `securityReviewPathSeeds`. The failure is self-sealing, because the
  validator's tenancy invariants are all conditioned on the root being multi-tenant. Tenancy now describes
  the **system the root participates in**, a schema-less root inherits it at `medium` with an `absence`
  note, and `not-multi-tenant` needs positive evidence.

**Suites:** `validate-profile` **234** (from 197), `resolve-gate` **35** (from 30), plus `resolve-root`
**38** and `converged` **21** — 328 cases.

**What this release does not claim.** The run covered the **scan**. `/aidlc:adopt-apply`, `/aidlc:adopt-adr`,
`/aidlc:adopt-backlog` and every Phase 4 lifecycle leg but idempotency are still unrun — including the
`human-edit` drift attribution, the in-place config upgrade, `--only` partial adoption, and
`/aidlc:remove`. The spec lists each one. On Phase 2's precedent, that is where the next defects are.

## [0.33.0] — 2026-07-30

### `aidlc` — brownfield Phase 4: keeping an adoption true after the first day

Phases 1–3 taught AIDLC to read a brownfield project: its shape, its gate, its conventions, its runtime
constraints and the decisions its code already embodies. All of it assumed adoption happens **once**. It
does not. Codebases drift from their recorded profile, teams pilot on one repo before rolling out, configs
outlive the plugin version that wrote them, findings sit in a report nobody re-reads, and some evaluations
end in removal. This phase makes all five first-class. Spec: `docs/brownfield-adoption.md` (ADOPT-12,
ADOPT-11, ADOPT-13).

**ADOPT-12 — drift, partial adoption, in-place upgrade, clean removal.** `/aidlc:adopt` on an
already-adopted workspace now reads the previous profile **before overwriting it** and reports a `drift`
block. The comparison is deliberately three-way, because two of the three legs must be handled in
opposite directions:

- **Code that moved** and **config that no longer matches the code** are drift to propose.
- **Config that differs from what the last apply wrote** is a human's deliberate edit — intent no scan can
  see. It is reported as *"left as you set it"* and **never proposed for overwrite**. That is the failure
  the block exists to prevent: a hand-tuned gate command reverted under a diff that reads like routine
  convergence is the one drift outcome nobody catches in review. `source: "human-edit"` is pinned to
  `action: "leave-alone"` by the validator, not by the skill's good intentions.
- A **depth change is not drift.** A `quick` baseline re-scanned at `deep` turns dozens of `unknown`s into
  facts — new knowledge, not new movement — so `depthChanged` must be set when the depths differ, or forty
  non-changes bury the two real ones.
- **No baseline, no drift.** On first contact `changes[]` is empty and the profile says so: reporting a
  whole project as "new drift" is noise that teaches people to skip the section.

Three more lifecycle pieces land with it. **Partial adoption** — `--only <repo|package>` on both commands,
with the config recording the scope (`adoption.only`) *and* the exclusions (`adoption.unmanaged`), so later
scans report the rest as unmanaged-by-choice rather than re-proposing it; a re-proposal of an unmanaged
surface is a validation error. **In-place upgrade** — a config from an older plugin version is detected by
its new `configVersion` stamp, or by *shape* where it predates the stamp (files already in the wild cannot
be stamped retroactively), and upgraded as its own small approved diff in which keys are **relocated,
never rewritten**: every command a human authored stays verbatim, `pipeline.gates.ambiguousRequirements`
stays exactly where `run` §4 reads it, and the moves are recorded in `adoption.upgrades[]`. **Clean
removal** — the new `/aidlc:remove`.

- `/aidlc:adopt-apply` now records `adoption.writes[]`: per file, whether adoption **created** it, **merged
  into** it (with the sections added), or **rendered** it. That manifest is what makes removal possible
  rather than merely careful — without it, "which `CLAUDE.md` lines were ours" is a guess, and the
  safe-looking guess destroys the team's own content.
- `/aidlc:remove` classifies every path into three tiers and treats them differently. The rule it is built
  around: **deleting a container AIDLC created is not the same as deleting AIDLC's content.** `init` made
  `docs/adr/`, `backlog/` and `.aidlc/runs/`; what is *inside* them is the team's — decision records they
  will cite for years, work items that are their plan of record, an audit trail a regulated project may be
  required to retain. Those are kept by default and asked about individually. Stack tooling
  (`tsconfig.base.json`, the enterprise skeleton) is kept too, because by now their code depends on it.
  Afterwards it verifies with `git diff` against the pre-adoption commit that the project's own files are
  untouched, and says plainly when verification was not possible.

**ADOPT-11 — a debt backlog seeded from the findings, opt-in.** The scan gains `debtFindings[]` (§8):
absent gates, an auth or tenant-isolation path with no test or no review history, an end-of-life declared
runtime, TODO clusters, docs the code contradicts, cross-platform hazards, a repo whose PRs merge ungated,
and the safety findings promoted to work. The new `/aidlc:adopt-backlog` turns approved ones into items —
deduped against the board with the bounded-sweep discipline and its scope stated, each with ≥3 testable
acceptance criteria and a size, each carrying the `adopted` label and a provenance note naming the scan
commit. Three rules earn their keep:

- **A finding states the debt; it never ships the change.** `fix`, `remedy`, `patch`, `diff` and `solution`
  are rejected outright. The scan sampled the code; it did not design the change, and a finding carrying
  its own patch invites the item to be closed by applying it unread — routing around the plan → implement
  → review → verify path that is the point of the pipeline.
- **A tracker item may be a public GitHub issue.** So a finding whose *location* is itself the disclosure
  is `sensitive`: it carries a `trackerSafeTitle`, **no paths**, and points at the adoption report, which
  stays in the repo. `committed-secret` and `pii-in-fixtures` are forced sensitive by the validator.
  Publishing "AWS key at `scripts/deploy.sh:14` in commit 9ac31be" to the internet under an adoption
  banner turns a helpful scan into an incident.
- **An EOL judgement is not evidence.** The declared version is evidence; "that version is end-of-life"
  goes in `note` as something to confirm, because this scan makes no network calls and cannot read a
  release calendar. And an `absent-gate` finding must name a gate the root really lacks — a backlog whose
  first item is provably wrong is one nobody reads twice.

**ADOPT-13 — documentation.** New `docs/brownfield-walkthrough.md`: a four-year-old GitFlow Django service
beside a squash-only Next.js app in a multi-root workspace, from first scan through apply, retroactive
ADRs and a debt backlog to a run that branches from `develop` and verifies with `tox`, then a drift report
six weeks later and a clean removal. `docs/adoption-guide.md` gains the lifecycle section; the README and
the user-guide cheat-sheet gain the two new doors.

**Also in this release**

- **`/aidlc:adopt` now converges instead of churning.** Because the profile is a tracked drift baseline,
  rewriting it every scan would both spam the team with timestamp-only commits and move the baseline the
  *next* scan compares against. A re-scan at the same commit and depth now **writes neither file** and
  leaves `git status` clean — the same rule `adopt-apply` §3.5 already applied to `appliedAt`, and it makes
  the idempotency promise literal rather than nearly-true.
- Config gains `configVersion` and `aidlcVersion` at the top level, written by `init` and `adopt-apply`.
- `validate-profile.test.mjs` is at **197 cases** (up from 156), including the eight new enums
  cross-checked against the published schema and a check that the drift baseline's depth enum still
  matches the scan's — the whole `depthChanged` rule compares the two.

## [0.32.0] — 2026-07-30

### `aidlc` — brownfield Phase 3: what the project actually is, beyond its shape

Phases 1–2 taught AIDLC a brownfield project's *shape* (topology, stack, gates, git conventions). This
phase adds the three things that shape leaves out — and each one closes a gap where the framework was
previously confident and wrong rather than merely ignorant. Spec: `docs/brownfield-adoption.md`
(ADOPT-9, ADOPT-10, ADOPT-8).

**ADOPT-9 — the runtime constraints that change how code must be written.** For a live SaaS,
"TypeScript + Postgres" says almost nothing about what a *safe* change looks like; "shared-schema
multi-tenant on `tenant_id`, migrations run against live customer data, releases ride LaunchDarkly flags,
and `openapi/public-v1.yaml` is a published contract" says nearly everything. Nobody writes those down,
because everyone on the team already knows them — so an agent is the one participant who doesn't.
`/aidlc:adopt` now derives them per repo into a `saas` block: tenancy model and tenant key, isolation /
auth / billing paths, feature-flag system, migration tool plus whether expand/contract applies, public API
contracts, environments and deploy strategy, freeze windows, compliance regimes **with the signal that
evidenced each**, messaging, observability, integrations. `/aidlc:adopt-apply` writes it and **union-seeds**
`pipeline.securityReviewPaths` — never replacing what a human put there.

- The constraints reach the implementer, reviewer, security and architect briefs as *constraints*, with the
  consequence spelled out ("every query filters by `tenant_id`; a miss is a cross-tenant read, and nothing
  in the gate will catch it") rather than as background to acknowledge.
- **It informs; it does not gate — with exactly two exceptions**, both conditional on an evidenced fact and
  both earning it on the same grounds (silent failure, invisible to the gate, customer-visible when
  missed): a **destructive migration** where migrations run against live tenant data is a review
  **blocker**, and a diff touching an **API contract, auth path or tenant-isolation path** is reviewed
  **regardless of the configured cadence**. A detected compliance regime *recommends* raising the security
  cadence and names the signal; it never raises it silently. An absent field asserts nothing — the pipeline
  never invents a constraint the scan did not evidence.
- Mostly a `--depth deep` section, and honest about it: at shallower depths the report says *"not sampled
  at this depth"* rather than letting silence read as "this project has no runtime constraints". Getting
  that backwards would be the worst available outcome — it tells every later reviewer that cross-tenant
  leaks are impossible here.

**ADOPT-10 — retroactive ADRs, with the rationale deliberately left blank.** On a brownfield project
`docs/adr/` is empty while the decisions are everywhere in the code, which starves `/aidlc:do` and the
architect of the one thing they cannot re-derive. `/aidlc:adopt` §6 now derives ranked, capped
`adrCandidates[]` (tenancy model, data store, auth model, API style, deployment topology, messaging,
build tooling…), and a **new `/aidlc:adopt-adr`** writes the approved ones into `docs/adr/` — one at a
time, each behind its own approval.

- Each ADR is `accepted (retroactive)` — accepted because the code already runs on it, retroactive because
  nobody approved the document at the time — dated `unknown` where a squashed or shallow history cannot
  establish a date, and citing `path:line` evidence.
- **`## Rationale` and `## Alternatives considered` read "not recorded — confirm with the team", and stay
  that way.** A scan sees *what* was decided and never *why*; one plausible invented sentence in a document
  marked `accepted` becomes history nobody authored and everybody cites in reviews for years. The validator
  rejects a candidate carrying a rationale in any of five spellings, so this is a check rather than an
  intention. The report frames the blank as a task with a deadline of sorts: fill it while the people who
  remember are still on the team.
- Existing decision records elsewhere (Confluence, Notion, `RFCs/`) are **linked** from the ADR index,
  never copied or relocated. Re-running proposes nothing for a decision already recorded — `adoption.adrs[]`
  is the dedup key — and lists it as *already covered* rather than dropping it, so a quiet second run is
  legible as "checked" rather than "never looked".
- `templates/adr-template.md` gained the `## Rationale` section (useful greenfield too) and
  `accepted (retroactive)`; `aidlc:architecture` and `aidlc:do` now tell readers that a retroactive ADR's
  decision is binding while its reasoning is genuinely unknown — never to be filled in by inference.

**ADOPT-8 — a monorepo's packages are a first-class routing dimension.** `mono` meant one repo delivering
one app and `poly` many repos; a pnpm/Nx/Turbo/Lerna/Maven-modules repo was neither. It stays
`layout: mono` (or one poly repo entry) with a new `packages[]` — because `repos[]` means a **git**
boundary and a monorepo has exactly one, while `packages[]` means an **ownership** boundary inside it. A
third layout value would have conflated the two and left the hybrid workspace (a monorepo root beside
single-app repos) with no spelling at all.

- `packages[]` carries name (as the package's *own manifest* declares it), path, role, labels, per-package
  `stack` and `ux`, `dependsOn`, and `releasable`. An item resolves to a package (explicit → label → path →
  default → grounding → ask), and its gate, stack, standards, design pod and PR label scope to it —
  resolving stack per *repo* is how a Python worker gets handed the web coding standards.
- **One item is still one repo, one branch, one PR.** The package narrows scope inside the leaf; it is
  never a new leaf, and sharing a repo never justifies two packages' work on one branch. Cross-package work
  decomposes like cross-repo work, sequenced by the packages' own `dependsOn` graph.
- New `pipeline.gates.verify.packages` layer for a monorepo adopted as mono (which has no `repos[]` entry
  to key packages under); `resolve-gate.mjs` layers it narrowest → broadest like the rest, and a repo-scoped
  package block outranks it. `/aidlc:status` groups in-flight work by package and flags contract-affecting
  runs. `/aidlc:release` cuts a **per-package** release where the tooling supports one (changesets,
  independent Lerna, `nx release`) — driving the project's own tool rather than hand-bumping versions — and
  **says plainly that it cannot** where the repo releases as one unit, rather than tagging something the
  project has no way to publish.

**Verification.** `skills/adopt/validate-profile.test.mjs` is at **156 cases** (from 93) and
`skills/run/resolve-gate.test.mjs` at **30** (from 24), both green. The reference fixture now carries a
shared-schema multi-tenant root with its full runtime profile, a three-package monorepo with a dependency
edge and changesets tooling, and a ranked candidate list including an already-recorded entry — proving the
shapes representable, not merely described. Ten new enums are cross-checked against
`docs/adoption-profile.schema.json` so the validator's offline copies cannot drift. The invariants that are
now checks rather than intentions, each because its violation is **invisible in a profile that otherwise
looks complete**: no invented ADR rationale; every auth/tenant-isolation/billing path reaches the
security-review seeds (otherwise: recorded as dangerous, reviewed as routine); a multi-tenant root with a
migration tool must *answer* the expand/contract question (silence leaves the reviewer with no constraint);
candidates ranked and capped (an unranked list plus a cap drops exactly the decisions worth recording); a
package's `dependsOn` resolves to siblings with no cycle; and `releasable` requires release tooling that
could actually cut one.

**Ships specified-but-unexercised, and says so.** Phase 2 shipped the same way and a live run found four
defects in it — every one producing a *plausible* result rather than an error. The same exposure applies
here: real tenancy detection off a real ORM (the `--depth deep` path is the least exercised code in the
scan), whether the risk triggers fire without false positives, whether a retroactive ADR is useful to the
team that lived through the decision, the per-package release path against real tooling, and whether the
seeded review paths produce a workable volume. `docs/brownfield-adoption.md` → *Phase 3 — what is verified,
and what is not* keeps the list honest.

## [0.31.1] — 2026-07-30

### `aidlc` — four defects the first live brownfield adoption found

0.31.0 shipped Phase 2 specified but unexercised. A live run closed that gap: a fixture workspace built as
a GitFlow Python service with **no `package.json`**, a squash-only TypeScript app, a fork-based polyglot
monorepo (pnpm + Turbo, a TS package beside a Python one), a non-repo docs folder and a **JSONC**
`.code-workspace` — against a control plane pre-seeded with a hand-authored `CLAUDE.md` and config, so
merge-awareness had something real to protect. `/aidlc:adopt` → `/aidlc:adopt-apply` ran end to end and the
consumption paths were driven off the config they produced.

Most of it worked as designed, including the things Phase 2 existed for: Python gates derived from
`tox.ini` with no `package.json` anywhere, `absent` gates surfacing as coverage holes, the compose-backed
suite flagged environment-dependent, GitFlow's `develop` honoured with `main` left untouched, a squash repo
producing zero merge commits, `ambiguousRequirements` preserved untouched, and every hand-written
`CLAUDE.md` line intact with the conflicting command **kept**. Four things were wrong, and each produced a
*plausible* result rather than an error — which is why only execution found them:

- **`defaultBranch` was `unknown` for every repo.** `rev-parse --abbrev-ref origin/HEAD` exits 128 whenever
  `origin/HEAD` was never set locally — the normal state of any repo whose remote was *added* rather than
  cloned from. That left the profile's most load-bearing fact blank everywhere (it is what `<base>` falls
  back to), stranding the pipeline with nowhere to branch. `aidlc:adopt` now works a fallback chain —
  remote refs, then a single trunk-ish local branch confirmed by `merge-base --is-ancestor`, each at
  `medium` confidence — before recording `unknown`. Resolved 3 of 3 fixture repos.
- **`branchPattern` was `unknown` for every repo**, because deleting merged branches is normal hygiene and
  the scan only read live refs. It now recovers names from merge-commit subjects
  (`Merge branch 'PAY-31-ledger-export' into develop`) before giving up. A squash-only repo still reports
  `unknown` — squashing genuinely erases the evidence, and saying so is the correct answer.
- **The "re-applying the same profile changes nothing" guarantee was false.** `adoption.appliedAt` is a
  timestamp, so every re-apply rewrote a line. `adopt-apply` now compares its proposal with `appliedAt`
  excluded and, when nothing else differs, **writes nothing at all**. The guarantee is now literal: two
  consecutive re-applies leave a byte-identical file and a clean `git status`.
- **Gate resolution silently dropped inherited gates.** "Most-specific-wins" meant *replace*, so a Python
  package inside the TypeScript monorepo resolved to `pytest` alone and the repo-wide `lint` **vanished** —
  and a gate that vanished is indistinguishable from one that passed, the same failure class as deleting an
  `absent` entry. Resolution now **layers narrowest → broadest**: each layer contributes its steps in its
  own order but only for gate names no narrower layer claimed, so a package inherits the repo's other gates
  while its own ordering still wins. A package that should genuinely skip a repo gate declares it
  `status: absent` at package level — explicit, and still reported as a coverage hole.
  - Because this is exactly the kind of rule that fails silently when re-derived per run, it is now **code
    rather than prose**: new `skills/run/resolve-gate.mjs` (CLI + importable, offline, no deps) with a
    24-case `resolve-gate.test.mjs` pinning the semantics, and `run` §7 invokes it instead of describing it.

`docs/brownfield-adoption.md` records the full run, what it confirmed, and what remains unexercised (a real
fork PR against an upstream, branch-protection reads, an offline run, a read-only workspace, and a full
`/aidlc:run` with agents over the derived gate).

- Versions: `aidlc` 0.31.0 → **0.31.1**, marketplace → **0.31.1**.

## [0.31.0] — 2026-07-30

### `aidlc` — brownfield Phase 2: the project's own gate and conventions, applied behind a diff

Phase 1 could *describe* an existing project; nothing could act on the description. A brownfield team still
ran a pipeline that assumed npm scripts and imposed AIDLC's git conventions on a repo that already had its
own. This is ADOPT-3, ADOPT-4 and ADOPT-5 — where a brownfield project becomes genuinely runnable rather
than merely scaffolded.

- **New skill `aidlc:adopt-apply`.** The write half of adoption, deliberately a **separate command** so
  `/aidlc:adopt` keeps its read-only guarantee and stays safe to run on first contact. It validates the
  profile with the scan's own validator before believing it, refuses a profile whose `scan.commit` no longer
  matches HEAD without saying so, then works one way only: **propose, then write.** The complete diff, each
  value's evidence beside it. A `low`-confidence fact becomes a **question**, never a pre-filled proposal.
  A disagreement with a value a human authored is surfaced as `detected X · configured Y — keep / replace`
  and **defaults to keep**. Partial approval is normal.
- **`pipeline.gates` — the project's real gate replaces the npm assumption (ADOPT-4).** An ordered step
  list, resolved most-specific-first (package → repo → workspace), executed top to bottom by `aidlc:run`'s
  verify phase. A repo with no `package.json` now completes a full run on its own gate — `ruff` + `pytest`,
  `mvn -B verify`, `cargo test`, `go test ./...`. Four things carry the weight:
  - **`status: absent` is a first-class entry, kept on purpose.** A gate the project does not have stays
    visible in config, and every run writes it into `## Findings` as a coverage hole. It is never
    `required`, never counted green, and never substituted with an AIDLC default. Deleting the entry to
    tidy the config is exactly how a missing gate becomes invisible.
  - **`environmentDependent` + `services`** make a failure diagnosable as *environment unavailable*
    instead of *code broken* — the difference between a useful run report and one that blames the diff for
    a missing database.
  - **`scope`** (`repo` · `package` · `affected` · `changed-paths`) with `maxItemMinutes`: a monorepo with
    Nx/Turbo runs **affected targets only** and the run file **names the affected set**, because a green
    subset is not a green suite.
  - **`providedByHook`** records that husky / pre-commit / lefthook already runs a gate, so the AIDLC
    pre-commit layer is never installed on top of a layer the project already has.
- **The project's git conventions win (ADOPT-5).** New `gitConventions` on the mono `git` block and on every
  `repos[]` entry: `integrationBranch`, `commitStyle`, `mergeStrategy`, `longLivedBranches`, `hotfixRoute`,
  `contribution` + `upstreamRemote`, and `conventionsSource`. `aidlc:git-workflow` now resolves a single
  **`<base>` = `integrationBranch` if set, else `defaultBranch`** and uses it for every branch-from, PR base
  and local merge — so a GitFlow project branches from and integrates into `develop` and never touches
  `main`. It follows the project's commit style rather than imposing conventional commits, honours
  `mergeStrategy` on the local-merge path (a squash-only repo no longer receives a `--no-ff` merge commit),
  refuses to delete or branch off a long-lived branch, follows `hotfixRoute` for a production incident, and
  gains a **fork-based contribution path** (push to the fork, PR to the upstream) so a repo the user cannot
  push to is handled at adoption time instead of failing at first push. `conventionsSource` distinguishes
  detected from **default** from **human** — a default presented as a detected fact is the specific
  dishonesty that field prevents, and a `human` block is never touched by a scan.
- **Provenance and idempotency.** New `adoption` block (`scannedAt`, `commit`, `profileVersion`,
  `profilePath`, `depth`, `appliedAt`, `unmanaged[]`) and `architecture.resolvedBy: "codebase-scan"`.
  Applying the same profile at the same commit produces **no diff at all**; at a later commit it proposes
  the deltas only. `--only <repo|package>` scopes a pilot and records what was left unmanaged, so a later
  run neither re-proposes it nor mistakes it for missed.
- **Detection to match, in the scan.** `gates[]` (the ordered proposal, mirroring CI's order where CI
  declares one, else cheapest-first) and `conventions` (branch/commit/merge/integration/long-lived/hotfix/
  CODEOWNERS/push-access) derived from **bounded** history — the bound is stated in the evidence, a shallow
  clone lowers confidence on everything history-derived, and an unreadable branch-protection API is
  `unknown`, **never** `absent`. Only an API that *answers* "no protection" earns `absent`, and that means
  the repo's PRs merge ungated, which is named explicitly.
- **`/aidlc:init` now offers three setup paths** (ADOPT-3's last criterion): requirements-doc → bootstrap,
  **existing code → adopt**, or "I know my setup" → the full Q&A. The adopt path collects only key/name/
  tracker/cadence, scaffolds the control plane, and skips tooling/structure/CI scaffolding entirely — an
  existing project already has its own, and overwriting it was never the intent.
- The scaffolded `rules/git-workflow.md` now says up front that its rules are **AIDLC's defaults for a
  project with no convention of its own**, and that adoption re-renders it from the project's real ones.

Enforcement kept pace with the contract: `validate-profile.mjs` gained gate and convention rules and the
suite went 71 → 93 cases. Two invariants worth naming, because both catch a *plausible* profile rather than
a malformed one: an `absent` gate may not be `required: true` (a hole that claims to block reads as green),
and `integrationBranch` may not equal `defaultBranch` (it exists to name a target that is *not* the default,
so equality means one of the two was mis-derived). A `fork-only` `pushAccess` with no `vcs.upstream` is also
rejected — a fork path with no upstream has nowhere to open its PR.

- Versions: `aidlc` 0.30.0 → **0.31.0**, marketplace → **0.31.0**.

## [0.30.0] — 2026-07-29

### `aidlc` — `/aidlc:adopt`, the brownfield front door: read the code, derive the facts, prove each one

AIDLC already *landed* cleanly on an existing repo — `init` merges rather than clobbers, the web tooling
and enterprise skeleton are merge-aware, `/aidlc:repo add` never rewrites history. What was missing was
the layer above: **nothing derived project knowledge *from* an existing codebase.** `/aidlc:bootstrap`
infers architecture from a *requirements document*, which a brownfield project does not have. So the
brownfield path was: answer mono-vs-poly, stack and commands **by hand at init, from memory, about a
codebase the framework had never read** — and every wrong answer was written into `CLAUDE.md` and
`aidlc.config.json` as ground truth, silently steering every later run.

This is Phase 1 of the epic in `docs/brownfield-adoption.md` (ADOPT-2, ADOPT-14, ADOPT-7, ADOPT-6): the
read-only scan. It ships alone, is useful alone, and has nothing to roll back.

- **New skill `aidlc:adopt`** (`/aidlc:adopt [--depth quick|standard|deep]`). Scans the workspace and
  emits `.aidlc/adoption/profile.json` + `.aidlc/adoption/report.md` — **and nothing else.** No config,
  no `CLAUDE.md`, no rules, no items, no branch, no commit; the skill verifies that claim with
  `git status --porcelain` rather than asserting it. Depth is a cost dial, not a quality dial: a
  shallower scan records **more `unknown`**, never a weaker guess.
- **Evidence or silence.** New contract at `docs/adoption-profile.schema.json` (`profileVersion: 1`),
  built on a `fact` primitive with three deliberately distinct statuses — `known` (value + `path:line`
  or command output + confidence), **`absent`** (the thing provably is not there, with `absence`
  evidence), and `unknown` (with the reason). Collapsing `absent` into `unknown` loses a coverage hole;
  collapsing `unknown` into a default is exactly how a wrong inference reaches a permanent file. A
  `known` fact with no evidence fails schema validation — the guess is not expressible.
- **The workspace is the unit of adoption, not the repo (ADOPT-14).** Users open an IDE workspace that
  may hold several repos, and AIDLC's poly *model* was already right while its *mechanics* assumed
  every repo was nested under the control plane. Discovery now runs **both** signals — a
  `*.code-workspace` `folders[]` list (honouring `name` overrides and paths outside the opened folder,
  on any drive) **and** the `<sub>/.git` folder scan; using only the latter collapses a multi-root
  workspace into a single repo. Every root is classified — product repo · monorepo · non-repo folder ·
  reference-only clone · already-adopted · not-cloned — and **proposed for confirmation, never assumed.**
  The control plane resolves to the folder holding the `.code-workspace` file (else the opened folder)
  and is **never silently a product repo**.
- **Two failure modes are now caught at adoption time instead of at the first `/aidlc:sprint`.** A root
  the session cannot read is reported with its exact `--add-dir` remedy, and adopt never reports a repo
  as profiled when it could not read it. Per-root trust and plugin-enablement state is checked and named
  with its fix — the F42 silent failure, caught early.
- **The nesting assumption is gone from the schema and the skills.** `repo.path` accepts an absolute
  path or a path outside `workspace.root`; `workspace.root` is documented as a base for *relative*
  resolution rather than an assertion that repos are subfolders. Where a repo is **not** nested, the
  control plane's `.gitignore`/gitlink protection is **inapplicable, not missing** — `init` now says so
  rather than leaving the next reader to record a phantom gap. `aidlc:work-items` and `aidlc:run` were
  updated to resolve, quote and `cd` into paths that may hold spaces, sit on another drive, or be UNC.
- **Adoption-time safety contract (ADOPT-7).** `.env` files are never read or printed — recorded by
  path only, with variable *names* possible solely when `pipeline.envFileAccess` permits and the
  `env-guard` hook allows the read; a git-*tracked* env file is itself reported as a finding. Suspected
  secrets are recorded by location and type with the value redacted and never written into the profile,
  the report, an item or a commit. PII-suspect fixtures are flagged and excluded from every quoted
  excerpt. The scan makes **no network calls and sends no source anywhere**; offline it completes and
  marks the affected checks `unknown`. Large repos are sampled with the strategy and honest coverage
  percent stated, and a workspace with no write permission gets its report printed to the session.
- **Honest degradation (ADOPT-6).** The report carries a supported / partial / unsupported table for
  every detected surface — stack, tracker, VCS, CI, migration tool, containers, hooks — with a one-line
  consequence each, judged against **the plugins actually installed**, not what AIDLC could support in
  principle. A Django + Terraform + Flutter shop is told plainly that it gets the language-agnostic
  core. An unsupported tracker is never a blocker: the markdown backlog is offered with its trade-off
  stated, and each gap becomes a `gaps[]` proposal for `.aidlc/extensions.json`.
- **Read-only git introspection is now allowlisted** in the project template —
  `rev-parse`/`ls-files`/`check-ignore`/`for-each-ref`/`count-objects`, `submodule status`,
  `worktree list`, `git lfs env`, in both the bare and `git -C` forms. A read-only scan that fires a
  dozen permission prompts trains people to click through prompts, which is the worse security outcome.
  **`git config` is deliberately excluded**: it is a write verb as often as a read one, and its read
  form can echo a PAT embedded in a remote URL. The skill is required to strip credentials from any
  remote URL before recording or printing it, and to record a config-only fact as `unknown`.
- **`/aidlc:init` points at it.** On the full path, when there *is* existing code, init suggests running
  `/aidlc:adopt` first so the topology/stack/command answers come from the report instead of from
  memory. A suggestion, not a gate.
- **The contract is enforced, not trusted.** New `skills/adopt/validate-profile.mjs` — dependency-free,
  offline, both a CLI and an importable API — which the skill runs on its own output before reporting a
  scan complete. It rejects a `known` fact with no evidence, an `unknown` fact that smuggles a value, a
  `writes[]` entry outside `.aidlc/adoption/`, an unreachable root with no stated remedy, an unsupported
  surface with no recorded gap, an env/secret/PII finding that carries content — and, as a backstop, any
  credential-shaped string **anywhere** in the profile or the report. `validate-profile.test.mjs` covers
  it in 71 cases, including a reference fixture that doubles as proof the awkward shapes are
  representable (multi-root across two drives · monorepo beside single-app roots · UNC path with spaces,
  unreachable · zip drop with no VCS · Mercurial checkout · polyglot monorepo · absent test gate). The
  validator duplicates 14 schema enums so it can run inside an installed plugin with no schema file; the
  suite cross-checks every one against `docs/adoption-profile.schema.json`, so the duplication cannot
  drift silently.

**Two defects a fixture pass caught before release**, both of which would have produced a *confidently
wrong* profile rather than a visible failure:

- **`git rev-parse --is-inside-work-tree` is the wrong probe for "is this root a repo."** Git searches
  ancestor directories, so it returns `true` for any folder beneath any repo — and a home directory under
  git makes that *every* folder. Every follow-up question then described the **ancestor**: its branch,
  remotes, history and size, recorded against the root with a citation. Detection is now a marker test
  plus requiring `rev-parse --show-toplevel` to equal the root itself; a root inside another repo is
  recorded as the new `enclosingRepo` fact and reported as the gitlink hazard it is, and the validator
  rejects any root that claims both. The same rule governs the control plane — not its own repo root
  means `scan.commit` is `unknown`, not the enclosing repo's HEAD.
- **A `.code-workspace` file is JSONC, not JSON.** VS Code accepts `//` comments and trailing commas, and
  hand-edited workspace files contain them, so a bare `JSON.parse` throws — and the original instructions
  would then have fallen back to the folder scan alone, **silently collapsing a multi-root workspace into
  a single repo**, the precise failure ADOPT-14 exists to prevent. Comments and trailing commas are now
  stripped before parsing, and a file that still will not parse stops the run loudly instead of degrading.

Adopt does **not** write config, `CLAUDE.md`, `pipeline.gates`, rules, ADRs or backlog items, and does
not remediate anything it finds — those are Phases 2–4 of the epic, each a separate propose-then-approve
step. No change to `run`, `intake`, `next`, `bootstrap`, any agent, or any hook.

- Versions: `aidlc` 0.29.0 → **0.30.0**, marketplace → **0.30.0**.

## [0.29.0] — 2026-07-29

### `aidlc` — `/aidlc:do`, a general front door that grounds before it routes

Until now every entry point required you to already know the shape of your request: `/aidlc:run <ID>`
for a tracked item, `/aidlc:intake <text>` for a requirement, `/aidlc:next` for whatever is top of the
backlog. A prompt that was **not** work had no door at all. Asking *"would this feature sit right in our
project?"* or *"should we use X here?"* fell straight through to the bare agent, which answered without
the one thing that makes the answer worth having — the project's ADRs, backlog, repo roles and stack.
The closest existing capability, `aidlc:research`, is `user-invocable: false`, runs only against a spike
**item**, and commits a formal dated decision report to `docs/research/`; there was no way to get a
grounded opinion without first minting a work item for it.

- **New skill `aidlc:do`** (`/aidlc:do <anything>`). The orchestrator grounds itself first, then routes.
  Six routes, each announced in one line **before** acting so a misroute costs nothing to correct:
  **consult** (opinion / fit / "should we") · **explain** (how or why something works) ·
  **diagnose** (a defect) · **build** (hands off to `aidlc:run`, which already accepts free text) ·
  **resume** (the prompt names a `{KEY}-{n}`) · **meta** (`/aidlc:status`, `/aidlc:next`).
- **A no-artifact answer is a first-class outcome.** Consults and explanations normally end with no
  item, no branch and no commit — stated explicitly in the skill, because the natural failure mode of a
  pipeline plugin is manufacturing a work item to look productive. A consult also never silently becomes
  an implementation: a mixed prompt ("is this a good idea, and if so build it") runs the consult, presents
  the recommendation, and waits for a go-ahead.
- **The grounding floor is deliberately cheap** — config → in-flight runs (control plane **and** each
  declared repo's `.aidlc/runs`, the poly-aware scan `/aidlc:status` uses) → backlog **titles only** →
  ADR **titles only**. Full ADRs are read only when the prompt touches that decision; agents escalate one
  at a time and only when the answer genuinely depends on it (`aidlc-architect` reserved for
  hard-to-reverse calls). Most prompts are answered from the floor plus one targeted read.
- **ADRs are cited, not re-litigated.** The skill forbids quietly contradicting a recorded decision —
  cite it, or explicitly propose superseding it. Answering an architecture question without reading the
  relevant ADR is the specific failure this door exists to prevent.
- **Discoverability** — added to the README command table, the user-guide cheat-sheet (including the
  "an opinion, not a task" row), and the scaffolded project `CLAUDE.md`, which now tells a project to
  prefer this door over answering a project question cold.

Existing behaviour is untouched: no change to `run`, `intake`, `next`, any agent, or any hook. `do` is a
router that hands off to the pipeline for delivery and writes no product code itself.

- Versions: `aidlc` 0.28.2 → **0.29.0**, marketplace → **0.29.0**.

## [0.28.2] — 2026-07-24

### `aidlc` — env switch: resolve `envFileAccess` from the env file up to the control plane (F50)

Found in a live poly workspace. 0.28.x's env-file switch read `pipeline.envFileAccess` from a single
fixed path — `<cwd>/.claude/aidlc.config.json`. That is correct only when the session cwd is the
workspace root. In a **poly workspace** the switch lives once at the control plane while each product
repo is a subfolder with its own env files, so a tool call whose cwd was a product subrepo found no
config there and **fell back to `deny`** — hard-blocking env reads/writes in a workspace that had
explicitly opted into `"ask"`. The block message then told the user to *"set `envFileAccess: \"ask\"`"*
— which was already set — so the pipeline, seeing no valid path forward, invented a non-existent
`"allow"` value. (There is no `"allow"`: the enum is `["deny","ask"]` and both hooks fail closed on
anything else, so setting it would have blocked *harder*, not opened the gate.)

- **Both hooks now resolve the switch by walking UP from the ENV FILE'S OWN directory** to the nearest
  `.claude/aidlc.config.json` — `env-guard.mjs` for the Read/Edit/Write tools, `guard.mjs` for the Bash
  path (each detected env target). Layout-independent: mono finds it at the repo root; poly finds it at
  the control plane from a product subrepo of any depth. **The session cwd no longer matters, and each
  repo may carry its own env files under one control-plane switch.**
- **Still fails closed** — no config anywhere up the tree, an unreadable/malformed one, or any value
  other than the exact string `"ask"` ⇒ `"deny"`. The nearest config on the path governs (opted-in or
  not), so an unrelated ancestor can't silently override a workspace.
- **The deny message no longer misleads.** If the switch is *already* `"ask"`, it now says the config
  could not be found by searching up from the env file's location — pointing at a misplaced config
  rather than implying a stronger setting exists.
- **Regression suites extended** — `env-guard.test.mjs` (20 → 26 cases) and `guard.test.mjs`
  (+4 cases, 74 total) now cover subrepo-cwd / control-plane-config resolution and its fail-closed
  edges. The gap was previously untested: every case anchored cwd on the config's own directory.

- Versions: `aidlc` 0.28.1 → **0.28.2**, marketplace → **0.28.2**.

## [0.28.1] — 2026-07-23

### `aidlc` — drop the re-introduced no-op `Write(path)` rules (F48) + strict-JSON migration warning (F49)

Two follow-ups from 0.28 landing in a live poly workspace.

- **F48 — `Write(**/.env)` / `Write(**/.env.*)` removed from the template's `ask` list.** They warned
  at every session start (*"not matched by file permission checks — only `Edit(path)` rules are"*).
  File permission checks match only `Read(path)` and `Edit(path)`; `Edit` already covers every
  file-editing tool including Write, so **enforcement is unchanged** — this was noise, not a hole.
  Notably this is **a regression of F44**, which fixed the identical no-op in the `deny` list one cycle
  earlier: the same wrong assumption was reapplied to the `ask` list. Logged as its own finding so the
  pattern is visible; the archive is effectively the regression suite for config rules, and nothing
  mechanical enforces it yet.
- **F49 — migration guidance now names the format constraint.** Following 0.28's *"remove
  `Read(./.env)` and `Read(./.env.*)`"*, the rules were commented out with `//`. `settings.json` is
  **strict JSON**, so the file became unparseable and Claude Code **skipped it entirely** — including
  its `enabledPlugins` block, which silently disabled every AIDLC plugin for that project: all
  `/aidlc:*` commands vanished while `/plugin` still showed them installed. `/aidlc:init`'s migration
  step now says **delete outright, never comment out**, and requires a `JSON.parse` re-read after any
  settings edit. Prefer the programmatic init merge (which cannot introduce comments) over hand-editing.

**If you hand-migrated to 0.28 and lost the `/aidlc:*` commands:** your `.claude/settings.json` is
almost certainly malformed. Validate it (`node -e "JSON.parse(require('fs').readFileSync('.claude/settings.json','utf8'))"`),
delete any `//` lines, and drop any `Write(<path>)` rules.

- Versions: `aidlc` 0.28.0 → **0.28.1**, marketplace → **0.28.1**.

## [0.28.0] — 2026-07-23

### `aidlc` — env switch: reconcile it with the harness permission gate (fixes the switch)

0.27's `envFileAccess` switch didn't actually work in the field. A plugin user set
`envFileAccess: "ask"` and the harness still denied the read: *"denied by your permission settings."*
Root cause — **two permission layers that disagreed**:

- `.claude/settings*.json` is the harness's **hard gate**; a `deny` there always wins and a hook can
  never relax it (precedence is `deny → ask → allow`, and a PreToolUse hook can only *tighten*).
- The `envFileAccess` hook is **subordinate** to that gate.

So a hard `Read(.env*)` deny and an opt-in switch are mutually exclusive — and every project scaffolded
before 0.28 still carries that deny in its own `settings.json` (updating the plugin never rewrites a
project's already-copied settings). The switch was inert there. 0.27 had also removed the static deny
from the *template* without a replacement, leaving the default-deny resting entirely on the hook
(fail-open if the hook wasn't running) and the **Bash path** (`> .env`, `cat .env`) ungoverned.

The fix makes the layers agree, with the hook authoritative:

- **Settings template now lists env paths in `ask`, not `deny`** (`Read(**/.env)`, `Read(**/.env.*)`,
  `Edit(**/.env)`, `Edit(**/.env.*)` — corrected in 0.28.1, see F48).
  This is a fail-safe *floor*: even if the hook isn't running, touching an env file
  prompts — never silently readable, never hard-denied.
- **`env-guard.mjs` enforces the real default** — `"deny"` → **exit 2** (a hard block that bypasses
  the settings `ask`); `"ask"` → a prompt showing the exact diff. Unchanged from 0.27, now correct
  because no static deny sits above it.
- **`guard.mjs` mirrors the switch on the Bash path (new).** Reading or writing an env file from a
  shell command — `>`/`>>` redirects, `tee`/`cp`/`mv`/`install`/`dd`/`truncate`/`sed -i` writes, and
  `cat`/`type`/`Get-Content`/`head`/… reads — is blocked under `"deny"` and stepped past under `"ask"`
  (quote-aware, so a quoted `">.env"` in an echo string isn't mistaken for a redirect; git segments
  and `--env-file` passthrough are not caught). Fails closed. **+18 guard regression tests (52 → 70).**
- **`/aidlc:init` now migrates** an existing `settings.json` instead of blind-unioning: it drops the
  deprecated `Read(./.env)` / `Read(./.env.*)` denies and adds the `ask` rules, flagging the
  deny-list edit to the user for approval.

**Migration for existing projects:** update + reload the plugin, then either re-run `/aidlc:init`
(accept the settings merge) or manually remove `Read(./.env)` and `Read(./.env.*)` from that project's
`.claude/settings.json` `deny` array. The agent can't do it — `settings.json` is protected by
`protect-paths.mjs`. Until then the switch stays inert in that project.

- Versions: `aidlc` 0.27.0 → **0.28.0**, marketplace → **0.28.0**.

## [0.27.0] — 2026-07-23

### `aidlc` — env-file access is now an opt-in switch, not a hard wall

Previously the only `.env` rule was a static `Read(./.env)` / `Read(./.env.*)` **deny** — it blocked
reads (including `.env.example`) but, surprisingly, never blocked *writes*, and a static deny can
never be relaxed, so there was no way to let the pipeline maintain env files even when a user wanted
it to. This adds a real switch: **`pipeline.envFileAccess`** in `.claude/aidlc.config.json`.

- **New hook `hooks/scripts/env-guard.mjs`** (PreToolUse on `Read|Edit|Write`) owns all env-file
  access — `.env`, `.env.example`, `.env.local`, `.env.production.local`, … matched by basename
  anywhere in the tree (so poly product subfolders and monorepo `apps/*` are covered too, which the
  old root-only `./.env*` rule missed). `.envrc` and `.env-sample` are deliberately *not* env files.
- **`"deny"` (the default) hard-blocks** every read and every change to an env file (exit 2, with a
  reason telling the model to ask the user rather than edit the config itself).
- **`"ask"` opts in with the human in the loop** — the pipeline may touch env files, but *every*
  individual read/edit/write is surfaced for the user to approve or reject, and for an Edit/Write the
  confirmation prompt shows the exact diff/content. Flip it back to `"deny"` to lock env files again.
- **Fails closed.** A missing, unreadable, or malformed config — or any value other than the literal
  `"ask"` — is treated as `"deny"`.
- **Why a hook, not a static rule:** a static `deny` always wins and can't be conditionally relaxed
  (verified against the permission-precedence docs), so the two `Read(./.env*)` deny rules were
  **removed** from the project `settings.json` template and their protection folded into the hook.
  Non-env secret paths (`**/secrets/**`, `~/.ssh`, `~/.aws`) stay statically denied.
- Config schema (`envFileAccess`), both config templates (default `"deny"`), and the docs that stated
  the old behavior (`permissions-rationale.md`, `example-walkthrough.md`, the implementer agent's hard
  rules, the docs-writing skill) were all updated. **New regression suite `env-guard.test.mjs`** — 20
  cases covering deny/ask/allow, poly + monorepo paths, the `.envrc`/`.env-sample`/`foo.env`
  non-matches, and all three fail-closed config states.
- Versions: `aidlc` 0.26.0 → **0.27.0**, marketplace → **0.27.0**.

## [0.26.0] — 2026-07-19

### `aidlc` — guard resolves repo state from the `-C` target, and fails closed on a parse miss (F46)

With F45's `git -C` permissions working, poly runs reached the push step and were blocked by the
pipeline's own guard: *"push while on protected branch 'main'"* — while the target repo was on its
feature branch. `guard.mjs` resolved every repo-state check against the session cwd, which F42 pins
at the control plane, and the control plane sits on `main` permanently. Harmless in mono, where cwd
*is* the repo; in poly it blocked the one verb the pipeline needs, twice per item, on the *correct*
and safe case.

- **`-C` is now parsed and every repo-state check resolves against that repo** — `branchInfo()` and
  `stagedGitlinks()` alike. The latter is a third instance of the same bug: `git -C <repo> commit`
  was inspecting the control plane's index instead of the target's.
- **Fixed a fail-OPEN bypass found while reproducing.** Command identity was matched by regex over
  quote-blanked text, so an **unquoted** `-C` path containing a space split into two tokens, the
  pattern missed, and **every push check was skipped**: force-push, `push origin HEAD:main` and
  `filter-branch` all returned rc=0. The workspace root in the report is literally `D:\RTO Tool`, so
  this shape is reachable. Command identity now comes from a quote-aware tokenizer plus a real
  `git [global-opts] <subcommand> [args]` parse, and a subcommand slot landing on a path fragment
  triggers a fail-closed rescan rather than an allow.
- **Refspec checks parse actual refspecs** (`HEAD:main`, `:main`, `+main`, `--delete main`) instead of
  matching a protected name anywhere in the line. Quoted arguments are single opaque tokens, so a
  commit message mentioning `push` or `DROP TABLE` can never read as a command — the previous
  `stripQuotes` workaround is gone.
- **Blocking all pushes from a protected HEAD was kept deliberately.** The report suggested checking
  the refspec instead of the checked-out branch; refspec checking already existed and passes tests,
  and the HEAD rule is defence-in-depth that becomes correct — not over-broad — once HEAD is read
  from the right repo.
- **12 poly regression tests added** against a control-plane fixture whose path contains a space:
  legitimate `-C` feature push/status/commit allowed; `-C` push targeting `main`, `HEAD:main`,
  force-push and `filter-branch` blocked; bare push from the control plane still blocked; both
  unquoted-spaced-path bypasses blocked. **52/52 pass** (40 pre-existing, unchanged).

### `aidlc` — `wi-ado`: headless ADO runs land on the `az` CLI tier by design (F47)

The template allowlists no `mcp__*` tools, so a headless run can't call the ADO MCP server and falls
to `az boards`/`az rest` — which carried every tracker and PR operation successfully. The defect was
that this *read* as breakage: one run reported ADO as "gated". Tier 2 now states this is expected,
that ADO should be reported as working, and that a tier-1 denial alone must not escalate to the PAT
tier. **No allow rule was added** — an MCP allow rule needs the literal `mcp__<server>__` prefix as it
appears in that session, a plugin-provided server's exact prefix could not be confirmed here, and a
bare `mcp__*` allow rule is skipped with a warning. The skill tells the user how to read the real
name (`/mcp`, `--verbose`) instead.

- Versions: `aidlc` 0.25.0 → **0.26.0**, marketplace → **0.26.0**.

## [0.25.0] — 2026-07-19

### `aidlc` — make F43's `git -C` rules actually match (F45)

**0.24.0's fix did not work.** Every `Bash(git -C * <verb>:*)` rule shipped in F43 matched nothing, so
a poly run still could not execute a single git command — and because F42 pins cwd to the control
plane and F43 rules out `cd`, there was no permitted route to git at all. The rules were authored
against the permission docs and shipped without ever being executed; the docs are wrong on the two
points that mattered. Both constraints below were established by running headless probes against a
scratch workspace on CC 2.1.215, and the final rule set was verified by a 15-command battery against
the real template file:

- **`:*` does not compose with a mid-pattern `*`.** `Bash(git -C * add:*)` → denied;
  `Bash(git -C * add *)` → allowed. Every mid-glob rule now uses the `*` form. This single wrong
  suffix disabled all 14 allow rules *and* all 5 mirrored denies in 0.24.0.
- **A trailing ` *` does not match end-of-string**, contrary to the documented "space or
  end-of-string". This silently broke two things: bare `git -C <path> status` was blocked, and the
  deny for `git -C <path> push origin --force` **did not fire**. Mid-glob rules now use no-space `*`,
  and the bare-verb force-push denies gained exact-match spellings so the argument-less form is
  covered without swallowing `--force-with-lease`, which stays in `ask`.
- **Deny coverage is now verified directly, not inferred.** The failure modes are asymmetric: a dead
  allow rule blocks the run loudly, a dead deny rule is silent. Confirmed blocked in both bare and
  `-C` form: `push --force` (with args, and bare), `push origin --force`, `reset --hard origin/main`.
  Confirmed still allowed: `status`/`fetch`/`add`/`commit`/`branch` with and without trailing args,
  benign `push origin main`, and every mono bare-verb form.
- **A pre-existing deny gap is closed:** `Bash(git reset --hard origin:*)` never matched
  `git reset --hard origin/main` — the boundary after `origin` fails on `/`. Now `origin*`.
- `aidlc:run` §2.5 records both matcher constraints inline, so the next editor of those rules doesn't
  rediscover them, along with the asymmetry that makes the deny half untestable by watching a run
  succeed.
- Versions: `aidlc` 0.24.0 → **0.25.0**, marketplace → **0.25.0**.

## [0.24.0] — 2026-07-19

### `aidlc` — unblock poly runs at the first git call (F43) + drop no-op `Write(...)` denies (F44)

F42 fixed `/aidlc:sprint` launching in a poly workspace and, in doing so, moved the wall one step
later. Pre-F42 the run couldn't start; post-F42 it starts, resolves the item, routes to the repo —
and then blocks on **every** git call. The launch cwd is now the control plane and a session can't
change its cwd, so poly git calls are necessarily `git -C "<repo path>" <verb>`, whose permission
prefix matches **none** of the template's bare-verb rules (`Bash(git status:*)`, …). Every poly item
hit this identically, before any write.

- **Template allows the poly git verbs in `-C` form**, alongside the bare forms mono still uses.
- **The denies are mirrored in `-C` form, not left behind.** Widening allow without widening deny would
  have let `git -C <path> push --force` bypass `Bash(git push --force:*)`. Bash rules support
  mid-pattern wildcards, so the mirror is exact: `Bash(git -C * push --force:*)`, `… -f`,
  `… reset --hard origin`, plus `Bash(git -C * rebase:*)` in `ask`. A bare `Bash(git -C:*)` was
  rejected for precisely the bypass it would open.
- **A pre-existing deny gap is closed while here:** `Bash(git push --force:*)` never matched
  `git push origin --force`, where the flag follows the remote. Added `Bash(git push * --force:*)`
  and `-f`, in both bare and `-C` form.
- **Added `Bash(az rest:*)`** — `wi-ado` needs it for the work-item-type states API and it was absent
  from the template entirely. (Observed symptom: `az boards` worked, `az rest` didn't.)
- **`aidlc:run` §2.5 now states the routing mechanism per command family** rather than the ambiguous
  "cwd = `<repo.path>`" that produced the mismatch: git → `git -C`; npm/docker/test/lint →
  `cd "<path>" && <cmd>`; `gh`/`az repos` → pass the repo explicitly. **`cd … && git …` is explicitly
  ruled out for git**: Claude Code prompts for any compound command that `cd`s into a different
  directory and then runs git — regardless of the allowlist — since git can execute that directory's
  hooks. Mono is unaffected; its cwd already is the repo.
- **Dropped the template's two `Write(...)` denies (F44).** File permission checks match only
  `Edit(path)`/`Read(path)`; a `Write(path)` rule is accepted but never matched, so each one printed a
  startup warning on every headless run while enforcing nothing. The adjacent `Edit(...)` denies
  already cover both settings files, so enforcement is unchanged.
- Versions: `aidlc` 0.23.0 → **0.24.0**, marketplace → **0.24.0** (`aidlc-stack-web` 0.10.0 /
  `aidlc-ux` 0.4.0 unchanged).

## [0.23.0] — 2026-07-19

### `aidlc` — own the control plane's git story in a polyrepo workspace

A poly workspace is a control-plane git repo with other git repos nested inside it as subfolders.
That arrangement has one sharp edge, and nothing in the framework addressed it: if a product repo
isn't ignored, a single `git add -A` at the control plane stages it as a **mode-160000 gitlink** — a
submodule reference with no `.gitmodules` entry. Git reports no error, the commit succeeds, and the
repo clones with an empty directory where the product code should be. `/aidlc:run` reaches this path
in normal operation, because `control-plane` is a first-class routing target that branches and commits
at the workspace root.

- **The project template now ships a `.gitignore`** (it previously shipped none). It ignores product
  repo checkouts via a managed `# AIDLC:REPOS` block, plus machine-local state — `settings.local.json`,
  `.aidlc/sprint-*.json` (pids and absolute paths), `staged-claude/`, logs. Durable state stays
  tracked: `backlog/`, `.aidlc/runs/`, `extensions.json`, `aidlc.config.json`.
- **`/aidlc:init` Step 4.4 now specifies the whole posture** instead of one ambiguous sentence: the
  control plane **should** be its own git repo (rule-0 routing has nowhere to commit otherwise, and the
  backlog carries no history), repos are ignored by **explicit path, never a blanket `*/`** (a
  root-level `docs/` or `scripts/` must stay tracked), and the result is **verified** with
  `check-ignore` + `status --porcelain` rather than assumed. Step 2.1 no longer says the control plane
  being a repo is optional.
- **`/aidlc:repo add` writes the ignore line before creating the folder** (new §3b), so a new repo is
  never visible to the control-plane index even briefly.
- **Ignored, not submodules** — stated explicitly in `docs/architecture.md` D8, because it's the
  obvious alternative and it's wrong here: a submodule pins each repo to a commit recorded in the
  control plane, destroying the independent release cadence D8 requires.
- **`guard` hook backstop.** A `git commit` that would write an unregistered gitlink is now blocked
  (exit 2), with the remedy in the message. Paths registered in `.gitmodules` are real submodules and
  pass untouched; the check runs only for actual `git commit` invocations, reads the index that git
  has already written, and returns "allow" on any uncertainty. 8 regression tests added (40/40 pass),
  including one asserting the prescribed remedy actually clears the block.

## [0.22.0] — 2026-07-19

### `aidlc` — fix `/aidlc:sprint` being dead on arrival in a polyrepo workspace (F42)

In a poly workspace every `/aidlc:sprint` launch failed instantly and **silently**: each item's
worktree run exited within seconds at **rc=0** with a 28-byte log reading only
`Unknown command: /aidlc:run` — no run files, no commits, no board writes, and nothing an
exit-code check would catch.

- **Root cause: the launch cwd, not trust.** Sprint §2 assumed a git worktree is a self-contained
  AIDLC workspace. That holds in mono (the repo *is* the workspace, so `.claude/` and `backlog/` are
  tracked and ride into the worktree) but never in poly, where AIDLC lives entirely at the control
  plane — `.claude/settings.json` (plugin enablement + permissions), `.claude/aidlc.config.json`
  (tracker + `repos[]`), `backlog/`, `CLAUDE.md` — and the product repos have no `.claude/` at all.
  A worktree of one is a bare project with no `/aidlc:*` commands. The existing trust step was
  necessary but not sufficient: **plugin enablement is a `settings.json` concern**, while
  `hasTrustDialogAccepted` in `~/.claude.json` only clears the trust prompt.
- **Poly now launches from the control plane with the cwd unchanged — no worktree.** This costs
  nothing, because `/aidlc:run` already routes every git/branch/commit/push/PR step into
  `workspace.root/<repo.path>` (`aidlc:run` §2.5). Items in different repos are isolated by
  construction, so per-repo worktrees were adding contention risk without adding isolation. Seeding
  the worktree instead was rejected: a product-repo worktree can never be a complete AIDLC workspace
  (no `backlog/` for the markdown adapter, and `repos[]` paths are workspace-relative), so seeding
  would mean maintaining a second, degraded workspace shape.
- **Mono keeps worktrees** — there the worktree genuinely is the workspace — along with the trust
  step, plus a new note that `.claude/settings.local.json` is gitignored and therefore does *not*
  ride into a worktree (seed a copy if enablement/permissions live only there).
- **New invariant (§1.3): one in-flight item per working tree.** Without per-item worktrees, two poly
  items resolving to the same repo — or two `control-plane` items — must serialize; the second queues.
- **New §2b preflight** — before launching anything, verify the launch cwd deterministically by file
  read: `aidlc.config.json` present, `aidlc` enabled for that cwd (project or user scope), marketplace
  known, and (mono) the worktree trusted. A failure names the missing piece instead of launching.
- **New §2c launch verification — rc=0 is no longer accepted as "started."** A launch counts only on a
  run file appearing or real pipeline output. The first item runs as a **canary**: if it is dead on
  arrival, the sprint **aborts** and prints the log verbatim rather than burning the remaining slots
  on an identical environment fault.
- Docs updated to stop describing worktree-per-item as universal: `docs/architecture.md` (D7),
  `docs/adoption-guide.md` §7, `docs/user-guide.md` (interrupted sprint), `docs/example-walkthrough.md`,
  README command table.
- Versions: `aidlc` 0.21.0 → **0.22.0**, marketplace → **0.22.0** (`aidlc-stack-web` 0.10.0 /
  `aidlc-ux` 0.4.0 unchanged).

## [0.21.0] — 2026-07-18

### `aidlc` — requirements drive the architecture: init-lite + bootstrap infers topology/stack

Reworks the `init` ↔ `bootstrap` boundary so a greenfield project's **repo topology, stack, and
monolith-vs-microservices are derived from the requirements**, not answered blind before them. Previously
`/aidlc:init` interrogated the user for workspace layout, per-repo stack, split tier and CI **up front** —
which both blocked getting to `/aidlc:bootstrap` and asked the *wrong actor* (the user, with no
requirements read yet) what the requirements should decide.

- **`/aidlc:init` gains a deferred (lite) path.** A new first question — "how will this project be
  populated?" — offers **"from a requirements document/brief."** Choosing it collects only the essentials
  (project key/name, tracker + connection, verification cadence), writes a config with the architecture
  left **pending** (`architecture.status: "pending"`, no `workspace.layout`, `repos: []`, blank `stack`),
  and **skips the topology/stack questions and the tooling/structure/CI scaffolding** (Step 4.5–4.7).
  The "I know my setup / existing code" path keeps the full flow unchanged.
- **`/aidlc:bootstrap` gains a Phase 2.0 architecture-determination step.** After extracting the
  requirements, when the config is pending/unset it **infers the architecture** — style (monolith /
  modular-monolith / microservices), topology (mono/poly + repos with roles), stack, and crossRepoSplit —
  **biased to the simplest that fits (YAGNI):** it defaults to a single-repo modular monolith and escalates
  to microservices/poly only on real signals (independent scaling/deploy, distinct bounded contexts,
  multiple client surfaces, separate teams, a component needing a different runtime). It then **writes the
  resolved shape to `.claude/aidlc.config.json`** and shapes the work-breakdown to match. A human-authored
  architecture is honored, never overwritten.
- **Decision mode: silent auto-decide.** Per the chosen mode, bootstrap resolves and writes the
  architecture **without a dedicated confirmation gate** — but the derived topology/stack/style is
  **surfaced in the Phase 4 plan review** (with its rationale) before any tracker item is created, so a
  wrong mono/poly or over-eager microservices call is still catchable at the one gate that already exists.
- **Schema:** added an optional top-level `architecture` block (`status` pending|resolved, `style`,
  `resolvedBy`, `rationale`) to `docs/aidlc.config.schema.json` — the pending→resolved signal between
  init and bootstrap, and a home for the recorded architecture style (which the config didn't capture
  before).
- Versions: `aidlc` 0.20.1 → **0.21.0**, marketplace → **0.21.0** (`aidlc-stack-web` 0.10.0 /
  `aidlc-ux` 0.4.0 unchanged).

## [0.20.1] — 2026-07-18

### `aidlc` — drop the unused, always-erroring `github` MCP server from the bundle

- **Removed the bundled `github` MCP server** (`@modelcontextprotocol/server-github`) from
  `plugins/aidlc-core/.mcp.json`. Its config referenced `${GITHUB_PERSONAL_ACCESS_TOKEN}`, so **every
  project that didn't set that token got a plugin load error** — *"Invalid MCP server config for
  'github': Missing environment variables"* — even ADO-only or markdown-only projects that never
  touch GitHub. The plugin **never called the github MCP**: all GitHub operations already go through
  the **`gh` CLI** (`gh pr create` / `gh pr checks` / `gh release create` / `gh api` in
  `git-workflow`, `status`, `ci-cd`, `release`, and the devops agent). So the server was pure
  liability — bundled but unused, and forcing a token requirement on everyone. Removing it loses zero
  capability and clears the error for all token-less projects.
- **Opt back in per project** if you want the github MCP's tools available for ad-hoc use: add the
  server to your project's own `.mcp.json` with the token set (`"env": { "GITHUB_PERSONAL_ACCESS_TOKEN":
  "${GITHUB_PERSONAL_ACCESS_TOKEN}" }`). The plugin's own flows don't need it.
- The remaining bundled MCP servers are all ones the pipeline actually uses: `context7` (docs),
  `playwright` (UX rendering), `atlassian` (Jira via `wi-jira`), `azure-devops` (ADO via `wi-ado`).
- Versions: `aidlc` 0.20.0 → **0.20.1**, marketplace → **0.20.1** (`aidlc-stack-web` 0.10.0 /
  `aidlc-ux` 0.4.0 unchanged).

## [0.20.0] — 2026-07-17

### `aidlc` — new `/aidlc:bootstrap`: whole-backlog setup from a requirements document

- **New skill `aidlc:bootstrap`** — a **bulk front door** that turns a client's requirements (an
  uploaded Word/PDF, a chat brief, or both) into a complete, populated backlog in one reviewed pass:
  ingest → work-breakdown (Epic→Feature→Story→Task, every item described, every story ≥3 testable
  AC) → contribution-aware team assignment → capacity-planned sprints → create it all in the active
  tracker. It sits alongside `/aidlc:intake` (one requirement at a time) and `/aidlc:init` (which
  must run first to seed the config). Adapted from the standalone `azure-devops-planner` skill built
  for the claude.ai web app, but **moulded to the AIDLC architecture** rather than copied:
  - **Tracker-agnostic via the adapter.** The original was ADO-only and pushed via a self-contained
    HTML file with an **embedded PAT** (a workaround for the web sandbox, where `dev.azure.com` is
    unreachable and users may lack a CLI). Bootstrap instead routes every write through
    `aidlc:work-items` → the source adapter, so the same command populates **ADO, Jira, or the
    markdown backlog**, with full **write-verification**, dedup against the existing board, and
    provenance stamping (`bootstrap` label + dated note). **No HTML file, no token in a file.**
  - **Inputs the platform already owns are not re-collected** — no ADO URL, no process template, no
    PAT prompt: org/project come from `aidlc.config.json`, the adapter authenticates itself, and
    `aidlc:wi-ado` auto-detects the process and owns type/field mapping. Repo topology (mono/poly +
    `crossRepoSplit`) is read from config, not re-asked.
  - **Net-new capability kept** — document ingestion (PDF/DOCX via `pdftotext`/`pandoc`), a
    **contribution-aware team model** (Primary/Secondary/Guidance + %, with assignment rules that
    keep critical-path work off part-time contributors), FTE **capacity-based sprint planning**, and
    work-stream filtering. The team roster is **per-run only** — used to plan and assign this pass,
    not persisted to config. Ships `scripts/parse_team_file.py` (CSV/Excel roster importer) and
    `references/work_item_types.md` (per-template hierarchy/field reference for planning).
- **`aidlc:wi-ado` — added a PAT+REST last-resort tier.** The ADO write path is now an explicit
  three tiers: **`azure-devops` MCP → `az boards` CLI → PAT+REST (off by default)**. The PAT tier
  fires only when neither MCP nor `az` is reachable **and** the user supplied a token; it reads the
  PAT from the environment (never writes it to a file, never bakes it into a generated HTML pusher)
  and is bound by the identical write-verification and per-type status-category rules as the other
  tiers. This gives the standalone skill's PAT approach a home as a genuine escape hatch without
  regressing the MCP-first posture.
- Versions: `aidlc` 0.19.0 → **0.20.0**, marketplace → **0.20.0** (`aidlc-stack-web` 0.10.0 /
  `aidlc-ux` 0.4.0 unchanged).

## [0.19.0] — 2026-07-17

### Marketplace-wide rename: **SDLC → AIDLC**

- **The framework is now AIDLC (AI Development Life Cycle).** A full, mechanical rebrand ahead of the
  first public/remote release. Nothing about the behavior changed — only the name:
  - **Commands:** `/sdlc:*` → **`/aidlc:*`** (e.g. `/aidlc:run`, `/aidlc:next`, `/aidlc:status`,
    `/aidlc:init`). Plugin/command identifiers are lowercase per Claude Code's rules; **AIDLC** is the
    brand used in display names, titles and docs.
  - **Plugins:** `sdlc` → **`aidlc`**, `sdlc-stack-web` → **`aidlc-stack-web`**, `sdlc-ux` →
    **`aidlc-ux`** (directories `plugins/aidlc-*`). Skill cross-references `sdlc:*` → **`aidlc:*`**;
    agents `sdlc-*` → **`aidlc-*`**; bundled MCP tool prefix becomes `plugin_aidlc_*`.
  - **Per-project state:** the state dir `.sdlc/` → **`.aidlc/`** and config `sdlc.config.json` →
    **`aidlc.config.json`** (+ `aidlc.config.poly.example.json`, `docs/aidlc.config.schema.json`). This
    is a **breaking change for existing projects** — an `.sdlc/`/`sdlc.config.json` project must rename
    those two paths (the D:\Authentication dogfood workspace was migrated as part of this release).
  - The marketplace `name` stays **`bee-logical`** (the company marketplace); the repository is
    published as **`AIDLC`**. Install: `/plugin marketplace add <owner>/AIDLC` → `/plugin install
    aidlc@bee-logical`.
- Versions: `aidlc` 0.18.1 → **0.19.0**, `aidlc-stack-web` 0.9.0 → **0.10.0**, `aidlc-ux` 0.3.0 →
  **0.4.0**, marketplace → **0.19.0**.

## [0.18.1] — 2026-07-17

### `aidlc` — dogfood inbox stays a short live queue (F41)

- **F41 — the maintainer now prunes shipped (`pulled:F<n>`) entries from a consuming project's dogfood
  inbox once their batch merges.** The inbox is a *queue*; the plugin's `docs/dogfood-findings.md` +
  CHANGELOG are the permanent *record*. Leaving drained entries in the inbox made every future run in
  that project re-read an ever-growing log for no benefit — a recurring token cost. `aidlc:dogfood` now
  documents the prune step (a second maintainer exception to "append only") and the inbox header
  template states the queue is cleared after shipping. Applied to the Authentication inbox (its
  F34–F40 entries pruned; record preserved here). Versions: `aidlc` 0.18.0 → **0.18.1**, marketplace →
  **0.18.1** (`aidlc-stack-web` 0.9.0 / `aidlc-ux` 0.3.0 unchanged).

## [0.18.0] — 2026-07-17

### Dogfood batch F34–F40 (Authentication / Identity Platform, Cycle 3) — reliability hardening

Seven findings drained from the Authentication dogfood inbox, all in `aidlc` (core orchestration, agent
contracts, adapters). This batch is about the *reliability of the pipeline itself*: trustworthy
subagent hand-offs, no silently-truncated backlog sweeps, a clean approval path, a coherent run-file
archival story in remote/poly, and an encoded CI-parity recipe. Designed and implemented together.
Versions: `aidlc` 0.17.0 → **0.18.0**, marketplace → **0.18.0** (`aidlc-stack-web` 0.9.0 / `aidlc-ux`
0.3.0 unchanged). Full record: `docs/dogfood-findings.md`.

#### `aidlc` — subagent finish-contract (F37, F40 — a cross-agent recurrence)

- **F37 / F40 — a subagent must never return on a pending self-launched background task.** The
  implementer (F37), then the devops agent (F40), each returned a bare "still running — I'll wait for
  the background-task notification" instead of a `COMPLETE`/`BLOCKED` verdict, leaving uncommitted state
  (a half-regenerated lockfile, un-ticked plan, un-archived run file) for the orchestrator to discover
  and finish. A shared **`## Finish contract`** now sits on **all nine agents + the agent template**:
  block on the background task to a terminal state and act on the result, or return an explicit
  `BLOCKED`/`INCOMPLETE` verdict enumerating every pending task and uncommitted path — order is always
  **verify → commit → report**, synchronously. devops additionally must **poll a CI/pipeline run to a
  terminal state itself**. Orchestrator side (`run` invariants): a non-verdict is **not** a phase result
  — ground-truth the working tree, drive the remaining deterministic steps, and never blindly re-resume
  a yielding agent.

#### `aidlc` — backlog sweeps no longer silently truncate (F34)

- **F34 — full-backlog operations count-first and page to completion.** `groom` opened its sweep at
  `query({status:"todo", limit:25})`; on a ~120-item backlog that refined ~20% and reported "groomed."
  New **_Full-backlog sweeps_** contract in `work-items`: `limit` is a **page size, not a silent cap** —
  a full sweep counts the total first, then pages to completion or **states the cap out loud**. All
  three adapters updated (`wi-ado` batch-fetches the full WIQL id list; `wi-jira` pages
  `startAt`/`maxResults` and reads `total`; `wi-markdown` returns all matches when no `limit`), and
  `groom`'s sweep protocol now counts-then-covers.

#### `aidlc` — grooming approval path (F35)

- **F35 — gated actions are applied by the coordinator, not a re-dispatched subagent.** A fresh analyst
  subagent correctly refused to act on the coordinator's *claim* that the user had approved — a peer's
  assertion of consent is not consent. `groom` now states it: the approval gate lives in the coordinator
  turn, the analyst sweep is **propose-only** for gated actions, and the **coordinator itself** applies
  the approved decompositions / splits / priority / routing writes (each read-back-verified).

#### `aidlc` — run-file archival in remote/poly (F36, F39)

- **F36 — blocked→resolved runs get a real archival path.** A run resolved via a follow-up PR could
  ride into `main` still stamped `phase: blocked` and then linger as a blocked *active* run forever,
  because archiving it needed a forbidden direct-to-`main` commit. `run` §10 now folds the archive into
  the **resolving PR** so it merges in already archived; `run-state` documents the remote post-merge
  fallback (a `chore(aidlc): archive` **branch → PR**, never a direct push to the protected branch — the
  guard blocks that correctly and stays untouched).
- **F39 — batch archival: cost warned, husky unblocked, empty-branch trap closed.** `status` post-merge
  cleanup now **warns of the per-repo PR cost** ("N run files across M repos → M PRs") before starting;
  the framework's own `.aidlc/**`-only bookkeeping commits use **`git commit --no-verify`** so a
  repo-local husky/lint-staged hook (which assumes `node_modules`) can't block them; and `git-workflow`
  now requires **verifying a commit actually landed before pushing** (a hook-aborted commit otherwise
  leaves an empty pushed branch).

#### `aidlc` — CI-parity recipe (F38)

- **F38 — encoded local CI-parity recipe for a `file:`-sibling consumer.** When the orchestrator must
  ground-truth a consumer's CI gate (e.g. after a non-verdict), a `file:../sibling` consumer needs a
  **two-step install** — `npm ci` in the sibling first (so its exported eslint/tsconfig/depcruise
  configs resolve their own deps), then the consumer — run in the CI image, with **each gate step's exit
  code standing on its own** (no `&& echo OK` tail that fakes a green). Shipped in `aidlc:ci-cd`
  (_Local CI-parity for a `file:`-sibling consumer_), referenced from `run` §7.

## [0.17.0] — 2026-07-14

### `aidlc` — poly cross-repo split tier (`story` default, `task` supported)

- **New `workspace.crossRepoSplit` config (`"story"` default | `"task"`)** — makes explicit *which
  work-item tier is the single-repo runnable leaf* in poly. Epics/Features always span repos; the leaf
  (one repo = one branch = one PR) is either a **Story** (`story`: a Feature fans out to per-repo
  Stories, each Story one repo, Tasks its breakdown — the recommended default, native to ADO's
  Epic→Feature→Story→Task and forbidden Story→Story) or a **Task** (`task`: a User Story is a cross-repo
  **umbrella** of user value, its child Tasks the per-repo leaves, rolled up on completion). Both are
  first-class — pick the one your board is authored for. Canonical definition in `aidlc:work-items` →
  *Cross-repo split tier*; a worked "Profile page" example (both tiers) in the user-guide §1a.
- **The pipeline honors the knob end-to-end.** `run` §2 treats an umbrella Story (task mode) as a
  coordination parent — runs its per-repo Task children, rolls the Story up, and recognizes existing
  children instead of re-decomposing; `run` §2.5 no longer flags a cross-repo Story as an error in
  `task` mode (it's the expected umbrella) while keeping the *fix-it* path in `story` mode.
  `intake`/`groom`/`planning` propose the shape matching the configured tier. The "non-idiomatic
  umbrella" language is gone — task-tier is a supported convention, not a grudging fallback.
- Versions: `aidlc` 0.16.0 → **0.17.0**, marketplace → **0.17.0** (`aidlc-stack-web` 0.9.0 / `aidlc-ux`
  0.3.0 unchanged).

## [0.16.0] — 2026-07-14

### `aidlc` — plugin self-feedback (dogfood) channel

- **New `aidlc:dogfood` skill + `pluginFeedback` config.** A portable way for the pipeline to record
  friction with **the plugin itself** — gaps, wrong/missing guidance, steps it had to work around, a
  per-run step it had to save to memory, a broken shipped template (all distinct from *project* bugs) —
  as structured, append-only entries in a local inbox (`pluginFeedback.inbox`, default
  `.aidlc/plugin-feedback.md`). Gated behind `pluginFeedback.enabled` (default **false**, so normal
  projects stay quiet); a project used to dogfood the plugin turns it on. The `run` orchestrator
  captures friction (its own + friction surfaced in agent reports) via the skill and continues — it
  never blocks delivery. The maintainer drains the inbox into `docs/dogfood-findings.md` by reading it
  directly from disk and marks each entry's `status:` (`pulled:F<n>` / `dismissed`), so findings flow
  from a test project to the plugin without a human relaying responses by hand. Versions: `aidlc`
  0.15.0 → **0.16.0**, marketplace → **0.16.0** (`aidlc-stack-web` 0.9.0 / `aidlc-ux` 0.3.0 unchanged).

## [0.15.0] — 2026-07-14

### Dogfood batch F17–F33 (Authentication / Identity Platform, Cycle 2)

Seventeen findings from continued dogfooding on the same polyrepo + Azure DevOps build, now first
exercising the **remote/PR** integration path (the six `bee-auth-*` repos flipped to `git.mode:
remote`) plus real CI, a shared-config poly pattern, and the first security-critical design phase.
Designed and implemented together. Versions: `aidlc` 0.14.0 → **0.15.0**, `aidlc-stack-web` 0.8.0 →
**0.9.0**, `aidlc-ux` unchanged (**0.3.0**), marketplace → **0.15.0**. Full record:
`docs/dogfood-findings.md`.

#### `aidlc-stack-web` — tooling baseline & templates

- **F17 — the tooling baseline now ships a `.gitattributes`** (`* text=auto eol=lf` + binary rules).
  Stops CRLF/LF churn on Windows checkouts and keeps a Windows dev byte-identical to a Linux CI runner,
  so Prettier's `endOfLine: lf` no longer misreports CRLF as a diff (the false "files are CRLF" finding
  that cost a correction cycle). Added to the tooling README, `init` Step 4.5, and the
  `project-structure` repo-scaffold checklist (sibling of F14). The plugin repo itself also gains a
  root `.gitattributes`. Agent note added (`debugging`, checklist): confirm with `git ls-files --eol`
  before ever logging a line-ending finding.
- **F18 — shipped templates are now Prettier-clean, and scaffolds start format-clean.** Reformatted the
  template code files that genuinely failed `prettier --check` (long comments/calls prettier wraps);
  `init` and the repo-scaffold checklist now run `prettier --write .` **repo-wide** at scaffold so a
  fresh repo passes its own `format` gate at first merge; the enforced gate is stated as
  `prettier --check .` (repo-wide, not just `src/`), and must include the format step, not only eslint.
- **F21 — optional husky v9 + lint-staged pre-commit layer.** New `templates/tooling/husky/pre-commit`
  + `lint-staged.config.mjs` (eslint `--fix` + prettier `--write` on staged files). Gated behind an
  `init` prompt (opinionated-but-optional). `prepare` documented **CI-safe** (`husky || true`) because
  bare `husky` exits **127** on `npm ci` in a CI container or a `file:../` sibling checkout that lacks
  it. Poly pattern documented: the shared-config repo owns the preset, the others re-export it.
- **F26 — the three dependency-cruiser profiles set `enhancedResolveOptions`** (`exportsFields` +
  `conditionNames: [import, require]` + `mainFields`) so ESM `exports`-map subpaths (the poly
  shared-config pattern, `@beelogical/dev-config/lint-staged`) resolve deterministically across
  versions/conditions. *Verified:* dependency-cruiser 17.4.3's defaults already resolve the common
  case, so this is a robustness/explicitness fix (requires the `>= 17` floor, F30), not a change that
  flips a reproducible failure on current versions — framed accordingly in the profile comments.
- **F27 — the eslint baseline can now lint `.cjs` in an ESM package.** Split the config-files override:
  `**/*.cjs` gets `sourceType: "commonjs"` + Node globals and the require-style rules off, so
  `module`/`require`/`__dirname` no longer trip `no-undef`/`no-require-imports`. *Verified* end-to-end:
  the plugin's own shipped `.dependency-cruiser.*.cjs` now pass the baseline (the old config errored
  `'module' is not defined`).
- **F28 (design-time) — `project-structure` documents cross-repo dependency consumption.** In
  poly+remote a shared package must be **published** (required for transitive/built deps) or resolved
  via **multi-repo checkout** (leaf config deps only); an unpublished `file:../sibling` link is
  local-only and fails isolated single-repo CI.
- **F30 (floor) — `dependency-cruiser` is pinned `@^17`** everywhere the plugin adds it
  (`project-structure`, `nestjs`, `init`), with the why: `< 17` silently no-ops on `.ts` and passes the
  gate green while enforcing nothing.
- **F33 — `nestjs` testing guidance covers ESM-only deps consumed via `import()`.** A CJS repo needs
  `NODE_OPTIONS=--experimental-vm-modules` (cross-platform via `cross-env`) for jest to execute the
  dynamic ESM import, plus the `testRegex`-match gotcha for new e2e files.

#### `aidlc-stack-web` — CI templates (new)

- **F24 (templates) — new `templates/ci/`**: `azure-pipelines.yml` + `github-actions-ci.yml` (+ README)
  running the **same** deterministic gate as the local run (typecheck → lint → format → boundaries →
  build → test). Parameterized for a **self-hosted pool** (F25), **cross-platform lockfile** guidance
  (F29), a **non-empty-graph assertion** (F30), and a commented **multi-repo-checkout** block (F28).

#### `aidlc` — board fidelity (ADO)

- **F19 — parents roll up to in_progress at first-child-start.** `run` §3 transitions a still-`todo`
  parent Feature/Epic → in_progress when its first child starts (guards: only todo→in_progress, never
  pull back a later state, one tier per run, respect tracker rollup automation). Documented in
  `work-items` → *Parent rollup*; the proactive complement to F15 close-time reconciliation.
- **F20 — ADO transitions are type-aware via state category.** `wi-ado` resolves a canonical status to
  the target state through the item type's ADO **state category** (Proposed/InProgress/Resolved/
  Completed/Removed) rather than a flat global name, fixing the Epic ("In Progress") vs Story/Feature
  ("Development in Progress") divergence; the F7/F15 self-heal now keys on `(type → category → real
  state name)`; `init` populates a **per-type** `statusMap` from the work-item-type states API.
- **F22 — remote-mode ADO gets an encoded post-merge close.** ADO does **not** auto-close a linked item
  on PR merge — so `status` post-merge cleanup transitions the item → done + type-aware parent rollup,
  the ground-truth reconciliation flags "**PR merged but item still open**", and `run` §10 + `wi-ado`
  document that the DONE transition is a required post-merge step, not rediscovered per run.
- **F23 — poly+remote per-repo run files archive on the branch pre-merge.** `run` §10 `git mv`s the
  completed per-repo run file into `runs/archive/` as the final branch commit so it rides into `main`
  **already archived** — avoiding the forbidden post-merge direct-to-`main` commit that left run files
  lingering as "active." `run-state` documents the mode/layout matrix; `status` surfaces
  done-but-awaiting-merge archived runs.

#### `aidlc` — remote mode, CI & shared-package poly

- **F24 (warn) — remote mode is never silently ungated.** `init` (Step 4.7) and `status` (Step 1.6)
  warn when a `mode: remote` repo has no detectable CI / required-check policy, and `init` offers to
  scaffold the matching CI template per remote repo — remote mode's promise (CI enforces the gate
  before merge) is otherwise silently unmet.
- **F25 — `ci-cd` documents the fresh-org Azure gotchas.** Hosted parallelism can be unavailable on a
  new org (`resourceLimit: null` → `vmImage` pipelines can't run) with the request link and a
  self-hosted `pool:` fallback; `Checkpoint.Authorization` may be a missing `pipelinePermissions` grant
  at the **queue** id (distinct from pool/repo) — not always a benign wait.
- **F28 (CI + pilot) — `ci-cd` documents cross-repo package resolution under isolated CI** (publish vs
  multi-repo-checkout; `file:` siblings are local-only) and `run` (poly pilot) requires validating **at
  least one true consumer's** CI before fanning a shared-dependency pattern out — the dependency repo's
  own green never exercises the consumers' resolution path (the false-green pilot).
- **F29 — cross-platform lockfile.** `ci-cd` diagnosis + `init` prescribe generating/refreshing the
  committed `package-lock.json` in the **Linux context CI uses** (a `node:22` container), since a
  Windows/macOS-generated lock can be unsatisfiable by Linux `npm ci` (platform-specific optional deps).
- **F30 (assertion) — the CI gate asserts a non-empty module graph** (fails if depcruise analyzed 0
  `.ts` files), so a future silent no-op can't pass green. Carried by both CI templates and documented
  in `ci-cd`.
- **F31 — reproduce CI failures in the CI image before iterating.** `ci-cd` + `debugging` prescribe
  `docker run`-ing the CI runtime with the isolated single-repo checkout + `npm ci` layout to validate
  a fix green **before** slow serial remote cycles — essential for poly `file:`-sibling (F28) and
  cross-platform-lock (F29) failures that never reproduce in the local workspace.
- **F32 — doc-verifying subagents get the bundled Context7 MCP.** `aidlc-architect`, `aidlc-researcher`
  and `aidlc-security` now list the plugin-scoped Context7 tools (`resolve-library-id`, `query-docs`) —
  and `WebFetch` — in their tool grants, with an explicit sanctioned fallback documented if the harness
  can't pass the MCP through to a subagent at runtime, so version/API checks stop degrading to
  registry-only.

## [0.14.0] — 2026-07-12

### Dogfood batch F1–F16 (Authentication / Identity Platform, Epic 1)

Sixteen findings from a real end-to-end dogfood on a polyrepo + Azure DevOps + local-git-mode build,
designed and implemented together. Versions: `aidlc` 0.13.1 → **0.14.0**, `aidlc-stack-web` 0.7.1 →
**0.8.0**, `aidlc-ux` 0.2.1 → **0.3.0**, marketplace → **0.14.0**. Full design record:
`docs/dogfood-findings-archive.md`.

#### `aidlc` — poly workspace modeling

- **F1 — cross-repo work is modeled at authoring time, not improvised at run time.** `intake`, `groom`
  and `planning` now enforce the poly invariant *1 story = 1 repo*: a story/task spanning repos is
  authored as a **Feature → per-repo child Stories** (Feature-tier preferred because ADO forbids
  Story→Story parenting). `run` §2.5 formalizes the run-time safety net (decompose-and-run /
  decompose-defer / single-repo-subset) with the ADO hierarchy constraint spelled out.
- **F2 — undeclared repos get declared, not mis-routed.** New **`/aidlc:repo add <name>`** command
  declares a repo in `repos[]` **and** bootstraps the folder (`git init` + base commit + optional
  tooling/structure baseline). `work-items` routing and `run` §2.5 now offer to declare an undeclared
  repo instead of silently folding the work into another one.
- **F3 — `init` asks mono-vs-poly explicitly.** Auto-detect is a *proposal* only; a greenfield poly
  workspace (no sub-repos yet) no longer silently collapses to mono.
- **F4 — `init` bootstraps greenfield repos.** Poly `init` offers to `git init -b <default>` + base-
  commit each declared repo so the pipeline can branch into it immediately (the "first story creates
  the repos" chicken-and-egg), or documents the exact commands if skipped. Shared with `/aidlc:repo`.
- **F8 — `control-plane` is a first-class routing target.** Workspace-level items (README, cross-repo
  docs, control-plane config) resolve deterministically to the workspace root instead of ad-hoc.

#### `aidlc` — tracker robustness

- **F5 — ADO "connected" ≠ "authenticated".** `wi-ado` documents the launch-env root cause
  (`ADO_MCP_ORG` + `az login` must be present in the shell that *launches* Claude Code; mid-session
  installs need a relaunch); `status` adds a **tracker doctor** that distinguishes "MCP process up" from
  "ADO reachable + authenticated" and prints the remediation; the adoption guide gains a callout.
- **F7 — `init` populates ADO `statusMap` from the board's real states** (customized boards like
  *Development in Progress / Ready for QA*), instead of assuming Agile defaults or leaving it empty.
- **F15 — re-decomposition no longer drops requirements or orphans originals.** `work-items` gains a
  **Re-decomposition & supersession** contract: an **AC coverage map (old→new)** flags any uncovered
  criterion; superseded originals are linked + moved to a **type-appropriate terminal state** (probe
  per work-item type — `Removed` may exist for a Story but not a Task — never hard-code); no silent
  retype (create-new + link, or umbrella parent); AC field is Story-tier in ADO. `status` adds a
  **ground-truth reconciliation** step (board vs run files vs disk/git) run at epic/story close.
- **F16 — adapter writes are read-back-verified.** Every mutation (`transition`/`create`/`comment`/
  `link`/`updateAC`) must fetch the item back and assert the change landed before recording success,
  **tolerating eventual consistency** (retry/backoff, not hard-fail on first mismatch) and raising a
  hard error on persistent divergence. Stated in the `work-items` contract so it binds all trackers;
  `wi-ado` calls out the flaky `az.cmd` write that caused the live board/run-file divergence.

#### `aidlc` — gating & render defaults

- **F6 — `init` normalizes the control-plane branch** to the configured default (no `master` control
  plane while every repo says `main`).
- **F11 — the design-pod scaffold gate is deterministic in headless/sprint mode.** `run` §2 defines a
  scaffold-vs-real-UI classifier (scaffold/skeleton scope → `ui:false`, jury skipped, even in a UI
  repo; ambiguity errs to `ui:true`); `sprint` applies it with no prompt so a batched sprint never
  burns a full design run on an empty shell.
- **F13 — the render URL is resolved from the repo, not a stale config default** (see `aidlc-ux`);
  `run` §6 has the scaffold write its chosen dev-server port back to `ux.renderBaseUrl` and flag
  cross-repo port collisions; `init` derives/asks the UX dev port instead of defaulting every repo to
  :3000.

#### `aidlc-stack-web` — scaffold-template completeness

- **F9 — the dependency-cruiser boundary gate ships with every scaffold.** `project-structure` replaces
  the init-only note with a mandatory **repo-scaffold checklist** (applies to `/aidlc:init` *and* any
  `/aidlc:run` scaffold task) so `.dependency-cruiser.cjs` + `depcruise` are never silently omitted.
- **F10 — the shared/base tsconfig is documented as strictness-only** in `coding-standards-ts`
  (`moduleResolution`/`baseUrl`/`target` belong in each repo's own tsconfig) — the template was already
  clean; the principle was unstated. Enforced by the F9 checklist.
- **F12 — a pre-composed Next.js ESLint overlay** (`templates/tooling/next/`) ships the four
  ESLint-10 / Turbopack / `file:../`-monorepo reconciliations pre-solved (dedupe the `@typescript-
  eslint` plugin registration, pin `react.version`, map `.js/.cjs/.mjs` to `disableTypeChecked`,
  `turbopack.root` snippet) so every Next repo stops re-deriving them. Pins verified against the
  registry + Context7 (2026-07-12): `eslint-config-next@16.2.10` (peerDep `eslint >=9`, accepts
  ESLint 10), `react@19.2.7`; `eslint-plugin-react` rides transitively at `7.37.5` — the `react.version`
  pin (workaround #2) is required precisely because no stable `eslint-plugin-react` yet declares native
  ESLint-10 support (documented, with a "drop the pin when it does" note). Overlay README instructs
  adopters to confirm with `eslint --print-config` per repo.
- **F14 — a hardened `.gitignore`** (`templates/tooling/.gitignore`) ignores `.env*` with a
  `!.env.example` allow-exception — secret hygiene by default, a real concern for auth/identity repos.

#### `aidlc-ux` — jury render resolution & scope gate

- **F11 — pod-scope gate** in `design` mirrors the core scaffold-vs-UI classifier so the pod
  self-applies skeleton-only when invoked standalone on a scaffold scope.
- **F13 — the jury resolves the render URL from the repo's actual `dev`/`start` port** at render time
  (parsed from `package.json`), using `ux.renderBaseUrl` only as a fallback, preferring the derived
  port on mismatch, and **failing loud on a non-UI response** (JSON/404) so a wrong-server render can
  never silently score. Mirrored across `design`, `design-jury` and the `aidlc-ux-jury` agent.

## [0.13.1] — 2026-07-11

### Added

- **ADO Feature handling in `wi-ado` (`aidlc`).** Azure DevOps nests Epic → Feature → User Story →
  Task/Bug, but the canonical schema has no `feature` tier. The adapter now maps **both Epic and
  Feature → canonical `epic`** (decomposable parents), preserving the real ADO type in
  `sourceRaw.adoType` so writes never convert one into the other. `query` excludes Features as well
  as Epics from ready work; decomposition creates User Story children parented under the Feature
  (or under an Epic per the project's convention). Previously a Feature could surface in ready-work
  queries and fail to classify. Version: `aidlc` 0.13.0 → **0.13.1**, marketplace → **0.13.1**.

## [0.13.0] — 2026-07-11

### Changed — per-agent verification cadence; economical defaults (`aidlc`)

- `pipeline.verification` moves from a global `mode`/`scope` + on/off toggles to **per-agent
  cadence**: `reviewer`, `qa` and `security` each take `off | on-demand | per-item | per-epic`
  (security also `risk-based`), plus `securityConfirm`. The old global `scope` field is removed
  (folded into per-agent cadence).
- **New defaults are economical** — `reviewer: on-demand`, `qa: on-demand`, `security: per-epic`
  (`securityConfirm: true`). A typical item now runs **no LLM verification agent**: you invoke
  reviewer/QA on demand (re-run and ask), and security runs once per epic **after you confirm**. The
  deterministic CI gate (lint/format/typecheck/boundaries/tests) + the implementer's own test run are
  the per-item floor, and the bug failing-repro-test still runs at implement. (Previous default:
  reviewer + QA on every item + risk-based security — thorough, but the biggest recurring token/time cost.)
- Wired through `run` §7 (verify) and §2 (epic consolidation runs the per-epic agents; security
  confirmed), the config schema, both scaffolded configs, `init` (Economical / Balanced / Thorough /
  Manual profiles) and the user guide. Teams wanting the old behavior set all three to `per-item`.
- Version: `aidlc` 0.12.2 → **0.13.0**, marketplace → **0.13.0**.

## [0.12.2] — 2026-07-11

### Added

- `aidlc:intake` now stamps **provenance** on every item it creates — an `unplanned` label plus a
  `Provenance: created via /aidlc:intake on <date> — "<ask>"` note in the description — so
  request-born work (asked for directly, outside the planned backlog) stays queryable later. It's
  tracker-agnostic via the adapter contract: the label maps to markdown frontmatter, Jira labels or
  ADO `System.Tags` identically, and the note goes in `description` everywhere. Filter on `unplanned`
  to see everything that entered outside planning. Version: `aidlc` 0.12.1 → **0.12.2**, marketplace → **0.12.2**.

## [0.12.1] — 2026-07-11

### Changed

- `aidlc-researcher` agent runs on **Opus** (was Sonnet). Spikes are high-stakes technology-selection
  decisions that downstream stories build on; the deeper tier is worth it. Behavior/protocol
  unchanged — it still blends codebase + Context7 + WebSearch + a scratchpad PoC and delivers a cited,
  date-stamped decision report. Version: `aidlc` 0.12.0 → **0.12.1**, marketplace → **0.12.1**.

## [0.12.0] — 2026-07-11

### Added — dependency policy, vetted at install time (`aidlc`)

- New `dep-vet` PreToolUse hook gates package-ADD commands (`npm i <pkg>`, `npm install <pkg>`,
  `pnpm|yarn|bun add …`) and asks the operator to vet the package **before** it's installed and coded
  against — so a bad/stale/incompatible choice is caught early, not reworked in verify. Bare lockfile
  installs (`npm ci`, `npm install`, `pnpm i`) and `npm run` scripts are untouched. Ships
  `dep-vet.test.mjs` (21-case detection matrix).
- `aidlc:security` §4 is now the canonical **Dependency policy** — deliberately *not* an allow-list
  (that would handcuff projects): any package is fine if it clears three tests — **safe** (maintained,
  no typosquat, clean license/scripts, no open CVEs), **latest stable** (current stable version,
  verified via Context7/registry, no prereleases), and **compatible** (satisfies peerDependencies +
  `engines`; never `--legacy-peer-deps`/`--force` to silence a peer conflict). `coding-standards-ts`
  (add-time) and `maintenance` (bump-time) cross-link it.
- Version bumps: `aidlc` 0.11.0 → **0.12.0**, marketplace → **0.12.0**, `aidlc-stack-web` 0.7.0 →
  **0.7.1** (coding-standards pointer). `aidlc-ux` (0.2.1) unchanged.

## [0.11.0] — 2026-07-11

### Added — enterprise project structure, scaffolded + boundary-gated (`aidlc-stack-web`, `aidlc`)

- New `aidlc-stack-web:project-structure` skill — the canonical enterprise folder trees: NestJS
  backend (`modules/<feature>` + `common/{filters,guards,interceptors,pipes,decorators,constants}`,
  thin controller → service → repository) and **two frontend flavors** — `next-app` (App-Router-first,
  server components own data, RTK for client state) and `rtk-spa` (RTK Query as the primary data
  layer) — with layering rules, RTK/RTK Query conventions, `components/{ui,features}` + custom-hooks
  taxonomy, and a centralized `common/constants/{http-status,messages}` module (no inline strings).
- Ships `templates/structure/`: three `dependency-cruiser` boundary configs (backend / next-app /
  rtk-spa) and canonical reference files (NestJS exception filter mapping to the api-design error
  shape + constants; RTK `store/{index,hooks,api/base-api}`).
- `/aidlc:init` asks the frontend flavor and scaffolds the matching skeleton per TS repo (per-repo in
  poly, merge-aware, skips non-TS); `aidlc:ci-cd` runs `depcruise` in the PR gate so layering
  violations (feature→feature internals, controller→repository, `ui`→`store`) fail the build
  regardless of `verification.mode`. `nestjs`/`nextjs` skills cross-link the structure; Next adopts
  the RTK/RTK Query state stance.
- Version bumps: `aidlc-stack-web` 0.6.0 → **0.7.0**, `aidlc` 0.10.0 → **0.11.0**, marketplace → **0.11.0**.

## [0.10.0] — 2026-07-11

### Added — strict web-stack tooling baseline (`aidlc-stack-web`, `aidlc`)

- `aidlc-stack-web` now ships a **deterministic quality baseline** in `templates/tooling/`:
  `tsconfig.base.json` (strict — `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, unused
  locals/params, …), `eslint.config.mjs` (flat, type-aware: `typescript-eslint` strict-type-checked
  + stylistic, `no-explicit-any`, `consistent-type-imports`, Prettier last), `.prettierrc.json`,
  `.editorconfig`, `.npmrc` (`engine-strict` + `save-exact`), and a README with the exact devDeps +
  scripts.
- `/aidlc:init` scaffolds the baseline into every TypeScript repo (per-repo in poly; **merge-aware** —
  never clobbers configs you already have; skips non-TS repos); `aidlc:ci-cd` runs
  `typecheck → lint → format → build → test` as a **hard PR gate that holds even when the reviewer is
  toggled off**. `coding-standards-ts` now states the division of labour: tools own the mechanical
  rules, the reviewer owns judgment (validate-at-edge, state modelling, dependency choice).
- Rationale: the coding standards were previously enforced mainly by the LLM reviewer and assumed a
  strict project config existed. This shifts the mechanical half to tooling that runs on every commit
  and in CI — "the code can't just work however it's written."
- Version bumps: `aidlc-stack-web` 0.5.0 → **0.6.0**, `aidlc` 0.9.1 → **0.10.0**, marketplace → **0.10.0**.

## [0.9.1] — 2026-07-11

### Fixed

- **Bash guard hook false-tripped on tokens inside commit messages (`aidlc`).** The push guard
  flagged any command that merely contained the words `git` … `push`, so a legitimate
  `git commit -m "…push…"` on `main` was blocked; the same class hit commit messages mentioning
  `TRUNCATE TABLE`, `git filter-branch`, `prod`/`psql`, `id_rsa` or `rm -rf /`. The guard now
  inspects the command being executed, not free text: quoted argument text is stripped before
  command-identity detection, `git push` is matched as an actual subcommand, and the DB/prod/
  credential/rm content checks are skipped for `git` segments (git runs none of those) while
  cross-pipe `.env` exfil still scans the whole command. Adds `guard.test.mjs`, a 33-case
  block/allow regression matrix. Version: `aidlc` 0.9.0 → **0.9.1**, marketplace → **0.9.1**.

## [0.9.0] — 2026-07-11

### Added — local git mode (no remote required) (`aidlc`)

- New `git.mode` (`remote` default | `local`) — per-repo in poly, top-level in mono. Lets a project
  run the full pipeline **before it has a git remote**: no push, no PR. After green verify the
  pipeline shows the commits + diffstat and integrates via a **user-confirmed local `--no-ff` merge**
  into the default branch — the framework's one mandatory human gate is relocated (PR review →
  merge approval), never removed. Non-interactive/declined → parks at `review-pending` with
  instructions, never merges unattended. Default `remote` = existing push+PR behavior, unchanged.
- Repo-aware across `git-workflow` (new *Local mode* section), `run` §8 (integrate = PR or local
  merge), `init` (detects a missing remote and proposes `local`), `status` (PR column shows
  `local-merge:<sha>`), `release` (tags locally, skips publish), the always-on git-workflow rule,
  the config schema + scaffolded template. Flip `git.mode: remote` once an origin exists.
- Version bumps: `aidlc` 0.8.0 → **0.9.0** (minor — new feature), marketplace 0.8.0 → **0.9.0**.
  `aidlc-ux` (0.2.1) and `aidlc-stack-web` (0.5.0) unchanged.

## [0.8.0] — 2026-07-11

### Added — polyrepo (multi-repo) support (`aidlc`)

- A workspace can now hold **many git repos** (e.g. `backend/`, `frontend/`, `website/`, `mobile/`),
  not just one. **Mono is unchanged and remains the default** — an empty `repos[]` behaves exactly as
  before, so existing projects need zero migration.
- New config: `workspace.layout` (`mono` | `poly`) + `repos[]` (per-repo `name`, `path`, `host`,
  `remote`, `defaultBranch`, `branchPattern`, `stack`, `labels`, optional per-repo `ux`, `default`).
  The control plane (`.claude/`, `backlog/`, `.aidlc/`) lives at the workspace root; product repos are
  subfolders. Ships `.claude/aidlc.config.poly.example.json` and the previously-missing
  `docs/aidlc.config.schema.json` (validates both shapes).
- **Orchestrator-driven routing.** You describe a requirement in plain language; the orchestrator
  grounds it against the actual repos and routes each item to one repo (explicit `repo` → label →
  default → ground → ask). Cross-repo features become an **epic** whose child stories each target one
  repo, sequenced by a new `dependsOn` field; a control-plane coordination file rolls them up.
- **Invariant: 1 run = 1 item = 1 repo = 1 branch = 1 PR** — every PR stays small and independently
  reviewable, and each child run is atomic and resumable.
- Repo-aware across the pipeline: `run`, `git-workflow`, `ci-cd` (host from the resolved repo),
  `work-items` schema + all three adapters (markdown/Jira/ADO map `repo` + `dependsOn`), `intake`,
  `groom`, `next` + `status` (multi-location run-file scan; unified board + Repo column + epic
  rollup), `sprint` (worktrees per target repo), `release` (per-repo), `init` (poly setup), the
  `aidlc-ux:design` pod (operates in the resolved frontend repo and reads its own `ux`), and the
  `session-context` / `checkpoint` hooks (scan every repo's run dir).
- Version bumps: `aidlc` 0.7.4 → **0.8.0** (minor — new feature), `aidlc-ux` 0.2.0 → **0.2.1**
  (poly-aware design handoff), marketplace 0.7.4 → **0.8.0**. `aidlc-stack-web` unchanged (0.5.0).

## [0.7.4] — 2026-07-09

### Fixed

- **Duplicate hooks-file load error (`aidlc` → 0.7.3).** Current Claude Code auto-loads a plugin's
  standard `hooks/hooks.json`, so the manifest must not also point at it. Removed
  `"hooks": "./hooks/hooks.json"` from `plugins/aidlc-core/.claude-plugin/plugin.json`; the hooks
  still load automatically from the standard path. Fixes: *"Failed to load hooks … Duplicate hooks
  file detected … manifest.hooks should only reference additional hook files."*

## [0.7.3] — 2026-07-09

### Added — user-controlled verification cadence (`aidlc` → 0.7.2)

- New `pipeline.verification` config block puts the review/QA cost — the pipeline's biggest
  recurring spend — in the user's hands:
  - `mode`: `auto` (AIDLC runs reviewer + QA, current behavior), `manual` (AIDLC skips the agents and
    opens the PR for the human to review; run ends at a new `review-pending` phase; issues fed back
    by rerunning `/aidlc:run <ID>`), or `ask` (pipeline prompts per item).
  - `scope`: `per-item` (verify every item, default) or `per-epic` (children skip per-item review;
    one consolidated pass when the epic's children are all implemented).
  - `reviewer` / `qa` / `security` toggles for fine control (e.g. keep the fast code review, drop
    the heavier QA test-authoring).
- `/aidlc:init` now asks for the verification cadence up front.
- Safety preserved: in every mode the implementer still runs lint + tests to green before a PR, and
  the human merge of the PR remains the final gate — `manual` just skips the *extra* bot pre-review
  (and flags the PR as un-reviewed by bots). `security: off` on a risky diff leaves a visible note.
- Default is unchanged (`auto` / `per-item`) so existing projects behave exactly as before until
  they opt into a cheaper cadence.
- Docs: user guide §3b (cadence table + manual feedback loop), example walkthrough (init option),
  architecture (extension point).

## [0.7.2] — 2026-07-09

### Changed

- **`aidlc-ux` enabled by default.** The design pod now ships `defaultEnabled: true` in the
  marketplace — no manual install/enable step. It stays dormant on backend/infra items, so
  non-UI projects are unaffected; turn it off per project with `ux.enabled: false`.
- **Hardened UI detection in the orchestrator (`aidlc` → 0.7.1).** The decision to invoke the
  design pod moved from a soft path-glob check during implement to an explicit determination at
  the **classify** step, recorded as `ui:` on the run file. Signals: a `ui`/`ux`/`design`/`frontend`
  label, OR the title/description/AC mentioning a screen/page/component/layout/visual/motion/
  redesign, OR a frontend stack with an item that clearly renders something. When unsure on a
  frontend item it defaults `ui: true` (an over-invoked jury is cheap; a missed one ships un-judged
  UI). The auto-invocation now also passes the resolved **scope, mode and brand** through, so the
  autopilot behaves the same as running `/aidlc-ux:design` by hand. Run-file template gains
  `ui` / `uxScope` / `uxMode`.
- Docs updated: user guide (§3a design-pod section + cheat-sheet + troubleshooting), example
  walkthrough (§6a/§6b showing the pod on the todo UI + a brand-anchored redesign), adoption guide
  and architecture.

## [0.7.1] — 2026-07-09

### Added — `aidlc-ux` plugin (v0.2.0): existing projects, scope targeting & brand references

- **Works on existing projects, not just greenfield.** `/aidlc-ux:design` now resolves a **scope**
  (a page/route/screen, a path/glob, or the whole app) and a **mode**:
  - `greenfield` — establish the design system; it becomes the project standard every later UI item
    adopts (implemented and followed throughout).
  - `retrofit` — redesign a specific page/screen while **adopting the project's established system**
    first, so the target stays uniform with the rest of the app.
  - `redesign` — whole-app redesign that may replace and re-propagate the system.
- **UI audit step** for existing surfaces: renders the current UI (Playwright) + sibling screens,
  and `aidlc-design-system` (new **audit mode**) extracts the current design language, flags
  inconsistencies, and recommends conform / elevate-in-place / replace → `design/audit.md`.
- **Brand references** (new + existing): pass a logo, colors, fonts, or reference screenshots (in
  `$ARGUMENTS`, in `ux.brand.referenceDir` = `design/brand/`, or via the `ux.brand` config). They're
  treated as **hard constraints** — the design-system extracts a palette from the logo, matches
  fonts (best-effort, flags ambiguous screenshot matches for confirmation), and honors supplied
  values exactly. Catalogued in `design/brand.md`.
- Jury now scores **cross-page consistency + brand adherence** on scoped redesigns (target must not
  be a lone island in a different style), using sibling-page shots.
- New `ux.brand` config block; new `audit.md` and `brand.md` templates.

## [0.7.0] — 2026-07-09

### Added — `aidlc-ux` plugin (new, opt-in): the UI/UX design pod

- A five-role pod for award-tier, uniform desktop-web UI:
  - `aidlc-ux-writer` (sonnet) — writes `design/narrative.md`: the experience story (vision, tone,
    journey, one signature moment) that every downstream decision must trace back to.
  - `aidlc-ux-researcher` (sonnet) — mines Awwwards/FWA and current best-in-class work (WebSearch/
    WebFetch) for cited, transferable techniques → `design/inspiration.md`.
  - `aidlc-design-system` (sonnet) — the **uniformity anchor**: color/type/spacing/radius/elevation
    tokens emitted to code as the single source of truth, WCAG-AA contrast verified.
  - `aidlc-motion` (sonnet) — animation, micro-interactions, scroll/parallax, GSAP, sequencing —
    within a 60fps + `prefers-reduced-motion` budget; realizes the signature moment.
  - `aidlc-ux-jury` (opus) — strict, **unbiased** Awwwards-style judge. Renders the built UI with
    Playwright, screenshots it, scores a weighted rubric /10 with mandatory visual evidence, blind
    to the makers' reasoning. A 9 is rare and must be earned.
- `/aidlc-ux:design <item|path|description>` — the pod pipeline: narrative → research → design system
  → build + motion → **jury loop until composite ≥ `ux.juryThreshold` (default 9)**, capped at
  `ux.maxJuryRounds` (default 3). At the cap it ships the best-scoring round, attaches the jury's
  remaining critique, and flags for human — never loops forever, never escalates models.
- Skills: `design` (orchestration), `ux-narrative`, `design-research`, `design-system`, `motion`,
  `design-jury` (rubric + anti-bias + render protocol). Templates for all five `design/*` artifacts.

### Changed — `aidlc` plugin

- Orchestrator (`/aidlc:run`): UI-touching items now route the frontend through `aidlc-ux:design`
  (jury gate included) when `aidlc-ux` is installed and `ux.enabled` — no hard dependency; core still
  runs standalone.
- Project `aidlc.config.json` gains a `ux` block (`enabled`, `target: desktop-web`, `juryThreshold`,
  `maxJuryRounds`, `juryPanelSize`, `renderBaseUrl`, `uiPaths`).

## [0.6.1] — 2026-07-09

### Fixed

- **Agent model identifiers**: all agents pinned invalid model ids (`claude-sonnet`,
  `claude-opus`, `claude-haiku`) which Claude Code could not resolve — subagents died with an
  API error and the orchestrator fell back to the session's (larger) model. Corrected to the
  valid tier aliases (`sonnet` / `opus` / `haiku`), so each agent runs on its intended tier.
- Orchestrator invariant added: a subagent model/API failure must be reported, never worked
  around by escalating to a larger model.

## [0.6.0] — 2026-07-09

### Added — `aidlc` plugin (requirement intake)

- `/aidlc:intake <text>`: the pipeline's front door for requirements that exist only in the
  user's head — analyst grounds the requirement in the codebase, sweeps the existing backlog
  (skip covered / delta-only for partial overlap / flag in-flight conflicts), proposes the
  item set (epic+stories or single story/bug/task) with AC, creates on approval in the active
  tracker (Jira/ADO/markdown).
- `/aidlc:run <free text>`: non-ID arguments route through intake, then the pipeline runs the
  first created item — "describe it and it gets built".
- Analyst agent: intake mode (propose-only; the orchestrator creates after approval).

## [0.5.0] — 2026-07-08

### Added — `aidlc` plugin (Phase 5: self-extension & scale)

- `scaffold-skill` / `scaffold-agent`: create project-local capabilities from the templates,
  with mandatory `x-aidlc` metadata and the agent-test justification; registered in
  `.aidlc/extensions.json` with reuse tracking.
- Capability-gap protocol in the orchestrator: search plugins → local → registry before
  creating; reuseCount bumped on every reuse; `/aidlc:status` surfaces promotion candidates.
- `/aidlc:promote`: validate (secret scan, lint) → generalize (project specifics → config
  references, with a shown diff) → package into the right plugin on a `promote/<name>` branch
  → PR with the reviewer checklist. PR opening is user-confirmed.
- `/aidlc:sync`: post-merge reconciliation — deletes local forks shadowed by promoted plugin
  versions, resolves shadowing conflicts, reports promotion-ready candidates.
- `/aidlc:sprint N`: parallel independent items — analyst independence check, one git worktree
  + headless pipeline run per item, live board from run-file polling, queued conflicts,
  worktree cleanup on completion.
- Governance: `docs/promotion-policy.md` (acceptance bar + reviewer checklist), CODEOWNERS
  making `plugins/**` platform-team owned.

## [0.4.0] — 2026-07-08

### Added — `aidlc` plugin (Phase 4: depth agents)

- `aidlc-architect` (opus): explores the codebase, plans items ≥ `architectThreshold`, writes ADRs.
- `aidlc-security` (opus): deep security pass — input→sink tracing, authz, dependency audit —
  auto-triggered by `securityReviewPaths` overlap, manifest changes, or `security` label.
- `aidlc-devops`: docker/CI/release items and red-PR-check diagnosis.
- `aidlc-docwriter` (haiku): docs phase; amends the PR with `docs(...)` commits.
- `aidlc-researcher`: spike items → cited decision reports in `docs/research/`.
- Skills: `architecture` (ADR discipline), `security`, `ci-cd`, `release` (`/aidlc:release`),
  `docs-writing`, `research`, `maintenance`; ADR template.
- Orchestrator wiring: security agent joins the verify batch conditionally; spikes route to the
  researcher; infra-only plans route to devops; red CI checks get a diagnosis pass.

### Added — `aidlc-stack-web` plugin (new)

- Stack expertise skills: `coding-standards-ts`, `nextjs` (App Router), `nestjs`, `postgres`,
  `mongodb`, `db-migrations` (expand-contract), `docker`, `api-design`.

## [0.3.0] — 2026-07-08

### Added — `aidlc` plugin (Phase 3: real trackers + Azure)

- `wi-jira` adapter: Jira via Atlassian MCP — JQL queries, transition-by-target-status,
  AC field/section detection, dev-panel linking, per-project `statusMap`.
- `wi-ado` adapter: Azure Boards via ADO MCP with `az boards` CLI fallback — WIQL queries,
  Agile/Scrum process detection, state-stepping with tag fallbacks, HTML field mapping.
- Azure Repos PR path in `git-workflow` (`az repos pr create` + work-item linking).
- `/aidlc:groom` — analyst-driven backlog refinement with autonomy boundaries
  (AC/sizing applied; decompositions and priority changes proposed only).
- Bundled MCP: `atlassian` (remote, OAuth) and `azure-devops` servers.
- Project template: `.mcp.json.example` with optional read-only Postgres/MongoDB, Sentry,
  Notion, Figma servers.

## [0.2.0] — 2026-07-08

### Added — `aidlc` plugin (Phases 0–2)

- Marketplace + plugin manifests; installable via `/plugin marketplace add`.
- Project template (`templates/project/`) scaffolded by `/aidlc:init`: CLAUDE.md, permissions
  posture, `aidlc.config.json` switchboard, always-on rules, markdown backlog spec, run-state folders.
- Orchestrator pipeline `/aidlc:run`: fetch → classify → requirements → plan → implement →
  verify (review + QA parallel, fix cycles) → PR → wrap; resumable via run files.
- `/aidlc:next`, `/aidlc:status` commands.
- Work-item adapter layer: canonical WorkItem schema + 7-operation contract; `wi-markdown` adapter.
- Agents: `aidlc-analyst`, `aidlc-implementer`, `aidlc-reviewer`, `aidlc-qa`.
- Phase skills: requirements, planning, git-workflow, code-review, testing, debugging, run-state.
- Hooks (Node, cross-platform): bash guard, protected paths, format-on-save, session context
  snapshot, run-state checkpoint/notify.
- Bundled MCP config: context7, github, playwright (auth per user).
- Docs: adoption guide, architecture (incl. phases 3–5 roadmap), permissions rationale.
