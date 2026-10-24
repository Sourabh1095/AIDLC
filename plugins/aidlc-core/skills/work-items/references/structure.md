# Work items — how work is structured across repos, packages and Tasks

Read from `aidlc:work-items` when planning, decomposing, splitting or routing work: package resolution,
the cross-repo split tier, the Task tier, contract-first siblings, and re-decomposition. Part of the
work-items skill, kept apart because a single fetch/transition/comment never needs it.

## Item → package resolution (monorepo only; a no-op everywhere else)

A **monorepo is one git repo holding many independently-owned packages**, so resolving the repo does not
finish the job: `repos[]` marks the git boundary, `packages[]` marks the ownership boundary inside it.
Once the repo resolves, if that repo entry (or the top-level config, in mono) carries `packages[]`,
resolve the package too — same chain, one tier down, stopping at the first that resolves:

1. **Explicit** — the item's `package` field names a known `packages[].name`.
2. **Label** — an item label matches a package's `labels`. Several match → don't guess; fall through.
3. **Path** — the item names files or directories that sit under exactly one package's `path`. This is
   the tier that resolves most real items, because a well-written item says where the work is.
4. **Single default** — one package declared, or exactly one with `default: true`.
5. **Ground** — read the candidate packages' `role`/`stack` and the code the item describes, and pick.
   Log the reasoning as an assumption.
6. **Ask** — still ambiguous → ask, listing the packages.

What resolving it buys, and what it does not:

- **The gate narrows.** `pipeline.gates.verify` resolves with the package name, which **layers** the
  package's steps over the repo's rather than replacing them (`aidlc:run` §7 / `resolve-gate.mjs`).
- **Stack and UX narrow.** A monorepo's packages routinely differ — a Next.js app beside a Python
  worker — so standards, structure guidance and the design pod resolve from the *package's* `stack`/`ux`,
  falling back to the repo's. Resolving these per repo is how a worker gets handed web coding standards.
- **The PR is labeled with the package**, so a reviewer sees the ownership boundary the diff crosses.
- **It adds no branch and no PR.** One item = one repo = one branch = one PR, unchanged. The package is
  a scope *within* the leaf, not a new leaf.

**An item whose scope spans packages decomposes exactly as cross-repo work does** — per-package children
with `dependsOn` sequencing, ordered by the packages' own `dependsOn` graph (a shared package's child
lands before its consumers'). The difference from cross-repo is only that the children share a git repo,
so they could in principle share a branch: **they must not.** One child, one branch, one PR keeps the
review unit and the revert unit the same size, which is the whole reason the rule exists. Follow
*Re-decomposition & supersession* below for the AC coverage map, same as any other split.

Where the tracker has no package field (most do), carry it on the run file's `package:` and as an item
label — do **not** invent a custom field, and do not fold it into `repo` (`api/web` as a repo name breaks
every path resolution downstream).

## Cross-repo split tier (poly) — where a feature's work meets the repos

A feature in poly naturally spans repos (an API in the backend, its UI in the frontend, a migration in
the DB repo). **Epics and Features always span repos** (they carry no single `repo`; they fan out). The
only real constraint is physical: the **runnable leaf** — the thing that gets one branch + one PR —
must live in **one repo**, because separate git repos can't share a branch/PR. Everything above the
leaf can span repos freely.

*Which tier is the leaf* is a per-project convention, set by `workspace.crossRepoSplit` (default
`story`). Both are first-class — pick the one the tracker board is authored for:

- **`story` (default, recommended).** A **Feature → per-repo Stories**; each **Story is the
  single-repo leaf** (one repo = one branch = one PR) and its **Tasks are that repo's breakdown**.
  Fits ADO's `Epic→Feature→Story→Task` hierarchy natively (no Story→Story nesting), makes one Story a
  clean reviewable/estimable PR, and keeps velocity honest.
- **`task`.** A **User Story is a cross-repo umbrella** capturing one unit of user value; its child
  **Tasks are the single-repo leaves** (API task → backend repo, UI task → frontend repo, migration →
  db repo), each its own branch/PR. The Story rolls up when all its tasks complete (parent rollup +
  reconciliation, above). Natural when a team defines a story as *user value* rather than *deliverable
  unit*, and the common shape when an existing board already nests cross-repo tasks under one story.

