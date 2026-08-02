---
name: run
description: Run one work item (epic, story, task, bug or spike) through the full AIDLC pipeline — fetch, requirements, plan, implement, review + QA with fix cycles, PR, tracker update. Resumable. Use when asked to work on, implement, fix or deliver a work item by ID.
argument-hint: <work-item-id>
disable-model-invocation: true
---

# /aidlc:run $ARGUMENTS — the AIDLC orchestrator

You are now the **AIDLC orchestrator**: a router and state machine running in the main session.
You do NOT write product code yourself — specialist subagents do. Your job: fetch the item,
drive it phase by phase, dispatch agents, track state, and stop only at DONE or BLOCKED.

**This command is the heavyweight tier by definition** (`aidlc:ceremony` tier 3) — the user asked for the
pipeline, so give them the pipeline; do not optimize it down to a direct edit. The inverse is the point of
having tiers: a small change that arrives at `/aidlc:do` is handled there without an item, and never
reaches here.

Load these skills before starting: `aidlc:work-items` (+ the active adapter), `aidlc:run-state`,
`aidlc:git-workflow`.

**Entry is deliberate, never inferred (`disable-model-invocation`).** This is the most side-effectful
command in the framework — it branches, commits, pushes and opens PRs — so it is **not** in the
model-invocable skill set: it cannot be entered because a prompt merely sounded like work. There are
exactly three doors, and all three are a human choosing this pipeline:
1. the user types `/aidlc:run <ID>` (or free text, §0.3);
2. a **headless launch** (`/aidlc:sprint` runs `claude -p "/aidlc:run {ID}"` — a typed prompt in a fresh
   session, so the flag doesn't bind);
3. a **sibling skill hands off explicitly** — `aidlc:next`, `aidlc:do` (BUILD/RESUME) and `aidlc:intake`
   send work here after the user invoked *them*. Because the Skill tool can't reach a
   model-invocation-disabled skill, those hand off by **reading
   `${CLAUDE_PLUGIN_ROOT}/skills/run/SKILL.md` and following it verbatim** with the ID (or requirement
   text) as `$ARGUMENTS`. That is a real handoff, not a workaround: the user already chose the door, and
   the instruction to come here is written down rather than left to the model's discretion.

If you arrived here any other way — you inferred it from an ambiguous prompt — stop and offer
`/aidlc:do` instead. That door grounds first and creates nothing.

## 0 · LOAD & FETCH

1. Read `.claude/aidlc.config.json`. Missing → tell the user to run `/aidlc:init`, stop. **Build the
   repo registry** per `aidlc:work-items` → *Repos & routing*: poly if `repos[]` is non-empty, else
   synthesize the single mono entry. The session cwd is the **workspace control plane** (holds
   `.claude/`, `backlog/`, `.aidlc/`); each repo lives at `workspace.root`/`<repo.path>`.
2. Route to the active work-item adapter (per `aidlc:work-items`).
3. **If `$ARGUMENTS` is not a work-item ID** (doesn't match `{PROJECT_KEY}-{number}`), the user
   handed you a raw requirement — follow `aidlc:intake` first (analyze against codebase +
   existing backlog, propose, create on approval), then continue this pipeline with the first
   ready item it created. This is the "describe it and it gets built" path.
4. `fetch(<ID>)` → WorkItem. Not found → suggest `/aidlc:intake` if it looks like a
   requirement was meant; otherwise report and stop.

## 1 · RESUME check

If `.aidlc/runs/{ID}.md` exists, follow the resume protocol in `aidlc:run-state` — jump straight
to the recorded phase (§ below), never redo completed phases.

**Scope-change reconciliation** (on every resume, and once more just before PR): compare the
freshly fetched item's title/description/AC against the run file's `## Item snapshot`.
If they differ, the scope moved mid-flight — do NOT restart and do NOT ignore:
1. Append the new snapshot under `### Snapshot v2 (re-fetched <UTC>)` — keep v1 for the audit trail.
2. Dispatch **aidlc-analyst** to reconcile: classify each change as *additive* (new AC/tasks →
   append to `## Plan`), *modifying* (completed plan tasks affected → mark them `[needs-rework]`
   with a note, add rework tasks), or *removing* (obsolete tasks struck through `~~…~~ (descoped <UTC>)`).
   Completed work that still stands is NEVER redone.
3. Log the reconciliation, `adapter.comment` a one-line summary, resume at the earliest phase
   with open work (usually `implement`; `requirements` only if the change is ambiguous).
4. If the change invalidates the branch's core approach (analyst verdict), stop and tell the
   user: finish-as-scoped / rework-in-place / close-and-split are their call.

## 1a · PLAN position — say it, never enforce it

**Fresh starts only — skip this entire section on a resume.** A resumed item has a live run file, which
means `/aidlc:replan` pinned it to wave 0 and never re-planned it. It is in order by definition.

If `.aidlc/plan.md` exists at the control plane, there is an active wave schedule (`aidlc:replan`) that
`/aidlc:next` and `/aidlc:sprint` follow — and this command does not. That is correct: you were handed an
ID, and a named ID is an explicit instruction that a schedule does not get to override (the same reason
this skill is `disable-model-invocation`). But running silently out of order is the problem. A user who
typed *"complete all BE first and then start with UI"*, approved the plan, and then starts a UI item by
hand should be told they just stepped over their own barrier — not stopped, and not left to find out when
the frontend lands against a backend that does not exist yet.

So: read the plan's frontmatter and its wave tables, locate `<ID>`, and emit **at most one line** before
continuing into §2. Four cases:

| Where the ID sits | What to say |
|---|---|
| In the **earliest wave with open items** — the current wave | **nothing.** It is in order; a notice here is noise on every well-behaved run. |
| In a **later wave** | `PROJ-104 is plan wave 3 (stage \`ui\`); wave 1 has 2 open items (PROJ-102, PROJ-120). Running it anyway.` Name the stage only when the plan has one. |
| **Held** in the plan | `PROJ-111 is held in the plan — <the packer's reason, verbatim>. Running it anyway.` Held means the packer could not prove a placement was safe, so this one is worth the user's eye even though it does not stop. |
| **Absent** from the plan | `PROJ-130 is not in the plan (cut 2026-07-31) — the plan predates it or has gone stale.` |

Three things this section does **not** do, each deliberately:

- **It does not refuse, prompt, or wait for confirmation.** One line, then straight into §2. An explicit
  ID is a decision already made; re-asking makes the pipeline something to argue with.
- **It does not run the freshness check.** `--freshness` costs a full board query, which `/aidlc:next`
  and `/aidlc:sprint` pay because they are *obeying* the plan. This is only reporting a position, so it
  reads the file and quotes the plan's own `plan:` date instead — letting the user judge staleness at a
  glance is proportionate; a board sweep for a one-line notice is not.
- **It writes nothing** — not the plan, not the tracker. Running an item out of wave order does not
  re-plan anything, and the next `/aidlc:sprint` will simply find that item already done.

**Do not repeat a wave the caller already named.** `/aidlc:next` §4 announces `plan wave 2` in its pick
line and `/aidlc:sprint` §1.4 names the wave before launching; both then hand off here by reading this
file verbatim. Saying it twice makes one plan look like two.

## 2 · CLASSIFY → pipeline variant

| type | variant |
|------|---------|
| story | full: requirements → plan → implement → verify → PR |
| bug | repro-first: requirements(light) → **QA writes failing repro test** → implement fix → verify |
| task | slim: skip requirements agent (orchestrator sanity-checks scope inline) → plan → implement → verify |
| spike | research only: dispatch **aidlc-researcher** per `aidlc:research`; output = decision report committed to `docs/research/`; no PR unless the item asks; transition item to done, comment the recommendation + report path |
| epic | decompose only: dispatch `aidlc-analyst` to split into child stories via `adapter.create(...)` — **in poly, each child is routed to exactly one repo** (see §2.5). When the split **replaces existing items** (re-decomposition), follow `aidlc:work-items` → *Re-decomposition & supersession*: emit an **AC coverage map (old→new)**, flag any uncovered original AC, and **link + supersede** the originals (don't leave them `New`). Comment the child IDs (with their repos) on the epic, then STOP — children run individually. **Exception — consolidation:** if the epic's children already exist and are all implemented (`children(<ID>)` — the adapter op, not `query`, which would filter out everything already done), don't re-decompose; instead run ONE consolidated pass over the epic's combined changes with whichever agents have a **`per-epic` cadence** (`pipeline.verification`; by default that's **security** — reviewer/QA are on-demand). Security honors `securityConfirm` (ask before running). This is where per-epic-deferred verification is paid once, for the whole feature. **This pass also runs the integration join** for a feature whose children were split across an interface (§2.5 → *The join*): the children were each verified against the contract and never against each other, so the seam is the one thing no child's own run could prove. A missing join is a `MAJOR` finding, not a pass. **Before declaring the epic done, run the `/aidlc:status` ground-truth reconciliation** over the epic + children (board vs run files vs disk/git) so status drift or a dropped requirement is caught, not shipped silently; then report. |

### Umbrella story (poly, `workspace.crossRepoSplit: task`)

When `crossRepoSplit` is `task` (see `aidlc:work-items` → *Cross-repo split tier*), a **User Story is a
cross-repo umbrella** and its child **Tasks are the single-repo runnable leaves**. So a Story whose
child Tasks span repos is NOT a `full` single-repo story run — treat it like the **epic/`decompose`
variant**: coordinate its per-repo Task children (run each in its repo per §2.5, in `dependsOn` order),
write a coordination file, and roll the Story up when its tasks complete (parent rollup, §3a / close
reconciliation). **Recognize existing children — don't re-decompose** a Story whose per-repo Tasks are
already on the board (query first; mirror the epic *consolidation* exception). Running an individual
**Task** of such a Story is a normal single-repo run (§2.5 non-epic path). In the default `story` mode
this doesn't apply — a Story is itself the single-repo leaf and runs the `full` variant.

### UI detection (decide here, not later)

Determine **now** whether this item renders a user-facing surface, and record `ui: true|false` on
the run file. In **poly**, read `stack`/`ux` from the item's **resolved repo entry** (§2.5) — a
backend repo has no frontend, and each frontend repo carries its own `ux.renderBaseUrl`/`uiPaths`;
the design pod (§6) runs in that repo's checkout. It's a UI item when the `aidlc-ux` plugin is
available AND `ux.enabled` is true AND
**any** of these hold:
- the item is labeled `ui` / `ux` / `design` / `frontend`; OR
- its title/description/AC mention a screen, page, view, component, layout, styling, visual, motion,
  or a redesign; OR
- the stack has a frontend (`stack.frontend` set) and delivering the item clearly means rendering
  something (not a pure API/DB/infra change).
When true, also resolve and record on the run file:
- **scope** — a specific page/route/component named by the item, else the whole app;
- **mode** — `greenfield` if no `design/design-system.md` exists yet, else `retrofit` for a scoped
  surface or `redesign` if the item asks to redo the whole app;
- **brand** — whether `ux.brand` config or `design/brand/` holds anchors to honor.
If none of the signals fire, `ui: false` — never force the design pod onto backend/infra work.
(This is a judgment call; when genuinely unsure whether a frontend item warrants the design pod,
default `ui: true` — an over-invoked jury is cheap insurance; a missed one ships un-judged UI.)

**Scaffold-scope gate (deterministic — don't burn the pod on an empty shell).** A frontend/`ux.enabled`
repo is NOT enough to fire the pod: a **scaffold/skeleton** item renders no real UI surface yet. Set
`ui: false` (skeleton-only, jury skipped) — **even in a UI repo** — when the item reads as scaffold,
i.e. *any* of: minimal-shell / bootstrap / "stand up the app" scope with **no named page/route/screen**
to design; **functional-only** DoD/AC (builds, routes, lints, a placeholder/health page renders — no
visual/interaction/UX criteria); `ux.uiPaths` empty or pointing only at not-yet-built placeholders; or
the item is labeled/titled `scaffold`/`skeleton`/`bootstrap`/`init`/`wiring`. Conversely `ui: true`
when a concrete page/route/component is named or the AC ask for visual/layout/motion/UX quality (not
just "it renders"). **Ambiguity errs toward `ui: true`** — the scaffold read must be *clear* to skip.
This is the **same rule in interactive and non-interactive (`/aidlc:sprint`, headless) modes**: headless
applies it with no prompt; interactive may surface it as a confirmable *"Skeleton only [recommended] vs
Full design pod"* recommendation, but the recommendation is not the only gate. (Mirrors
`aidlc-ux:design` → *Pod-scope gate*, the pod's own view of the same contract.)

## 2.5 · ROUTE TO REPO (poly; a no-op in mono)

With one repo in the registry (mono), skip this — the single entry is the target; leave `repo:`
unset on the run file. With several:

**Non-epic item** — resolve its target repo via the chain in `aidlc:work-items` → *Repos & routing*
(control-plane → explicit `repo` → label match → single default → analyst grounding → undeclared-repo →
ask). Record the resolved repo on the run file's `repo:` and write it back via
`adapter.link`/`adapter.updateAC` where the source supports it. From here **every
git/branch/commit/push/PR/verify step for this run targets `workspace.root`/`<repo.path>`**,
using THAT repo entry's `host`/`remote`/`defaultBranch`/`branchPattern`.

**Then resolve the PACKAGE, if the repo has any** (`repos[].packages[]`, or top-level `packages[]` in
mono) — per `aidlc:work-items` → *Item → package resolution* (explicit → label → path → single default →
grounding → ask). Record it on the run file's `package:`. A monorepo is one git repo with many
independently-owned packages, so resolving the repo alone leaves the most useful scope unresolved. What
it changes for the rest of this run:

- **§5 plan and §6 implement** scope to the package's `path`; stack/standards resolve from the
  **package's** `stack` (falling back to the repo's) — a Python worker must not be handed the web
  coding standards because its repo's other package is a Next.js app.
- **§2 UI detection** reads `stack`/`ux` from the resolved **package** first, then the repo. A monorepo's
  frontend package carries its own `ux.renderBaseUrl`/`uiPaths`, and the design pod runs there.
- **§7 gate resolution** passes the package name to the resolver, which **layers** the package's steps
  over the repo's (never replaces them).
- **§8 PR** carries the package as a label so a reviewer sees which ownership boundary the diff crosses.
- **Nothing about branching changes.** One item = one repo = one branch = one PR. The package narrows
  scope *inside* the leaf; it is not a new leaf, and it never justifies two branches in one repo.

**An item spanning packages inside one repo decomposes like cross-repo work** — per-package children,
sequenced by the packages' own `dependsOn` graph so a shared package lands before its consumers. Do not
be tempted to do it in one branch because they happen to share a repo: the review unit and the revert
unit stay the same size, which is the point. Follow `aidlc:work-items` → *Re-decomposition & supersession*
(AC coverage map, flag uncovered ACs, link + supersede) exactly as for a cross-repo split.

**How to target it (F43) — the session cwd stays at the control plane; you do NOT get to change it.**
The mechanism differs by command family, and getting it wrong walls the run on permission prompts:

- **git → `git -C "<abs repo path>" <verb> …`.** Never `cd <path> && git …`: Claude Code prompts for
  *every* compound command that `cd`s into a different directory and then runs `git`, regardless of
  the allowlist, because git in a new directory can execute that directory's hooks. `git -C` is the
  only form that runs unprompted, and the shipped template allows the poly verbs in both bare and
  `-C` form (with the force-push/hard-reset denies mirrored in `-C` form too).

  **If you edit those rules, two matcher constraints are load-bearing — both verified by running
  headless probes, not by reading docs (F45; the docs describe neither):**
  1. **`:*` does not compose with a mid-pattern `*`.** `Bash(git -C * add:*)` matches **nothing**.
     Where a rule has a wildcard in the middle, the trailing wildcard must be written `*`, not `:*`.
  2. **A trailing ` *` (space-star) does not match end-of-string.** `Bash(git -C * status *)` misses a
     bare `git -C <path> status`, and a deny written `Bash(git -C * push * --force *)` misses
     `git -C <path> push origin --force` — the dangerous form. Use no-space `*` on these rules; for
     bare-verb denies where no path varies, add an exact-match rule (`Bash(git push --force)`)
     alongside the ` *` form so the argument-less spelling is covered without swallowing
     `--force-with-lease`, which must stay in `ask`.

  Re-verify any change by running it. A rule that matches nothing fails **open** on the allow side
  (the run blocks, loudly) but fails **closed** on the deny side (force-push protection silently
  disappears) — the deny half cannot be validated by watching a run succeed.
- **everything else (npm, pnpm, docker, test/lint/build) → `cd "<abs repo path>" && <cmd>`.** A `cd`
  is read-only and each half is matched independently, so the bare `Bash(npm run:*)`-style rules keep
  applying. **Always quote the path, and never assume it sits under the workspace root** — a repo entry
  may carry an absolute path to another parent, another drive, or a UNC share (`aidlc:work-items` →
  *Repos & routing*). In this shell a cross-drive `cd "D:/work/api"` is a normal `cd`; a UNC path is
  reachable but cannot be a shell cwd on Windows, so for those prefer the tool's own directory flag
  (`git -C`, `npm --prefix` where the allowlist permits) or say plainly that the repo needs a mapped
  drive. There is no `-C` equivalent for these, and
  `npm --prefix` would miss the allowlist the same way `git -C` did. Avoid output redirects in the
  same compound command as the `cd` (they prompt when the redirect target's directory is ambiguous);
  `2>/dev/null` alone is fine.
- **`gh` / `az repos` →** pass the repo explicitly (`gh -R <owner>/<repo>`, `az repos pr … --repository`)
  rather than relying on cwd.

In mono the session cwd already *is* the repo, so bare `git <verb>` is correct there and no `-C` is
needed. The run file lives at
`<repo.path>/.aidlc/runs/{ID}.md` and is committed to the branch (so the PR still carries the full audit
trail). Two routing outcomes are first-class, not ad-hoc:
- **`control-plane`** (F8) — a workspace-level item (README, cross-repo docs, control-plane config)
  routes to the workspace root and branches/merges there through the same gate. No `repos[]` entry
  needed; `repo: control-plane` on the run file.
- **Undeclared repo** (F2) — grounding says the work belongs in a repo not in `repos[]` (a shared lib,
  a future product). **Offer to declare it** (`/aidlc:repo add` — appends `repos[]` + bootstraps the
  folder), then route to the new entry. Never silently fold it into another repo.

**Non-epic item whose scope spans repos** — the runnable leaf must be single-repo (1 leaf = 1 repo =
1 branch = 1 PR); how you get there depends on `workspace.crossRepoSplit` (default `story`; see
`aidlc:work-items` → *Cross-repo split tier*). A **Task** that spans repos is always wrong — a task is a
leaf; decompose it into per-repo tasks. A **Story** that spans repos:

- **`task` mode — expected, not an error.** The Story is the cross-repo **umbrella**; its per-repo
  child **Tasks are the leaves**. Handle per §2 *Umbrella story*: coordinate/run the Task children in
  `dependsOn` order, roll the Story up on completion. If the umbrella has no child Tasks yet, decompose
  it into per-repo Tasks first (AC coverage map — `aidlc:work-items` → *Re-decomposition*). Do NOT
  offer the three options below or warn — this is the project's chosen convention.
- **`story` mode (default) — mis-authored; fix it.** A cross-repo Story breaks *1 story = 1 repo*; it
  should have been a **Feature → per-repo Stories**. Do NOT run as-is. Offer three options consistently:
  1. **Decompose-and-run** — split into per-repo children now and run them (in `dependsOn` order); the
     parent becomes an umbrella. **Follow `aidlc:work-items` → *Re-decomposition & supersession*** (AC
     coverage map, flag uncovered ACs, link+supersede the original if it's being replaced).
  2. **Decompose-defer** — create the per-repo children and STOP (pick up via `/aidlc:next`).
  3. **Single-repo subset** — the item really only needs one repo after grounding → route there, note
     the descope.
  **Prefer re-modelling one tier up — a Feature with per-repo Stories** — so each repo unit is a proper
  Story; author it right up front (`aidlc:intake`/`aidlc:groom`/`aidlc:planning`), this run-time split is
  the safety net. (ADO forbids Story→Story parenting, so a run-time split of a Story yields child Tasks
  — a stopgap, exactly why the Feature-tier authoring is preferred in `story` mode.)

**Epic / cross-repo requirement** — the feature may span repos. Dispatch **aidlc-analyst** to ground
it against the candidate repos and decompose into **one child story per affected repo**, setting each
child's `repo`, `parent` (the epic), and `dependsOn` (real cross-repo order only).

**Frontend + backend children are contract-first, not chained** (`aidlc:work-items` → *Contract-first
siblings*). Where the interface is new or changing, the decomposition is **three** children: a small
**contract child** (OpenAPI path / GraphQL SDL / `.proto` / JSON Schema / an exported type in a declared
shared package) in the repo that owns it, then the backend and frontend children each
`dependsOn: [<contract child>]` and **not on each other**. Where the interface already exists unchanged,
there is **no contract child and no edge** — read the contract and confirm it, don't chain on a hunch.
Execution order follows from the graph without a special case: contract lands → both siblings become
ready in the same pass → they run **concurrently** (§below), and the **join** proves they compose.

Create the children (`adapter.create`), then:
- Write a **coordination file** at the control plane `.aidlc/runs/{EPIC-ID}.md` (from the run-file
  template; `repo:` left null) tracking the child IDs, their repos, `dependsOn` order and a status
  rollup. This one is NOT committed to any product branch — it is cross-cutting workspace state.
- Run the children in `dependsOn` order (independent children may be handed to `/aidlc:sprint`);
  each child is its own atomic run per the rules above. Update the rollup as each child's PR opens.
- **Siblings that are ready together run together, not one after the other.** Once a wave's dependencies
  are terminal, every child that becomes ready is independent *by construction* — that is what the
  `dependsOn` graph asserts — so hand the whole wave to `/aidlc:sprint` rather than walking it serially.
  For a contract-first triple this is the payoff: the contract child runs alone, then backend and frontend
  run **concurrently** in their own repos, branches and PRs. Record the wave in the coordination file
  (`wave 2: PROJ-125 (backend) ‖ PROJ-126 (frontend)`) so the rollup shows what overlapped. Walking a
  ready wave one child at a time is not safer — the graph already said they don't touch each other — it
  is just slower.
- **The join: prove the siblings compose (contract-first features).** A feature whose children were
  split across an interface is **not done when both PRs are open** — each was verified against the
  contract, neither against the other. When the last child of such a feature reaches terminal, run the
  **integration join** as part of the epic/feature consolidation pass (§2):
  1. Check out both siblings' merged state (their default branches post-merge, or the open PR heads if
     you are joining pre-merge — say which you did).
  2. Run the **contract-level verification**: the project's contract tests (schema validation, generated
     client vs served response, Pact-style consumer checks), and where the project has one, the **e2e path
     that exercises the real call** end to end. Resolve these from the repos' own gates
     (`resolve-gate.mjs` — an `e2e` step is common at repo level); **do not invent a test framework** for a
     project that has none.
  3. **No contract test and no e2e anywhere** → that is a real coverage hole, not a pass. Write
     `- [MAJOR][open] no integration verification exists for <feature>: <backend child> and <frontend child>
     were each verified against the contract, never against each other` into the coordination file's
     `## Findings` and say it plainly in the report. The whole point of parallelizing across a contract is
     that the contract is the only thing holding the two sides together — a project that cannot test the
     seam should know that is what it chose.
  4. A failure here is a **feature-level blocker**: it belongs to whichever side diverged from the
     contract, so open a fix item against that child (or feed it into an open PR), and never mark the
     parent done over a red join.
  Features whose children share no interface skip the join — there is no seam to prove.
- **Shared-dependency pilot — a green pilot is necessary, not sufficient (F28).** When the first
  child is a **shared-package dependency** the others consume (a `dev-config`/sdk/types repo), do NOT
  declare "pattern proven, fan out" on that repo's own green: it validates itself via relative imports
  and **never exercises the consumers' cross-repo resolution path**. Before fanning out to the
  remaining consumers, run **at least one true consumer** end-to-end (its CI must resolve the shared
  dependency under isolated single-repo checkout and go green). If that consumer surfaces a
  resolution blocker (unpublished `file:` sibling can't resolve in CI — F28; cross-platform lockfile —
  F29; depcruise floor — F30), **halt and flag rather than fan out or silently re-architect** the
  merged pattern. Lead with one consumer so the blast radius surfaces on one repo, not five.
- Comment the child IDs + repos on the epic, then proceed child-by-child (or STOP and let the user
  pick them up via `/aidlc:next`, per autonomy).

## 3 · START

1. Create the run file from `${CLAUDE_PLUGIN_ROOT}/templates/run-file.md` (fill frontmatter incl.
   `repo:` from §2.5 + item snapshot). In poly it lives at `<repo.path>/.aidlc/runs/{ID}.md`.
2. Branch per `aidlc:git-workflow` for the **resolved repo** (cwd = `<repo.path>`), using its
   `host`/`remote`/`defaultBranch`/`branchPattern`. Record branch in run file.
3. `adapter.transition(ID, in_progress)` · `adapter.link(ID, {branch})` ·
   `adapter.comment(ID, "AIDLC run started on <branch>")`.
3a. **Roll the parent up to in_progress (F19).** After the story moves to in_progress, if it has a
   `parent` (Feature/Epic) still in a **todo** state, transition the parent → in_progress via
   `adapter.transition` (read-back-verified). This stops the board transiently misrepresenting a parent
   as `New` while its children are already in flight. **Guards:** only **todo→in_progress**; **never
   touch a parent already in a later state** (in_progress/in_review/done/blocked) — leave it. Walk up
   only one tier per run (the immediate parent); F15 close-time reconciliation handles deeper/mixed
   cases. **Don't fight team-configured rollup:** if the tracker auto-manages parent state (ADO
   rollup rules) or rejects the transition, don't force it — note it and continue; this is a
   proactive complement to F15 reconciliation (`/aidlc:status`), not a hard requirement. See
   `aidlc:work-items` → *Parent rollup* and the adapter (`wi-ado`).
4. Phase → `requirements`. Checkpoint.

## 4 · REQUIREMENTS

Dispatch **Agent → aidlc-analyst** with brief: run-file path, item snapshot, instruction to
validate/refine AC per `aidlc:requirements`, and append to `## Assumptions` + `## Item snapshot` notes.

Analyst verdict handling:
- `PASS` / `REFINED` → if AC changed, `adapter.updateAC(...)`; proceed.
- `AMBIGUOUS` → check config `pipeline.gates.ambiguousRequirements`:
  - `assume-and-log` (default): analyst has logged explicit assumptions — mirror them via
    `adapter.comment`, proceed.
  - `ask-human`: present the ambiguities to the user, wait for answers, write them to the run file, proceed.

Phase → `design`. Checkpoint.

## 5 · PLAN

Estimate size (item's `estimate`, else analyst's sizing). If size ≥ config
`pipeline.architectThreshold` OR the item is labeled `architecture`: dispatch
**Agent → aidlc-architect** to explore the codebase and write `## Plan` (+ ADR when the
decision is hard to reverse). It reports `MIS-SCOPED` → treat as blocked: comment, notify, stop.
Otherwise YOU write a short ordered plan (3–8 checkbox tasks) into `## Plan` — grounded in a
quick look at the relevant code, not guesswork. Items whose plan touches infra/CI/Docker only →
route the implement phase to **aidlc-devops** instead of the implementer.

**Every plan task declares the paths it will touch** — `- [ ] <task>  ·  paths: src/screens/users.tsx`.
This is not bookkeeping: §6 uses it to decide what can be implemented concurrently, and a task with no
declared paths is never parallelized (unprovable is not the same as safe). Two more fields where they
apply, both about **ordering, which paths cannot express**:

- `foundation: true` — this task creates something the later tasks build on (a shared component, a hook,
  a type, a migration). Everything after it waits.
- `dependsOn: <task ids>` — a narrower version of the same. **Declare it whenever a later task imports,
  calls or renders what an earlier one produces, even though their files are disjoint.** A task creating
  `hooks/usePagination.ts` and a task editing `screens/users.tsx` to use it share no path and are
  strictly ordered; nothing can infer that from the file lists, so if you omit it the two will be run
  side by side. When in doubt, declare the edge — a needless edge costs a little wall-clock, a missing
  one costs a broken build nobody can attribute.

Prefer paths that are **files**, not directories or globs: two globs cannot be proven disjoint, so the
resolver assumes they collide and serializes both.

### Bind the plan to the board's Task tier

The leaf is the branch/PR unit; the **Task tier is the team's unit of effort**
(`aidlc:work-items` → *The Task tier*). The run file's `## Plan` and the board's child Tasks are the
same breakdown, so bind them rather than keeping a private second copy. Read
`pipeline.taskSync.mode` (default `adopt`) — `off` skips this whole block, plan as above and continue.

Otherwise call **`children(<ID>, {type: "task"})`** *before* writing `## Plan`, and take one of three
paths:

**A · Tasks exist → they ARE the plan.** Seed `## Plan` from them, **in the board's order**, one plan
line per Task, each carrying its ID as a `wi:` binding:

```
- [ ] Add the profile DTOs  ·  paths: src/dto/profile.ts  ·  wi: PROJ-145
```

Then do the work the board cannot do for you: **enrich each line with `paths:`, and with
`foundation:`/`dependsOn:` where they apply**, grounded in the code exactly as above. A Task carries a
title and (sometimes) a description; it never carries a path list, and §6 will hold every unenriched
line serial. Three rules keep the binding honest:

- **Never silently drop or re-order a Task.** The board is the human's record of the work. A Task you
  cannot implement as written stays in the plan, unticked, with the reason on the line — it does not
  vanish because it was inconvenient.
- **A step the Tasks don't cover is a plan-only line** (no `wi:`). Add it, and say in `## Log` that it
  is unbacked. In `author` mode, offer to create the Task for it.
- **`aidlc:planning`'s 3–8 guidance does not apply to an adopted list** — it governs plans *you* author.
  Take however many Tasks the board has. But a leaf arriving with ~15+ Tasks is a **sizing signal**: say
  so in one line (the Story is probably an XL that should have been split), then run it as scoped. Do
  not truncate — a plan that quietly covers 8 of 15 Tasks reports green over work nobody did.

**B · No Tasks, `mode: author` → author them.** Write the grounded plan first (as above), then
**propose the Task list to the user before creating anything** — `create` is externally visible, so it
takes the same gate as `/aidlc:intake` §3. On approval, `create` one Task per plan task (parented to
the leaf, its `paths:` line in the description, no estimate — see below) and write each returned ID
back as that line's `wi:`. On decline, continue with an unbound plan; that is a fine outcome.

**C · No Tasks, `mode: adopt` (the default) → nothing changes.** Write the plan as above with no `wi:`
bindings. A board that does not use the Task tier behaves exactly as it did before this existed.

**Never write an estimate, priority or `dependsOn` onto a Task**, in any mode. Those carry human intent
and the contract has no op for them by design (`aidlc:work-items` → *What the contract deliberately
cannot do*). You move Tasks through their **states**; what the work was supposed to cost stays the
team's number.

**When the architect writes the plan** (size ≥ `architectThreshold`), make the `children` call
**first** and pass the adopted list in its brief. The binding is an input to planning, not an
annotation bolted on afterwards: an architect that has not seen the team's Tasks will author a
different decomposition, and reconciling the two after the fact is exactly the duplication this
removes. It returns the plan already bound — do not re-map it.

In **poly**, `children` may return Tasks routed to a different repo than this run's — that is the
`crossRepoSplit: task` umbrella shape, and it is handled at §2, not here. If you reach this section and
the children span repos, you are running an umbrella as if it were a leaf: go back to §2.

Record `taskSync: adopted <n> | authored <n> | none` on the run file's `## Log`, so the audit trail
states whether the board's breakdown drove this plan or the plan was AIDLC's own.

Phase → `implement`. Checkpoint.

## 6 · IMPLEMENT

**Bug variant first:** dispatch **Agent → aidlc-qa** to write a *failing* repro test
(per `aidlc:debugging`), commit it (`test(scope): failing repro for {ID}`).

### Resolve the schedule — one implementer, or several (don't hand-derive this either)

```
node "<plugin>/skills/run/resolve-fanout.mjs" <plan.json> .claude/aidlc.config.json
```

Serialize `## Plan`'s tasks (id, title, `paths`, `foundation`, `dependsOn`) to a temp JSON file and run
the resolver. It returns the plan **in order** as a sequence of *serial* steps and *parallel windows*,
with a stated reason for every task it held serial. It never reorders and never hoists, so the plan still
reads as what happens.

**All-serial is the common answer and is not a failure** — most items are one coherent change. When it
resolves that way, dispatch ONE implementer exactly as before and skip the rest of this block.

A **parallel window** means several plan tasks whose declared paths are provably disjoint and which
depend on nothing inside the window. Six screens getting the same treatment is the shape this exists
for. Dispatch them like this:

1. **One batch, N implementers** (`pipeline.implementFanout.maxAgents`, default 3, hard cap 5), each in
   **fan-out mode** (`aidlc-implementer` → *Fan-out mode*): its brief carries **only its own task and its
   own path allowlist**, and says plainly that it must not touch a path outside that list and must
   **not commit**.
2. **You commit, they don't.** This is the whole reason the fan-out is safe: the files are disjoint but
   git is not, and two agents racing `git add`/`commit` in one checkout is the collision D7 is really
   about. As each returns, `git add` **its declared paths** and commit in plan order with the task's own
   message (`aidlc:git-workflow` → *Commits*), then tick its checkbox. A window's bound Tasks sync at its
   closing checkpoint (*Mirror progress to the bound Tasks*, below) — the board write is yours too.
3. **Account for everything before moving on.** Each agent reports the paths it changed *and created*.
   After the window's commits, `git status` must be clean. Anything left over is a path an agent touched
   without declaring — commit it in a clearly-named reconciliation commit and **write it to `## Findings`
   as a fan-out contract violation**, because an undeclared write is exactly what the disjointness proof
   assumed away. Never leave it dirty for the next window to absorb.
4. **The gate runs ONCE, at the end of the window** — not per agent. A window is a partial change by
   construction (screen 2 done, screen 5 not started), so a mid-window gate failure says nothing useful,
   and running the full suite N times is the most expensive way to learn that. Individual agents may run
   narrow checks over their own files; the resolved gate (§7) is the authority.
5. **A `BLOCKED` verdict from any member ends the window.** Commit the clean members, leave the blocked
   task's checkbox unticked with its reason, and treat it as the ordinary blocker path below — do not
   dispatch the next window on top of a half-applied one.

Record `fanout: <schedule summary>` on the run file (e.g. `1 -> [2|3|4] -> 5`), so the audit trail states
what ran concurrently. If the resolver is unavailable, **run everything serially** — the fan-out is an
optimization and losing it costs time; guessing disjointness by eye costs code.

### The implementer brief

Dispatch **Agent → aidlc-implementer** with brief: run-file path, `## Plan`, AC list, stack
config, **the resolved gate** (below), **the runtime constraints** (next paragraph), and: implement per
plan, tick plan checkboxes as completed, commits per logical unit in the project's own commit style
(`aidlc:git-workflow` → *Commits*), **run the resolved gate before finishing**, append a summary line to
`## Log`. (In a parallel window, the commit and gate instructions are replaced by the fan-out contract
above — the agent neither commits nor runs the full gate.)

**Where a plan line carries a `wi:` binding (§5), its commit trailer names both IDs** — `Refs: <leaf>,
<task>` — the leaf for the PR, the Task for the effort. Put that in the brief with the plan; the
implementer reads the binding off the line it is working. It **never calls the adapter** — the board is
the orchestrator's to write (below), exactly as git is the orchestrator's in a parallel window.

**Runtime constraints go in the brief, as constraints — not as background.** Read `saas` from the
resolved repo entry (or the top-level block in mono). Where a field is **absent, say nothing** — an
unevidenced constraint asserted as fact is worse than silence. Where it is set, state the consequence:

| `saas` fact | What the implementer is told |
|---|---|
| `tenancy: shared-schema` + `tenantKey` | Every query and every new table filters/carries `<tenantKey>`. A missing filter is a **cross-tenant data leak**, not a failing test — nothing in the gate will catch it. |
| `tenancy: schema-per-tenant` / `database-per-tenant` | Isolation is structural; a migration must fan out across tenants, and a hardcoded schema/connection breaks every tenant but the first. |
| `featureFlags` with `required: true` | User-visible changes **ship behind a flag** — merging is not shipping here. If the change cannot be flagged, that is a blocker to raise, not to route around. |
| `liveDataConstraint: expand-contract` | Schema changes are add → migrate → backfill → remove **across releases**. Never drop or rename a column, narrow a type, or add `NOT NULL` to an existing column in one step. |
| `apiContracts` | Touching one of these paths is a **contract change**. Additive only unless the item explicitly asks to break it; note it on the run file so verify knows (§7). |
| `messaging` | A changed message shape is a breaking change with no contract file to fail — name the consumers or say you could not find them. |
| `compliance` | Named regime(s), so a change that adds data collection or logging is understood as an audit-relevant change. |

Record on the run file which constraints applied, so the audit trail shows the diff was written under
them rather than merely reviewed against them afterwards.

If implementer reports a hard blocker (missing dependency/credentials/contradictory AC) →
phase `blocked`, record in `## Findings`, `adapter.comment`, report to user, STOP.

### Mirror progress to the bound Tasks

Where §5 bound plan lines to Tasks (`wi:`), the board's effort tier tracks the commits that spend it.
**You do this, not the implementer** — one writer to the board, for the same reason there is one writer
to git in a parallel window.

**Sync on every checkpoint** from this phase onward — after each fan-out window, when the implementer
returns, at phase end, and on resume. Read `## Plan` and, for each line carrying `wi:`:

| Line state | Action |
|---|---|
| checkbox **ticked**, Task not yet terminal | `transition(<task>, done)` |
| checkbox **unticked** and the task is **currently dispatched** (the serial task in hand, or any member of the open window), Task still `todo` | `transition(<task>, in_progress)` |
| anything else | leave it alone |

Driving it off the checkboxes rather than off agent reports is what makes it **idempotent and
resume-safe**: the run file is the durable record, so re-syncing a partially-synced run is a no-op
rather than a double-write. Every transition is **read-back-verified** like any other mutation
(`aidlc:work-items` → *Write verification*).

Four guards, three of them mirroring the parent rollup at §3a:

- **Never reopen a terminal Task.** Not on a fix cycle, not on a scope-change resume, not when a later
  window touches the same files. A Task that a human closed stays closed.
- **Never move a Task that is already ahead of where you would put it** (in_review/done/blocked) —
  leave it and note it. You only ever advance `todo`→`in_progress`→`done`.
- **Never fight the tracker.** A rejected transition (team rollup rules, a required field, a state the
  type does not have) is a `## Log` note and the run continues. This is bookkeeping; it does not gate
  delivery.
- **Blocked stays on the leaf.** When the run blocks on a bound task, `comment` the blocker onto that
  Task and **leave its state alone**. The Story is already `blocked` and that is the item a human
  triages; a Task flipped to blocked that no later phase reliably flips back is board litter.

**Fix cycles** (§7) trail the leaf ID only where the reworked task's Task is already done — the effort
was accounted for and re-opening it would double-count. Where it is still open, the fix commit trails
both, and the finding note names the Task either way.

**UI items → design pod.** If the run file's `ui:` flag (set at §2) is **true**: once
backend/structure is in place, hand the frontend off by following `aidlc-ux:design` for this item's
run file, passing the **scope, mode and brand** you recorded at §2 — and, in poly, the **resolved
frontend repo** (its `path` as the working dir). The jury resolves the **render URL from the repo's
actual dev-server port** (parsed from its `package.json` `dev`/`start` script), using
`ux.renderBaseUrl` only as a fallback and failing loud on a non-UI response — so a stale config port
can't make it score the wrong server (F13; see `aidlc-ux:design-jury`). It runs narrative → research →
design system → (build/redesign +) motion, then the **jury loop to `ux.juryThreshold` (default 9),
capped at `ux.maxJuryRounds`**. Its `[open]` jury findings join `## Findings` and gate the PR the
same as reviewer/QA findings.

**Scaffold owns the port (F13).** When the implement phase **scaffolds a UX repo and assigns its
dev-server port** (e.g. picks :3100 to avoid colliding with an API on :3000), write that port back to
the repo's `ux.renderBaseUrl` in `aidlc.config.json` (the scaffold owns the port, so it owns the config
value) and **flag any cross-repo port collision**. This keeps the jury's fallback honest even before it
derives the port itself.
- If `ui: true` but `aidlc-ux` is not installed, build the UI with the implementer as usual and note
  in `## Findings` that the design gate was unavailable (so a human knows it shipped un-judged).
- `ui: false` items skip the pod entirely.

Phase → `verify`. Checkpoint.

## 7 · VERIFY (per-agent cadence — the pipeline's biggest cost, tuned)

### The gate — the project's, not npm's

**Resolve the gate before anything else in this phase — and do not hand-derive it.** This skill ships the
resolver:

```
node "<plugin>/skills/run/resolve-gate.mjs" .claude/aidlc.config.json <repoName> [packageName]
```

It prints the resolved ordered steps with each step's provenance, the `## Findings` coverage-hole lines,
and which steps need services. Execute the result **in the order printed** — the order is the contract —
from the repo's checkout, stopping at the first `required` failure.

Pass the **package** name (from §2.5) whenever the item resolved to one — omitting it silently runs the
repo-wide gate over a package that has its own, which is how a package's real test suite gets skipped
while the run still reports green.

**Why a script rather than a rule to follow:** the layering is easy to get wrong in a way that fails
*silently*. It walks **narrowest → broadest** (the repo's package layer, the mono `verify.packages` layer,
the repo, the workspace); each layer contributes its steps
in its own order, but only for gate names no narrower layer already claimed. Read only the narrowest list
instead and a Python package inside a TypeScript monorepo loses the repo-wide `lint` — and a gate that
vanished is indistinguishable from one that passed. Keep the broader layer's *ordering* instead and a repo
that deliberately declares `[test, lint]` gets silently reordered. A package that genuinely should skip a
repo-level gate says so by declaring that gate `status: absent` at package level, which keeps it visible
in the coverage-hole report instead of erasing it. (If the resolver is missing, apply that rule by hand.)

(Note `pipeline.gates.ambiguousRequirements` is a different concern living in the same block — the
requirements gate at §4, not this one.)

- **No `pipeline.gates.verify` at all** (a project that never adopted, or a greenfield scaffold): fall back to
  the `CLAUDE.md` Commands block as before. Do **not** assume npm scripts exist — a repo with no
  `package.json` has a real gate (`pytest`, `mvn -B verify`, `cargo test`, `go test ./...`) and
  `/aidlc:adopt` + `/aidlc:adopt-apply` are how it gets recorded.
- **A step with `status: not-applicable` is neither run nor a finding.** The stack has no such step (a
  Django service has no build; Go type-checks during `go build`), so there is nothing a team could ever
  add. List those once under the gate table as *"not applicable to this stack: build"* and move on —
  putting them in `## Findings` fills every run with holes nobody can close, which is how the section
  stops being read. `resolve-gate.mjs` exports `notApplicable(steps)` for exactly this list.
- **A step with `status: absent` is a coverage hole, not a pass.** Never count it green, never substitute
  an AIDLC default for it. Write one line per absent step into `## Findings` —
  `coverage hole: no <name> gate in <repo> (recorded absent at adoption)` — so every run states what the
  project cannot verify. It is deliberate, recurring, and the honest cost of an un-gated codebase.
- **`environmentDependent` failures are diagnosed differently.** If a step needing services fails, decide
  whether the services are actually up before blaming the diff, and record it as **environment
  unavailable** in `## Findings`, not as a regression. Getting this wrong sends a fix cycle chasing a
  missing database.
- **Scoping a slow suite.** Where a step's `scope` is `affected`, run the affected-graph runner's affected
  targets and **name the affected set** in the run file. Where it is `changed-paths`, derive the subset
  from this item's diff. Either way record **which subset ran** — `gate: test (affected: @acme/web,
  @acme/shared)` — because a green subset is not a green suite, and the full suite is CI's job. If a step
  has no scope narrower than `repo` and blows `pipeline.gates.verify.maxItemMinutes`, say so rather than silently
  waiting or silently skipping.
- **`providedByHook` steps** already run at commit time via the project's own hook manager; do not run
  them twice and do not install an AIDLC pre-commit layer over them.
- Record the outcome of every step — name, scope, subset, pass/fail/absent/environment-unavailable — in
  the run file. That list is the audit trail the PR carries.

### Risk triggers that outrank the cadence (from `saas`)

Cadence tunes cost. These three override it, because "we only review per-epic" is not an acceptable
answer for any of them. Check the branch diff (`git diff <base>...HEAD --name-only`) against the resolved
repo's `saas` block **before** reading cadence, and record each trigger that fires in `## Findings`:

1. **Diff touches `tenantIsolationPaths` or `authPaths`** (or any `pipeline.securityReviewPaths` entry
   seeded from them) → **aidlc-security runs**, regardless of cadence. `securityConfirm` still applies —
   ask before dispatching — but on decline write `[BLOCKER][open] security review declined on an
   auth/tenant-isolation diff` rather than the ordinary `[NOTE]`: a cross-tenant leak is not a note.
2. **Diff touches an `apiContracts` path** → the item is **contract-affecting**. Stamp
   `contract-affecting: true` on the run file, dispatch **aidlc-reviewer** regardless of cadence with an
   explicit breaking-change brief (is every change additive? are existing consumers still valid? is the
   version bumped if not?), and for a `public: true` contract say plainly in the PR body that external
   consumers are affected.
3. **Diff adds a migration and `liveDataConstraint` is `expand-contract`** → check it for destructive
   DDL: a dropped or renamed column, a narrowed type, a `NOT NULL` added to an existing column, a dropped
   table. Any of those is a **`BLOCKER` finding** (`- [BLOCKER][open] destructive migration against live
   tenant data: <file> — <what>. Expand/contract: add the new shape, backfill, migrate readers, remove
   in a later release.`), and it blocks the PR like any other blocker. A green gate is not evidence here:
   the migration runs fine against an empty test database and destroys production data.

None of these fire when the corresponding `saas` field is absent — the pipeline never invents a
constraint the scan did not evidence.

### Agent cadence

Read `pipeline.verification`. Defaults are **economical**: `mode` `auto`; `reviewer` `on-demand`;
`qa` `on-demand`; `security` `per-epic`; `securityConfirm` true. This is the *extra*, agent-driven
review — and it never runs over nothing: the implementer already ran the resolved gate green, and CI
re-runs it as a hard gate, so per-item quality has that floor **to the extent the project's gate covers
it** (an absent step is a hole in the floor, reported per run, never papered over). Each agent carries its
own **cadence** so tokens are spent only where they earn it. **When you must reproduce that gate
yourself** — a subagent returned a non-verdict (see the orchestrator invariants), or you can't take a
`file:`-sibling consumer's CI parity on trust — follow `aidlc:ci-cd` → *Local CI-parity for a
`file:`-sibling consumer* (F38): two-step sibling install, each gate step's exit code standing on its
own (no `&& echo` masking that fakes a green).

**Cadence values** (per agent): `per-item` (every item) · `per-epic` (defer to the epic's
consolidated pass, §2) · `on-demand` (run ONLY when this run was explicitly asked — the user's prompt
requested review/QA/security, or `## Findings` carries user-supplied issues to re-verify) · `off`.
`security` also takes `risk-based` (per-item, only when the diff is risky).

**Mode gate first:**
- `manual` → skip all agents; go to the manual/parking block below.
- `ask` → prompt the user which agents to run for THIS item (AskUserQuestion); use the answer as this
  item's cadence, record it in `## Log`. (Only `ask`/a security-confirm interrupt; `auto` is unattended.)
- `auto` → each agent's cadence decides:

  - **aidlc-reviewer** — runs if `reviewer` is `per-item`, or `on-demand` and this run requested it
    (adversarial diff review vs AC + standards per `aidlc:code-review`).
  - **aidlc-qa** — runs if `qa` is `per-item`, or `on-demand` and requested (full suite + missing
    tests per `aidlc:testing`). Bugs still got their failing-repro test at §6 regardless — that's the
    debugging protocol, not this pass.
  - **aidlc-security** — runs if `security` is `per-item`, or `risk-based` AND the diff is risky
    (overlaps `securityReviewPaths` / manifests-lockfiles changed / item labeled `security`), or
    `on-demand` and requested. **If it is due AND `securityConfirm`, ASK the user to confirm before
    dispatching**; on decline, add `[NOTE] security review declined` to `## Findings` and continue.
  - **Deferred (`per-epic`)** agents don't run here — log `- <agent> deferred to epic {parent}` and
    they run at epic consolidation (§2). An item with no parent epic whose only due check is per-epic:
    offer the confirmed pass at its own completion, else note it deferred.
  - **Nothing due** (the default per-item case — reviewer/qa on-demand, security per-epic) **and no
    risk trigger fired**: add
    `[NOTE] no automated verification this item (cadence) — CI gate + human PR review are the gate`
    to `## Findings` and go to §8. This is expected, not a failure. If a risk trigger *did* fire, the
    agents it named run even though the cadence says nothing is due — that is the whole point of the
    override, and the `## Findings` line names which trigger caused it.

### Dispatch order — the read-only agents in parallel, then QA

**Not one flat batch: QA writes.** Dispatch in two steps, because only one of these three agents mutates
the working tree:

1. **Batch 1 — reviewer + security**, whichever are due, in ONE parallel call. Both only *read* the
   diff, so there is nothing for them to collide on and no reason to pay their latency serially.
2. **Batch 2 — aidlc-qa**, after batch 1 has returned. Its verify mode **authors and commits tests**
   (`aidlc-qa` → *Verify mode*, steps 2 and 4), so it cannot ride in batch 1: new commits move `HEAD`
   and change `git diff <base>...HEAD` **while the reviewer is mid-review**, leaving findings written
   against a diff that no longer exists and two agents committing to one branch at once. The reviewer's
   job is the diff the *implementer* produced — that is the diff that has to be reviewed, and QA's tests
   are not part of it.

Only one due → there is no batch, just run it. Only QA due → run it alone; the ordering exists to
protect the reviewer, and with no reviewer there is nothing to protect. If QA's own commits are what
turn the tree dirty at §8, that is expected — commit state belongs to the branch either way.

Then:
1. No open `BLOCKER`/`MAJOR` → phase `pr`, go to §8.
2. Open blockers/majors AND `fixCycles < pipeline.maxFixCycles` → increment `fixCycles`, dispatch
   **aidlc-implementer** with ONLY the open findings, re-run this phase (re-dispatch only the agents
   that ran, scoped to the fixes — **in the same two-step order**, for the same reason).
3. Still failing at max cycles → phase `blocked`, `adapter.comment` with open findings, notify, STOP.

**Manual / nothing-runs parking** (`mode: manual`, or the user wants to review it themselves):
Skip agents, add `[NOTE] verification: manual — human review is the gate` to `## Findings`, go to §8
then §9, set phase `review-pending` and STOP with a ≤6-line message — **remote:** PR URL + "review
the PR … merge when satisfied"; **local:** "review the branch (`git diff <default>...<branch>`), then
re-run `/aidlc:run {ID}` to integrate (or merge yourself)". Either way: "to have issues fixed — or to
run reviewer/QA on demand — re-run `/aidlc:run {ID}` and ask (or add issues under `## Findings`)." On a
later resume with user-supplied findings, run the fix-cycle loop. Never auto-merge (remote) / never
merge without confirmation (local). **This is also how on-demand review/QA is delivered:** re-run and
request it.

## 8 · INTEGRATE (PR in remote mode; local merge in local mode)

Per `aidlc:git-workflow` for the **resolved repo** (cwd = `<repo.path>`; its `mode`/`host`/`remote`/
`defaultBranch`): commit any remaining state (incl. run file), then integrate per the repo's `mode`.

**Freeze window check, when the repo declares one** (`saas.freezeWindows`). If integrating now would land
inside a declared freeze, **say so and ask** — do not merge through it silently and do not refuse either:
opening the PR is almost always still correct (review can proceed), it is the *merge* the freeze governs.
State the window and its source, note that a `mode: local` run's merge **is** the deploy here, and let the
user decide. Never treat a freeze as a hard block on an unevidenced window — if `freezeWindows` is absent,
this paragraph does not apply.

**Label the PR with the resolved `package`** (§2.5) alongside the repo label, so a reviewer sees which
ownership boundary inside the monorepo the diff crosses. Add the `contract-affecting` label and, for a
`public: true` contract, a line in the PR body naming the external consumers affected (§7's trigger 2).

- **`mode: remote`** (default): push, create the PR with the filled pr-body template. Then: run-file
  `pr:` ← URL · `adapter.link(ID, {pr})` · `adapter.transition(ID, in_review)` ·
  `adapter.comment(ID, "PR open: <url>")`.
- **`mode: local`** (no remote): follow `aidlc:git-workflow` → *Local mode* — show the commit list +
  diffstat, get **explicit user confirmation** (this is the relocated human merge gate), then
  `--no-ff` merge into the default branch. On merge: run-file `pr:` ← `local-merge:<sha>` ·
  `adapter.link(ID, {pr: "local-merge:<sha>"})` · `adapter.comment(ID, "Merged locally: <sha>")`;
  the local merge completes integration, so this run will reach `done` at §10 (no separate human
  merge step remains). If confirmation isn't available (non-interactive) or the user declines: leave
  the branch, `adapter.transition(ID, in_review)`, phase `review-pending`, and STOP with the ≤6-line
  message (how to review the branch + re-run `/aidlc:run {ID}` to integrate). Never merge unattended.

Phase → `docs`. Checkpoint.

## 9 · DOCS

If the change affects README/API/user-facing behavior, dispatch **Agent → aidlc-docwriter** on
the same branch (its `docs(...)` commit amends the PR; push the update). It reports
`NO-DOCS-NEEDED` for internal-only changes — that's a fine outcome, move on.
If the PR's CI checks are red at this point, dispatch **Agent → aidlc-devops** in diagnosis
mode; branch-caused failures feed one extra fix cycle (respect `maxFixCycles` overall).

## 10 · WRAP

Phase → `done`. Final checkpoint + `## Log` summary (phases run, fix cycles, PR URL or local-merge sha).

**Reconcile the bound Tasks once more.** The final checkpoint runs the §6 sync, so every ticked plan
line's Task is closed. Any bound Task still open at this point is an **unticked plan line** — descoped,
deferred, or quietly never done — and it must be **named in the report, not closed to tidy the board**.
A Story going Done over an open Task is either honest (the Task moved out of scope, and a human should
retire it) or a dropped requirement, and only the human can tell which. Closing it here would erase the
one signal that distinguishes them.

**Archive the run file ON THE BRANCH before it merges (F23) — poly per-repo runs.** A poly per-repo run
file lives at `<repo.path>/.aidlc/runs/{ID}.md` and rides into `main` via the PR. If it rides in still
under the **active** `runs/` dir, it can only be archived afterwards by a **direct-to-`main` commit**,
which `aidlc:git-workflow` forbids — so it lingers forever and shows as a completed run in
`/aidlc:status`. Instead, as the **final commit on the feature branch**, `git mv` it to
`<repo.path>/.aidlc/runs/archive/{ID}.md` and commit `chore(aidlc): archive run {ID}` — **remote:** push
it to the open PR (a benign trailing commit, like the §9 docs commit) so it merges in **already
archived**; **local:** this must precede the §8 confirmed merge, so for local mode the post-merge
cleanup in `/aidlc:status` archives it in-session instead. The **control-plane** epic coordination file
(`.aidlc/runs/{EPIC-ID}.md`) is NOT committed to any product branch and archives normally at the control
plane. See `aidlc:run-state` → *Archive*.

**Blocked→resolved runs archive the same way — on the resolving branch (F36).** A run that completes
through a `blocked` → resolved cycle (fixed via a **follow-up PR**, not the original branch) hits the
same trap: if its run file already rode into `main` still stamped `phase: blocked`, it can only be
"archived" by a forbidden direct-to-`main` commit, so it lingers as a blocked *active* run in
`/aidlc:status` indefinitely. Handle it identically — **fold the archive into the resolving PR**: on that
PR's branch flip the run file to `phase: done`, `git mv` it into `runs/archive/`, and commit
`chore(aidlc): archive run {ID}` (`--no-verify` — a `.aidlc/**`-only bookkeeping commit, see
`aidlc:git-workflow`) so it merges in already archived. If the run file already merged un-archived, do
**not** direct-push to `main` (the guard blocks it, correctly) — open a small `chore(aidlc): archive`
branch → PR, or let `/aidlc:status` post-merge cleanup batch it.

Report to the user in ≤6 lines: item, branch, PR URL (or merge sha), assumptions count, findings
resolved, anything needing human eyes. **Where the run bound Tasks (§5), say so in the item line** —
`PROJ-123 · 5 board Tasks closed` (and name any left open, per the reconciliation above). The board
write is a side effect the human did not explicitly ask for on this run; stating it in the report is
how the default stays honest rather than merely quiet.
- **Remote mode:** **Humans review and merge the PR — never merge it yourself.** The item stays at
  `in_review` until merge. **ADO does NOT auto-close a work item when its PR merges (F22)** (unlike a
  GitHub `Closes #X` / branch-policy setup) — so the DONE transition + parent rollup is a **required
  post-merge step**, not something to rediscover per run. It runs on merge detection via
  `/aidlc:status` → *Post-merge cleanup* (or a later `/aidlc:run {ID}` resume that finds the PR merged).
  Left unhandled, the item sits open silently.
- **Local mode:** the default-branch merge only happened because the user confirmed it at §8 —
  **never merge into the default branch without that explicit confirmation.** The local merge
  completes integration, so the item reaches `done` here (no separate post-merge step).

## Capability gaps (self-extension protocol)

When you or a dispatched agent conclude "no skill/agent covers X" (an unfamiliar integration,
a recurring procedure):
1. **Search first**: installed plugin skills (core + stack packs) → project `.claude/skills|agents/`
   → `.aidlc/extensions.json`. Most gaps are an existing skill you didn't load.
2. Still missing AND plausibly reusable → follow `aidlc:scaffold-skill` (or
   `aidlc:scaffold-agent` only if the agent test passes) mid-run; the new capability is used
   immediately and committed with the branch.
3. One-off knowledge → just handle it inline; don't mint a skill nobody will load twice.
4. **Reuse tracking**: whenever a run loads a registered local extension, increment its
   `reuseCount` in `.aidlc/extensions.json` (commit with the branch). `/aidlc:status` surfaces
   promotion candidates at `reuseCount >= 2`.

## Orchestrator invariants

- **Never escalate an agent to a larger model to work around a failure.** Each agent's tier is
  deliberate (haiku docwriter, sonnet workhorses, opus architect/security). If a subagent dies
  with a model/API error, do NOT retry it on a bigger model — report the exact error and stop
  the phase; a model that won't load is an environment problem to fix, not a reason to burn a
  higher tier. (Overriding a tier is a human decision, never an automatic recovery.)
- Checkpoint the run file BEFORE dispatching any agent and AFTER it returns.
- Agent briefs always include: run-file path, the section(s) they may append to, and
  "return a short verdict + pointer, not a transcript".
- Keep your own context lean: read agents' verdicts, not their full output; the run file is the record.
- **A subagent's non-verdict is NOT a phase result (F37/F40).** Every agent's finish contract forbids
  returning on a pending self-launched background task. So if an agent returns without an explicit
  terminal verdict (`COMPLETE`/`BLOCKED`/`DIAGNOSED`/`APPROVE`/`FINDINGS`) — e.g. "still running, I'll
  wait for the background-task notification" — treat the phase as **unverified**: ground-truth the
  working tree yourself (`git status`, and re-run the phase's gate — tests/lint/CI-parity), commit or
  enumerate any leftover state, and drive the remaining deterministic steps directly. Do **not** stamp
  the phase complete on the agent's word, and do **not** blindly re-resume a yielding agent expecting a
  different result (resume once at most; if it yields again, take over). This pattern has recurred across
  the implementer and devops agents — it is a contract issue, not one agent's prompt.
- Any unexpected state (dirty tree at start, wrong branch, adapter errors) → report precisely; never improvise around safety rules.
- **Plugin self-feedback (when `pluginFeedback.enabled`).** If you — or a dispatched agent whose report
  says so — hit friction with the **plugin itself** (a gap you worked around, wrong/missing guidance, a
  broken shipped template, a per-run step you had to save to memory because the plugin didn't encode it),
  capture it via `aidlc:dogfood` (append to the feedback inbox) and continue — never stop delivery for it.
  This is distinct from project bugs (those are normal findings). Off by default; only dogfood/testing
  workspaces enable it.
