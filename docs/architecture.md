# Architecture — Bee-Logical Claude AIDLC

**Status:** All phases (0–5) implemented + polyrepo + team mode · core v0.42.x · `aidlc-ux` design pod v0.6.x

## 1. Core design decisions

**D1 — The orchestrator is a main-thread skill, not a subagent.** Subagents cannot spawn other
subagents; only the main session owns the user interaction, permission prompts and the Agent
tool. `/aidlc:run` therefore loads a state machine + router into the main session, which
dispatches specialist subagents per phase. The orchestrator holds routing logic only; durable
state lives in run files.

The main session is also where the pipeline's **interactive gates** can exist at all — the `ask`
verification mode, the security confirm, the local-merge confirmation, the cross-repo-split choice.
A subagent has no channel to the user, so as a subagent each of those would silently take a default.

Being in the main session is *reach*, not *permission*, so entry is gated separately: `run` carries
**`disable-model-invocation: true`**, like every other command that writes (`init`, `adopt*`, `sprint`,
`sync`, `repo`, `promote`, `remove`, `bootstrap`, `review-feedback`). It is the most side-effectful command in the
framework — branch, commit, push, PR — and must never be entered because a prompt merely *sounded* like
work. Its three doors are all a human choosing it: a typed `/aidlc:run`, a headless
`claude -p "/aidlc:run {ID}"` from `sprint`, or an explicit handoff from `next`/`do`/`intake` after the
user invoked one of *those*. Since the Skill tool cannot reach a model-invocation-disabled skill, those
handoffs read `skills/run/SKILL.md` and follow it verbatim — which makes the handoff a written
instruction rather than the model's discretion, and that is the property worth having. `/aidlc:do` is
the deliberately open front door: it grounds first, routes second, and creates nothing on its own.

**D2 — Run files are the single source of truth.** `.aidlc/runs/<ID>.md` records phase, plan,
assumptions, findings and log. It survives compaction (PreCompact hook forces a flush),
session restarts (SessionStart hook re-injects a snapshot), and crashes (`/aidlc:run` resumes
from the recorded phase). It's committed to the feature branch, so every PR carries its own
audit trail. Tracker comments are the *external* progress signal; the run file is the
*internal* machine state; the run file wins on conflict.