Worked example (a "Profile page" epic), both tiers, in the user-guide. The orchestrator honors the
knob in `aidlc:run` §2/§2.5; authoring skills (`intake`/`groom`/`planning`) propose the matching shape.
The **runnable leaf is single-repo in both** — only its tier differs.

## The Task tier — the unit of effort, bound to the commits that spend it

The leaf is the **branch/PR unit**, and it is a Story by default for a physical reason: a branch and a
PR are one per repo, and a Story is the smallest thing that is independently reviewable and revertable.
That is a statement about *git*, and it was quietly read as a statement about *effort* — which it never
was. On most boards (and on ADO natively: StoryPoints live on the Story, RemainingWork hours on the
Task) the **Task tier is where a team accounts for the work actually done**. A Story says what; the
Tasks beneath it are the doing.

Both are true at once, and the pipeline holds them apart:

| Tier | What it is | What the pipeline gives it |
|---|---|---|
| Story (the leaf) | one reviewable, revertable increment | one branch, one PR, one `in_progress`→`in_review`→`done` arc |
| **Task** | **one unit of effort** | **one commit-sized plan step, its own commit, its own transition** |

**The run file's `## Plan` and the board's Tasks are the same breakdown.** `aidlc:planning` already
requires plan tasks to be commit-sized and path-declaring; a board's Tasks are that list, authored by a
human, one tier up in durability. Modelling them twice and only ever writing to AIDLC's private copy is
what leaves a board showing a Story go New → Active → Done with every Task under it still New. So the
plan **binds** to them instead:

- Each plan line may carry a **`wi:` binding** to the Task it implements —
  `- [ ] Add the DTOs  ·  paths: src/dto/profile.ts  ·  wi: PROJ-145`.
- A **bound task's commit names both IDs** in its trailer (`Refs: PROJ-123, PROJ-145`) — the Story for
  the PR, the Task for the effort. See `aidlc:git-workflow` → *Commits*.
- **Ticking the checkbox transitions the Task**, read-back-verified like any other write.

Governed by `pipeline.taskSync.mode`, and the mechanics live in `aidlc:run` §5 (bind) and §6 (mirror):

- **`adopt` (default).** Where child Tasks exist, they *are* the plan — seed `## Plan` from them and
  mirror progress back. Where they don't, behave exactly as before and create nothing. A board that
  does not use the Task tier is unaffected.
- **`author`.** As `adopt`, plus: where a leaf has no Tasks, propose one per plan task and create them
  on approval — creation is externally visible, so it goes through a gate like every other `create`.
- **`off`.** The plan stays private; nothing below the leaf is read or written.

**What this deliberately does NOT do: write an estimate.** The pipeline never sets a Task's
StoryPoints, Effort or RemainingWork, in any mode. Those are the same class of field as `priority` and
`dependsOn` — a human's record of what they asked for and what they think it costs (see *What the
contract deliberately cannot do*). AIDLC moves a Task through its states so the burndown is honest about
*what is done*; how much it was supposed to cost stays the team's number. An invented estimate would
make velocity a measurement of the pipeline's guesswork.

**Nor does it shrink the PR.** Binding commits to Tasks does not make a Task the leaf — one Story is
still one branch and one PR, because a Task-sized PR ("add the DTO") is not independently shippable.
If a team genuinely wants a branch per Task, that is the `crossRepoSplit: task` tier above, which is a
different decision with a different cost.

## Contract-first siblings (how frontend and backend run at the same time)

A feature split across a backend and a frontend child has an interface between them, and **the interface
is the only reason they cannot both start now.** The reflex is to chain them — `frontend dependsOn
backend` — which is correct about the dependency and wrong about the cost: it serializes the whole
feature to protect one unknown, the response shape.

The other reflex, *start both and reconcile at the end*, is worse. Two agents that have each already
written code against a shape they guessed do not "sync"; one of them gets rewritten, and which one
depends on nothing more principled than whose work is cheaper to throw away. **Coordination after the
code is the expensive place to put it.**

So put it before the code. Decompose a feature with an interface into **three** children, not two:

1. **The contract child** — a real, committed artifact in the repo that owns it: an OpenAPI path, a
   GraphQL SDL type, a `.proto` message, a JSON Schema, or an exported type in a declared shared package.
   Small (usually S), single-repo, its own branch and PR like any other leaf. It is a normal item — not a
   ceremony, not a doc.
2. **The implementation children** — backend and frontend, each `dependsOn: [<contract child>]` and
   **explicitly NOT on each other**. That is the edge that makes them concurrent: `/aidlc:sprint`'s
   independence check reads `dependsOn`, so two siblings that depend only on a landed contract are
   selected together (and, in poly, they are in different repos, so they were already isolated).
3. **The join** — integration verification at the parent tier, once both are terminal. Contract tests,
   or an e2e path that exercises the real call. This is the step that actually proves "the thing works",
   and it is where the epic/feature consolidation pass earns its keep (`aidlc:run` §2).

The frontend child **must not sit idle waiting for a running backend** — that would reintroduce the
serialization through the back door. It builds against the contract: generated types where the stack
generates them, and fixtures/mocks derived from the contract where it doesn't. Its AC are satisfiable
without the backend deployed; the join is what tests them together.

**When NOT to do this — three cases, and the third is the common mistake:**

- **No interface between the children** (a styling change plus an unrelated migration) → they were
  always independent. Don't invent a contract child; just don't chain them either.
- **The work is one-sided** (backend-only, frontend-only) → one child, nothing to coordinate.
- **The interface already exists and this feature doesn't change it** → there is nothing to agree, so
  there is no contract child *and no `dependsOn` edge*. Both children start immediately. Chaining
  frontend behind backend here is pure lost time, and it is the easiest mistake to make because the
  chain *looks* prudent. Check before you chain: read the existing contract, and if the shape the
  frontend needs is already in it, say so on both items.

Two constraints carried from elsewhere, because a contract child is exactly the kind of item they exist
for: a change to a path declared in `saas.apiContracts` is **additive unless the item explicitly asks to
break it**, and a `public: true` contract means external consumers, which the PR body must say plainly
(`aidlc:run` §7, trigger 2). And if the contract turns out wrong once implementation starts — it does
sometimes — that is a **scope change**, handled by the reconciliation in `aidlc:run` §1: amend the
contract in a follow-up item, mark the affected tasks `[needs-rework]`, and never let the two
implementation children quietly diverge from the artifact they both agreed to.

## Re-decomposition & supersession (don't drop requirements or orphan originals)

When work is **re-decomposed** — an epic/feature/story split into new children that REPLACE existing
items (the cross-repo split in `aidlc:run` §2.5 / `aidlc:intake`, or any restructure) — the pipeline must
not leak requirements or leave the board diverged from what was built:

1. **AC coverage map (old → new).** Before creating children, map every acceptance criterion (and each
   discrete deliverable) of the originals onto the child that will carry it. **Flag any original AC not
   covered by a child** and route it explicitly — into a child, or a new follow-up item — never let it
   vanish. (The live miss this catches: a husky-hooks AC silently dropped in a re-decomposition and
   delivered in zero repos, found only by a manual audit.)
2. **Reconcile the originals you supersede.** Link each superseded original to its delivering
   child(ren) and transition it to a **terminal** state — never leave it `todo`/`New`, or `query()`
   resurfaces delivered work as "ready" and risks re-running it. Prefer a **superseded** terminal
   (throughput-neutral) over a plain "done" so N replaced items don't count as N delivered. The exact
   state available is **per-work-item-type, not global** — probe the item's type for its terminal
   states and adapt (see `wi-ado`: `Removed` may exist for a Story but not a Task); never hard-code a
   state name. If a carved-out AC moved to a new follow-up, link that too.
3. **No silent retype.** Some trackers can't change an item's *type* in place (see `wi-ado`) —
   restructure by **create-new + link + supersede**, or an umbrella parent, never by pretending an item
   changed tier. Note the tier of the AC field too (in ADO it is Story-tier, not Task-tier).

Detection backstop: `/aidlc:status` runs a **ground-truth reconciliation** (tracker status vs run files
+ git + disk) at epic/story close — see that skill. Prevention (this section + write-verification
above) and detection (status) together close the loop the manual audit had to do by hand.
