# /aidlc:run — work that crosses a repo or package boundary

Read from `aidlc:run` §2.5 when the workspace is **poly** (the targeting mechanics below are not
optional there), when the item **spans repos or packages**, when an **epic is decomposed** across them,
or at an epic's **consolidation pass** (*The join*). A single-repo, single-package item never needs this
file. Everything here is part of the run skill — it is kept apart only so that most runs do not load it.

## Umbrella story (poly, `workspace.crossRepoSplit: task`)

When `crossRepoSplit` is `task` (see `aidlc:work-items` → *Cross-repo split tier*), a **User Story is a
cross-repo umbrella** and its child **Tasks are the single-repo runnable leaves**. So a Story whose
child Tasks span repos is NOT a `full` single-repo story run — treat it like the **epic/`decompose`
variant**: coordinate its per-repo Task children (run each in its repo per §2.5, in `dependsOn` order),
write a coordination file, and roll the Story up when its tasks complete (parent rollup, §3a / close
reconciliation). **Recognize existing children — don't re-decompose** a Story whose per-repo Tasks are
already on the board (query first; mirror the epic *consolidation* exception). Running an individual
**Task** of such a Story is a normal single-repo run (§2.5 non-epic path). In the default `story` mode
this doesn't apply — a Story is itself the single-repo leaf and runs the `full` variant.

## An item spanning packages inside one repo

**An item spanning packages inside one repo decomposes like cross-repo work** — per-package children,
sequenced by the packages' own `dependsOn` graph so a shared package lands before its consumers. Do not
be tempted to do it in one branch because they happen to share a repo: the review unit and the revert
unit stay the same size, which is the point. Follow `aidlc:work-items` → *Re-decomposition & supersession*
(AC coverage map, flag uncovered ACs, link + supersede) exactly as for a cross-repo split.

## Targeting another repo, routing outcomes, and splitting work across repos

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
  child **Tasks are the leaves**. Handle per *Umbrella story* above: coordinate/run the Task children in
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