**D3 — Agents only where isolation pays.** An agent needs its own context window (big
exploration/diffs), a different tool surface, or independent adversarial judgment (the
reviewer must not share the implementer's reasoning). Everything else — docker knowledge,
Postgres patterns, commit conventions, adapter mechanics — is a skill loaded on demand by
whoever needs it. This is why there is no "postgres agent" and no "bug-fix agent".

**D4 — One schema, pluggable trackers.** The pipeline speaks the canonical WorkItem schema
through an 8-operation adapter contract (`fetch, query, children, create, transition, comment,
link, updateAC`). Jira/ADO/markdown are adapter skills selected by `.claude/aidlc.config.json`.
Adding a tracker = one new `wi-*` skill, zero orchestrator changes.

What the contract deliberately **omits** is as load-bearing as what it has: no op sets `priority`,
edits a `dependsOn` edge on an existing item, assigns a sprint, or writes an **estimate**. Those
fields carry human intent — what was asked for, and what it was judged to cost — so the pipeline
re-orders *its own execution* (`.aidlc/plan.md`) and moves items through their *states*, leaving the
board's judgment to the humans who authored it.

**D5 — Flat token cost.** Always-loaded context is capped (~120 lines: project CLAUDE.md +
two rules files). The framework's bulk (playbooks, stack expertise, adapters) costs zero
tokens until a task triggers it.

**D6 — High autonomy, hard guardrails.** Allow the full story→PR path; deny irreversible /
production / secret / self-modification operations; ask on ambiguous blast radius. Two layers:
static permission rules + context-aware hooks (branch-aware push guard, exfil patterns,
protected paths). For **tracked** work, humans keep one mandatory gate: PR review + merge. When a repo has
no remote (`git.mode: local`, per-repo) there is no PR — the gate is *relocated, not removed*: the
pipeline integrates via a **user-confirmed local `--no-ff` merge** into the default branch after
green verify, and never merges unattended. Default is `remote` (push + PR), so nothing changes for
projects with an origin.

The guardrail that survives every tier, including the lightest, is narrower and sharper than "one PR per
change": **nothing reaches the default branch unattended.** A tier-1 direct change may *commit* there — a
local commit is `git reset` away — and the branch-aware push guard still stands between it and anyone
else. Reversibility, not ceremony, is what the gate is protecting.

**D7 — Parallelize independent work; serialize anything that mutates a shared tree.** The rule
is *isolation, not just similarity* — two units run concurrently only when they cannot collide on
files or on each other's outputs. It applies at four levels, coarsest grain first:

- **Item level (`/aidlc:sprint`).** Independent backlog items each get a headless
  `claude -p "/aidlc:run <ID>"` background process, aggregated into one board. An `aidlc-analyst`
  **independence check** (file/subsystem overlap, cross-referencing AC, parent-epic ordering — the
  same detection `aidlc:planning` uses) selects a conflict-free set; conflicting items queue behind
  their counterpart. What makes it safe is **one in-flight item per working tree**, achieved
  differently per layout: in **mono** each item gets its own **git worktree**; in **poly** the runs
  launch from the **control plane** and `/aidlc:run` routes each into its own repo checkout (§2.5),
  which is already separate — so a worktree would add contention without adding isolation. A poly
  worktree of a *product* repo is not a viable launch target at all: AIDLC's plugin enablement,
  permissions, config and backlog all live at the control plane, so such a worktree has no
  `/aidlc:*` commands (F42).

  **Which items make up that set can be decided ahead of time rather than at launch.** When a
  `/aidlc:replan` has run, the conflict-free set is the next **wave** of `.aidlc/plan.md`, packed against
  these same constraints by `resolve-waves.mjs` (D11). Sprint still applies the two checks the packer
  cannot make — the analyst's file/subsystem overlap read, and a re-assertion of one-item-per-tree — so
  the plan proposes and the launch verifies.
- **Phase level (`/aidlc:run` §verify).** The **reviewer and (conditional) security** agents are
  dispatched in **one parallel batch** — they only read the diff, so there's nothing to collide on.
  **QA is dispatched after that batch returns, not in it:** its verify mode authors and *commits*
  tests, and those commits move `HEAD` under a review in progress — leaving findings written against
  a diff that no longer exists, plus two agents committing to one branch. Which is D7 itself applied
  honestly: *isolation, not similarity*. The three look alike (all "verification"), so batching them
  reads as obvious, but one of them mutates the tree — and that is the only property that decides.
  Fix cycles that follow are serial (one implementer mutates the branch).

- **Plan-task level (`/aidlc:run` §implement, `pipeline.implementFanout`).** Where a plan's tasks touch
  **provably disjoint paths**, several implementers work them at once in one checkout. What makes this
  legal under this decision is that *the agents do not commit* — they edit and report, and the
  orchestrator commits each task's declared paths in plan order. **git is the shared tree; the files are
  not.** Six screens getting the same pagination treatment never touch each other; only the index and
  HEAD are contended, so the fix is to remove the racing committer, not the parallelism. The schedule is
  computed by `skills/run/resolve-fanout.mjs` (semantics pinned by `resolve-fanout.test.mjs`) and it never
  reorders — it only collapses *contiguous* plan tasks into a window, so the plan still reads as what
  happens.

  Three things it refuses to guess, because each failure is silent rather than loud: a task with **no
  declared paths** is never parallelized; **two globs** that cannot be cheaply compared are assumed to
  overlap; and **disjoint paths do not imply independence** — a task whose output a later task imports
  must declare `foundation`/`dependsOn`, since no path analysis can see an import edge. The asymmetry
  driving all three: over-serializing costs wall-clock and says so out loud, under-serializing loses code
  and says nothing.

- **Design pod (`aidlc-ux:design`).** The jury panel (`ux.juryPanelSize` jurors) and the
  design-system / motion / implementer fix agents each run as a batch when their work is independent.
This narrows, and does not repeal, the old reading that IMPLEMENT is *inherently* serial. What must stay
serial is **mutation of a shared tree** — one committer, one branch, and any task touching an aggregator
(a barrel export, a route table, a lockfile, an i18n catalog, a declared `apiContracts` path) where "one
writer at a time" is the whole point. As `sprint` puts it: *parallelism multiplies mistakes too* — so the
default is serial, disjointness is proven rather than assumed, and concurrency is taken only where
isolation is demonstrable.

**D8 — One workspace, one or many repos; everything resolves to a repo entry.** A project is either
**mono** (one git repo for everything — the default, unchanged) or **poly** (a workspace holding
several git repos, e.g. `backend/`, `frontend/`, `website/`, `mobile/`, each with its own remote).
The design that keeps both on one code path with zero migration:

- **The config always yields a list of repo entries.** `repos[]` in `.claude/aidlc.config.json` defines
  them in poly; in mono the resolver **synthesizes a single entry** from the legacy top-level
  `git`/`stack`/`ux` blocks. Mono is just a one-entry registry, so every downstream consumer
  (orchestrator, `git-workflow`, `status`, `sprint`, `release`) is written once against repo entries.
  (Resolver spec: `aidlc:work-items` → *Repos & routing*.)
- **The control plane is the workspace root.** `.claude/`, the shared `backlog/` and `.aidlc/` live at
  the top; the product repos are subfolders under `workspace.root`. One backlog and one board span all
  repos — the home for cross-repo features. **The control plane is itself a git repo** (it versions the
  backlog, config, epic coordination files and cross-repo ADRs, and rule 0 routing branches there), and
  it **ignores every product-repo checkout by explicit path** — the `# AIDLC:REPOS` block in its
  `.gitignore`, maintained by `init` and `repo add`. Nested-and-ignored, never submodules: each product
  repo keeps its own remote and release cadence, which a submodule pin would destroy. Committing one
  from the control plane instead writes a mode-160000 gitlink with no `.gitmodules` — it clones as an
  empty directory and git reports no error — so the `guard` hook blocks that commit as a backstop.
- **The orchestrator owns routing.** The user states a requirement in plain language; the orchestrator
  grounds it against the actual repos (their `role`/`stack`/`labels`) and routes each item to exactly one
  repo (explicit `repo` → label → default → ground → ask). Users never hand-tag repos.
- **Invariant: 1 run = 1 item = 1 repo = 1 branch = 1 PR.** A cross-repo feature is an **epic** whose
  child stories each target one repo, ordered by `dependsOn`; the epic is the coordination unit (a
  control-plane coordination file rolls up the children). Each PR stays small and independently
  reviewable, a failure in one repo never poisons another, and every child run is atomic and resumable.
  Per-item run files live in their repo (committed to its branch, so the PR keeps its audit trail);
  `status` aggregates run files from the control plane and every repo.
- **What stays per-repo:** branch/commit/push/PR (each repo's own `host`/`remote`/`defaultBranch`), the
  design pod (each frontend repo's `renderBaseUrl`), and releases (each repo versions/tags on its own
  cadence; a coordinated release iterates repos in `dependsOn` order).

**D9 — A contract is what makes two sides of a feature concurrent.** A feature split across a backend
and a frontend child has exactly one thing preventing both from starting now: nobody has agreed the
interface. There are three ways to handle that, and only one of them is good.

- **Chain them** (`frontend dependsOn backend`) — the reflex, and what AIDLC did before 0.35.0. Correct
  about the dependency, wrong about its price: it serializes an entire feature to protect one unknown.
- **Start both and reconcile at the end** — worse. Two agents that have each written code against a
  shape they guessed do not "sync"; one of them gets rewritten, and which one is decided by whose work
  is cheaper to discard. **Coordination after the code is the expensive place to put it.**
- **Agree the interface first** — a small **contract child** (OpenAPI path, GraphQL SDL type, `.proto`
  message, JSON Schema, an exported type in a declared shared package) lands as a normal single-repo
  leaf. Both implementation children then `dependsOn` *the contract* and **not on each other**, which is
  the edge that makes them concurrent: `sprint`'s independence check reads `dependsOn`, and in poly they
  are already in separate repos. The frontend builds against generated types and contract-derived
  fixtures, so it never idles on a running backend.

The cost this design pays is that neither child's own green run proves the feature works — each was
verified against the contract, never against the other. So the seam gets its own step: an **integration
join** at the parent tier (contract tests, or the e2e path that exercises the real call), run as part of
the epic/feature consolidation pass. A project with no way to test the seam gets a `MAJOR` finding rather
than a pass, because the contract is then the *only* thing holding the two sides together and the team
should know that is what it chose.

The corollary matters as much as the pattern: **where the interface already exists and the feature does
not change it, there is no contract child and no edge at all.** Both children start immediately.
Chaining there is pure lost time, and it is the easiest mistake to make because a chain always looks
prudent.

**D10 — Ceremony is proportional to consequence.** Until 0.36.0 every change, down to a typo, required a
tracked work item, a branch and a PR — and the framework said so out loud: *"Small changes are not an
exception… if that feels heavy for a typo, that is a real finding about the pipeline — raise it via
`aidlc:dogfood`, don't route around it."* That instructed the user to file a complaint instead of getting
their typo fixed. Nobody files the complaint. They stop using the tool — and not just for typos, which is
the actual cost: **a pipeline that is unpleasant for small work loses the audit trail on the large work
too**, because people go around it for everything or uninstall it outright.

The fix is a gradient, matching how Claude Code itself works — answer → edit → commit → PR, with the user
choosing where to stop. Four tiers (`aidlc:ceremony`): **answer** (no artifact), **direct** (gated commit
on the current branch, no item/PR), **tracked** (branch + run file, PR optional), **full** (the pipeline).
`pipeline.ceremony` sets the project's floor and defaults to `direct`. Three properties make this safe
rather than merely lenient:

- **The project's gate runs at every tier.** Ceremony is what scales down; verification does not. A tier-1
  change is linted, typechecked and tested exactly like a tier-3 one.
- **Escalation triggers override the floor *and* the user's stated preference** — auth/tenant-isolation
  paths, a destructive migration under expand-contract, a declared `apiContracts` path, code an in-flight
  run already owns, an explicit pipeline request. Each names something **not recoverable by noticing it
  later**, which is the only thing that justifies insisting. None fire on an absent config field.
- **Promotion is always available.** *"track this"* turns a finished direct change into an item with its
  commits linked, so starting light never traps the work.

The corollary is a behavioural rule, not a preference: **"just do it" / "no ticket" / "no PR" are
instructions, not objections to be argued with.** Selling the user the tier they just declined is the
behaviour this decision exists to prohibit.

**D11 — Delivery order is an execution overlay, not a board write.** A client changing priorities
mid-project is the normal condition of a project with a client, not an exception. Absorbing it needs an
answer to *"what runs next, in what order, and what still runs at the same time"* — and the tempting
answer, rewriting the board, is the wrong one twice over.

- **The board is the product owner's record of what they asked for.** `priority`, `dependsOn` and
  sprint/iteration are where that intent lives. A pipeline that rewrites them is overwriting the
  statement it is supposed to be serving — and it is no coincidence that the 7-op adapter contract (D4)
  has no op for any of the three: they are set at authoring time, by a person.
- **Re-ordering without re-packing silently costs the concurrency.** Move one item to the top and a
  contract-first pair that used to run side by side (D9) can end up in two different waves with no
  reason anyone can state. Order and parallelism are one operation, not two.

So `/aidlc:replan` writes **`.aidlc/plan.md` at the control plane** — an ordered set of **waves**, each
wave a set of items that may run concurrently — and `/aidlc:next` and `/aidlc:sprint` follow it. The
board stays exactly as the client left it; the plan lists the priority edits that *would* make the two
agree, for a human to apply. Anything needing the tracker to genuinely change (a new contract child, a
split) goes through `create` and the normal approval gate.

Three properties make the overlay trustworthy rather than a second source of truth to drift:

- **In-flight work is never re-planned.** A leaf with a live run file is pinned to wave 0 exactly as it
  is — no pause, no reorder, no retarget. Unwinding a change half-applied across many files and, in
  poly, many repos costs far more than the wall-clock a stop would save. **Freezing is leaf-only**: §3a
  rolls a parent to in_progress the moment its *first* child starts (F19), so freezing on `in_progress`
  would freeze whole epics and make the board unplannable the instant any child moved. Containers are
  coordination units — never frozen, never scheduled, their children are the work.
- **The packing is computed, not judged.** The *order* is human judgment (an analyst reading the changed
  intent); which items may share a wave is decided by four constraints that each fail silently —
  a violated `dependsOn`, a breached **stage barrier**, two poly items racing one working tree (sprint
  §1.3, which does **not** bind in mono where each item gets a worktree), and the width cap. So it is
  `skills/replan/resolve-waves.mjs`, pinned by `resolve-waves.test.mjs` — the same argument
  `resolve-fanout.mjs` makes one grain finer. This is D7's coarsest level: fan-out packs one item's
  *tasks* into windows; replan packs *items* into waves.
- **A grouping directive is a barrier, because a rank cannot express one.** *"Finish the backend before
  starting the UI"* says **all** of one set before **any** of another; `order` only says *this before
  that*. Rank the backend 1–3 and the UI 4–5 and a greedy packer still puts a UI item in wave 1 the
  moment a slot is free — and in poly the one-item-per-repo rule *guarantees* a free frontend slot, so
  the directive fails 100% of the time in exactly the layout that most needs it. So the analyst emits a
  `stage` per item and the packer gates on it. The barrier is a **band, not a queue**: inside a stage
  everything still runs as wide as the other three constraints allow. It yields, loudly, in two cases —
  it gates on *schedulable* work so one blocked ticket cannot freeze every later stage, and `dependsOn`
  overrides it, because a dependency is correctness and a phase is a preference. And it stays **plan
  state**: encoding a phase as a tracker `dependsOn` would outlive the plan that wanted it and
  re-serialize the board permanently.
- **A stale plan falls back loudly rather than steering silently.** The plan records the item fields the
  packing depended on; `next`/`sprint` diff them against the live board first. Items merely progressing
  is the plan working; new work is additive (follow it, say what is unscheduled); a planned item that
  vanished, was re-typed, re-routed or re-wired is **breaking** — announce it, ignore the plan, revert to
  priority order. Never silently obeyed, never a blocker.

**D12 — A team's collisions happen in the merge, not in the working tree.** Every isolation mechanism
above D11 is **filesystem-scoped**: worktrees, one-item-per-tree, disjoint-path fan-out, the run file
that records what is in flight. Each of them answers *"can these two units of work share my disk?"* —
and each is silent about the question a team actually asks, which is *"is somebody else already doing
this?"* The framework had exactly one cross-machine primitive, and it was accidental: `/aidlc:next`
queries `status: todo`, `/aidlc:run` §3 writes `in_progress`, so a started item leaves everyone's query.
That coarse lock is why AIDLC does not fall over with a team; the gaps are everything it does not cover.

`team.mode` (`solo` default · `shared`) gates the whole set, so a solo project is byte-identical to
before. What `shared` changes, and the reasoning that decided each:

- **Ownership is read, never written.** A tracker gives an item one assignee — Jira and ADO both enforce
  it — so "two people on one task" is not a state to arbitrate. The bug was that no command *consulted*
  it: `query` had no `assignee` filter, so three developers' `/aidlc:next` all returned the same
  correctly-assigned item. The fix is a filter (`currentUser()` / `@Me` server-side), not an `assign`
  op. **Who does the work is a staffing decision**, the same class as `priority` and `dependsOn`, and
  D4's argument for keeping those out of the contract applies unchanged.
- **The run file cannot be the cross-machine lock, and pretending otherwise is worse than not trying.**
  It is committed to its feature branch, so a teammate's in-flight run is invisible by construction.
  Rather than inventing a lock file (a shared-state consensus problem AIDLC has no business solving),
  `next`, `sprint`, `status` and `ceremony` trigger 4 each say plainly which evidence is local and which
  is the board's. A guard that is documented as local is usable; one that reads as global is a trap.
- **AC belong to their author once the author is not the operator.** `groom` applied AC rewrites and
  sizes inline — correct when you are the product owner, and an overwrite of somebody's words when you
  are not, with both concurrent writes read-back-verifying cleanly. `team.groomAutoApply` derives from
  the mode: everything proposed in `shared`, nothing changes in `solo`. This is D4's priority argument
  arriving one field late; priority was only ever special because it was obvious.
- **A green gate proves nothing without saying what it was green against.** Branching pinned `<base>`
  and never looked again, so a long-lived branch verified against a tree that no longer existed —
  producing semantic conflicts, which merge cleanly and fail later. Verify now checks drift first and
  decides on **path overlap**, not commit count: *isolation, not similarity*, one grain further out.
- **Human review is a phase, and it was missing.** §10 stamped `done` and `run-state`'s resume answered a
  `done` run with "nothing to do" — so the single most frequent event on a team, a reviewer leaving
  comments, dead-ended in the place the pipeline called complete. `aidlc:review-feedback` works threads
  as attributed findings through the ordinary fix cycle, and the two rules that distinguish a person's
  comment from an agent's are that **a disputed one is answered on the thread, not argued down in the
  run file**, and **no thread is resolved that was not fixed**. It never merges: closing its own review
  loop would remove the one gate D6 promises to keep.
- **Shared control-plane state needs a freshness read, not a sync engine.** `.aidlc/plan.md` is a team
  decision that `next` and `sprint` obey, and nothing pulled or pushed it — so each developer silently
  followed a different schedule, undetectably, because the freshness check diffs the plan against the
  *board* and the board had not changed. `replan` now commits and pushes it with `cutBy:`; readers report
  ahead/behind and **never auto-pull** — conflicting somebody's backlog underneath them mid-command is
  worse than a stale read.
- **`source: markdown` is a solo adapter.** In shared mode the backlog *is* the git tree: concurrent
  grooms conflict in the plan of record, and `query` returns whatever branch the caller stands on. Warned
  once at `init`/`adopt`, never blocked — a small co-located team on one default branch gets away with
  it, and arguing twice costs more than the risk.
- **`ceremony`'s floor and its collision trigger were both solo-shaped.** Tier 1's safety argument is
  *a local commit is `git reset` away*, which quietly assumes one tree; the floor becomes `tracked` in
  shared mode unless set. And trigger 4 ("work an in-flight run already owns") could only read local run
  files — structurally blind to the *more* likely collision — so it now consults the board and open PRs.

One collision was silent and guaranteed rather than probabilistic: **ADR numbers**. `NNNN = next number`
read the working tree, so two branches cut from one base both produced `0012`, both PRs passed review
(neither diff shows the other), both merged, and `superseded-by-0012` became permanently ambiguous with
no error anywhere. Numbers are now reserved from the integration branch plus open PRs.

## 2. Implemented (Phases 0–2)

### Pipeline

```
/aidlc:run ID → fetch (adapter) → classify by type
  story: requirements → plan → implement → verify → PR → docs → done
  bug:   requirements(light) → failing repro test → fix → verify → PR
  task:  plan → implement → verify → PR
  epic:  analyst decomposes into child stories, stops
verify = reviewer ∥ qa (parallel) → fix cycles (max pipeline.maxFixCycles) → BLOCKED if exhausted
```

### Agents (9)

| Agent | Role | Isolation reason | Model tier |
|-------|------|------------------|-----------|
| `aidlc-analyst` | AC validation/refinement, sizing, epic decomposition, assumption logging | own judgment loop over item + codebase | sonnet |
| `aidlc-architect` | explores codebase, plans items ≥ threshold, writes ADRs | large exploration context, deep judgment | opus |
| `aidlc-implementer` | code per plan, conventional commits, fix cycles | large working context | sonnet |
| `aidlc-reviewer` | adversarial diff review vs AC/standards (read-only tools) | must not share implementer context | sonnet |
| `aidlc-qa` | run suite, author missing tests, failing-repro-first for bugs | independent evidence gathering | sonnet |
| `aidlc-security` | input→sink tracing, authz, dependency audit (conditional trigger) | adversarial depth, read-only surface | opus |
| `aidlc-devops` | container/CI/release items, red-check diagnosis | different tool domain | sonnet |
| `aidlc-docwriter` | README/CHANGELOG/API docs on the PR branch | mechanical, cheap | haiku |
| `aidlc-researcher` | spikes → cited decision reports | web-heavy exploration + high-stakes tech-selection judgment | opus |

### Skills

Commands: `do`, `run`, `next`, `sprint`, `status`, `init`, `bootstrap`, `intake`, `adopt`,
`adopt-apply`, `adopt-adr`, `adopt-backlog`, `groom`, `replan`, `review-feedback`, `release`, `repo`,
`promote`, `sync`, `scaffold-skill`, `scaffold-agent`, `dogfood`, `remove`. Infrastructure:
`run-state`, `work-items`, `wi-markdown`, `wi-jira`, `wi-ado`, `git-workflow`, `agent-contract`.
Playbooks: `ceremony`, `requirements`, `planning`, `architecture`, `code-review`, `testing`,
`debugging`, `security`, `ci-cd`, `docs-writing`, `research`, `maintenance`. Stack pack
(`aidlc-stack-web` plugin): `coding-standards-ts`, `project-structure`, `nextjs`, `nestjs`,
`postgres`, `mongodb`, `db-migrations`, `docker`, `api-design`, `ci-web`. UX pod (`aidlc-ux`
plugin): `design`, `figma`, `ux-narrative`, `design-research`, `design-system`, `design-jury`,
`figma-handoff`, `motion`. (`x-aidlc`-templated scaffolds ship in `templates/`.)

**Layering rule:** core is stack-agnostic. Anything that assumes a package manager, a language
toolchain or a browser belongs in a pack — `ci-cd` holds host mechanics and the diagnosis protocol
while `aidlc-stack-web:ci-web` holds the npm gate; the Playwright MCP ships with `aidlc-ux`, the only
plugin that renders. `/aidlc:promote` enforces the same split at the moment a local skill goes
upstream.

### Hooks (Node, cross-platform)

`guard.mjs` (PreToolUse Bash) · `dep-vet.mjs` (PreToolUse Bash — gates package-add commands to vet
the dependency before install) · `protect-paths.mjs` (PreToolUse Edit/Write) · `format.mjs`
(PostToolUse) · `session-context.mjs` (SessionStart) · `checkpoint.mjs` (PreCompact + Stop).

### Phase 3 — Real trackers + Azure ✅ (v0.3.0)

Implemented: `wi-jira` (Atlassian MCP; JQL; transition-by-target-status; statusMap),
`wi-ado` (ADO MCP + `az boards` fallback; WIQL; Agile/Scrum process detection; state-stepping
with tag fallbacks), Azure Repos PR path in `git-workflow`, `/aidlc:groom` (autonomy
boundaries: AC/sizing applied, decompositions/priorities proposed only), bundled `atlassian` +
`azure-devops` MCP servers, project `.mcp.json.example` (read-only Postgres/MongoDB, Sentry,
Notion, Figma). Adapter contract unchanged — the pipeline runs identically over all three sources.

### Phase 4 — Depth agents + stack pack ✅ (v0.4.0)

Implemented: the five depth agents (`aidlc-architect` opus + ADRs, `aidlc-security` opus with
conditional trigger, `aidlc-devops` incl. red-check diagnosis, `aidlc-docwriter` haiku,
`aidlc-researcher`), the seven phase skills (`architecture`, `security`, `ci-cd`, `release`,
`docs-writing`, `research`, `maintenance`) + ADR template, orchestrator wiring (security in
the verify batch, spikes → researcher, infra plans → devops), and the `aidlc-stack-web` plugin
(8 stack skills). Separate plugin so other stacks (e.g. `aidlc-stack-python`) can slot in
without touching core — stack skills are namespaced `aidlc-stack-web:*`.

### Phase 5 — Self-extension & scale ✅ (v0.5.0)

Implemented: capability-gap protocol in the orchestrator (search plugins → local →
`extensions.json` registry; create as last resort; skill by default, agents behind the
agent-test justification); `scaffold-skill`/`scaffold-agent` with mandatory `x-aidlc` metadata
and reuse tracking (`/aidlc:status` surfaces candidates at reuseCount ≥ 2); `/aidlc:promote`
(validate → secret-scan → generalize with shown diff → package into the right plugin on
`promote/<name>` → user-confirmed PR with the reviewer checklist); `/aidlc:sync` (deletes local
forks shadowed by promoted versions, resolves shadowing conflicts); `/aidlc:sprint N` (analyst
independence check → worktree + headless run per item → live board from run-file polling →
cleanup); governance via `docs/promotion-policy.md` (`plugins/**` platform-owned).

### Design pod ✅ (`aidlc-ux` plugin, v0.1–0.6)

A separate, default-enabled plugin for UI work, with **two design sources** and a different quality
gate for each.

**Generated (no Figma).** Five roles: `aidlc-ux-writer` (narrative), `aidlc-ux-researcher` (cited
Awwwards inspiration), `aidlc-design-system` (the tokenized uniformity anchor — also audits existing
UIs and honors brand anchors), `aidlc-motion` (animation within a perf+a11y budget), and
`aidlc-ux-jury` (opus; renders via Playwright and scores a weighted rubric /10, blind to the makers).
`/aidlc-ux:design` runs narrative → research → design system → build/redesign + motion → a jury loop
that iterates until composite ≥ `ux.juryThreshold` (default 9), capped at `ux.maxJuryRounds`. Works
greenfield (establish the project standard), retrofit (adopt the existing system, redesign a scoped
surface) and full redesign; brand references (logo/colors/fonts) are hard constraints.

**Figma (v0.5–0.6).** Two independent axes, both resolved before the pipeline runs: `designSource`
(are the screens drawn?) and `systemSource` (are the values given?). All four combinations occur.

*Screens in Figma (`designSource: figma`).* The pod implements rather than invents. The plugin
ships its own `figma` MCP server (remote, OAuth). `aidlc-figma` extracts the design once —
`get_metadata` → `get_design_context` → `get_screenshot` → `get_variable_defs` — into
`design/figma-spec.md` plus reference shots; `aidlc-design-system` runs in *figma mode*, mapping the
file's **variables** onto the project's tokens instead of inventing a palette; the implementer builds
to the spec; and `aidlc-fidelity` (opus) renders at the design's own artboard width and classifies
every difference `[BLOCKING]`/`[MINOR]`/`[ADAPTATION]`. Gate = **zero blocking**, capped at
`ux.figma.maxFidelityRounds`. `/aidlc-ux:figma` links a file, maps frames to the app's real routes,
and `sync` re-extracts to report design drift against the built routes.

*A design system in Figma (`systemSource: figma`, v0.6).* The common enterprise case: a brand hands
over a UI kit, not mockups. `aidlc-figma` runs in **library mode** — wave 1 pulls the whole variable
set plus the component *inventory* over the canonical pages; wave 2 pulls a component's detail the
first time a screen needs it (a sixty-component system would not survive the monthly call budget
otherwise). `aidlc-design-system` in **figma-library mode** emits the full token layer from the
variables and writes `design/design-system.md` from the extraction. **The screens are still the pod's
to design and the jury still gates** — what changes is that Consistency is judged against the given
system, so an off-token value or a re-invented component is a defect rather than a preference. Page
scope is a declared contract (`ux.figma.designSystem.pages`), confirmed once by a human and never
widened by the pipeline: a design-system file also holds covers, WIP and deprecated sets, and building
against a deprecated component looks compliant while being worse than ignoring the system. A
workspace-scoped system is the one thing declared at the **top level** even in poly — one brand, one
system, every frontend deriving tokens in its own idiom from the same extraction, and a system change
makes all of them stale at once.

**Design decisions.** (1) *The jury does not gate a Figma-sourced surface.* The design was approved
outside the session; scoring it and iterating toward a 9 would overwrite someone else's decision. So
it is offered (`ux.figma.jury: suggest`), advisory when accepted, and its design-level critique goes
to the human rather than into the build — `gate` remains available for teams treating Figma as a
starting point. (2) *An unreadable Figma blocks the run.* Falling back to inventing a design is the
one failure that looks like success. (3) *Extract once.* Figma reads are seat-rate-limited (a few
calls per month on Starter/View seats), so the spec — not the MCP — is what the build, the fidelity
check and the next session read. (4) The jury and the fidelity checker are the only opus tiers, both
deliberately blind to the makers' reasoning; both loops are capped and never model-escalate.

The core orchestrator detects UI items at classify (`ui:` flag) and both sources alongside it
(`designSource: figma|generated`, `systemSource: figma|project`), routing here when the plugin is
present and `ux.enabled` — no hard dependency, so core still runs standalone. `ux.figma` is per repo
and per package (different frontends, different mockups and dev ports); `ux.figma.designSystem` with
`scope: workspace` is the deliberate exception.

## 3. Post-v1 candidates (not committed)

- Additional stack packs (`aidlc-stack-python`, `aidlc-stack-dotnet`) as demand appears.
- More adapters via the same 7-op contract (Linear, GitHub Issues).
- Sentry-fed bug intake: production error → draft bug item with stack trace context.
- Metrics: cycle-time and fix-cycle stats aggregated from archived run files.

## 4. Extension points (for adopting teams)

- **New tracker** → write a `wi-*` skill implementing the 8-operation contract; add a `source` value.
- **New stack** → new `aidlc-stack-*` plugin, carrying a `coding-standards-<lang>` skill, a strict
  tooling baseline in `templates/tooling/` (linter/formatter/type-checker configs), and a
  `project-structure` skill + skeleton/boundary configs in `templates/structure/` — all scaffolded by
  `/aidlc:init` and enforced by CI (lint/format/typecheck + a `dependency-cruiser` layering gate).
  Deterministic tooling owns the mechanical rules **and the architectural boundaries** (feature
  encapsulation, layering) so the reviewer spends its judgment on what tools can't check. Core
  degrades gracefully without a pack.
- **Different autonomy** → per-project `settings.json` + `pipeline.gates`; the pipeline reads, never hardcodes.
- **Solo vs team** → `team.mode` (`solo` default · `shared`) + `team.me`; optional `team.pickScope`
  (`mine-then-unassigned` · `mine-only` · `any`) and `team.groomAutoApply`. Every team behaviour is
  gated on `shared`, so a solo project sees no change. See D12.
- **Verification cost/cadence** → `pipeline.verification` (`mode`: auto/manual/ask, `scope`:
  per-item/per-epic, plus `reviewer`/`qa`/`security` toggles); the human review of the PR is always
  the final gate, so `manual` degrades safely rather than skipping oversight.
- **Where effort is accounted** → `pipeline.taskSync`. The leaf is the branch/PR unit for a reason
  about git; the **Task tier** is where most teams count effort. The run file's plan and the board's
  Tasks are the same commit-sized breakdown, so the plan binds to them (`wi:` per line) rather than
  shadowing them: commits name both IDs, ticking a checkbox transitions the Task. States only —
  estimates stay with the humans, per D4.
- **Project-specific expertise** → `.claude/skills/` landing zone, `x-aidlc` metadata, promotion path when it proves reusable.
