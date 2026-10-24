---
name: sprint
description: Run several independent work items in parallel, each as a Claude Code background session — routed per repo from the control plane in poly, or in isolated git worktrees in mono — and aggregate progress into one board that says which run needs you. Use when asked to work multiple backlog items at once or run a sprint.
argument-hint: "[N — max parallel items, default 3]"
disable-model-invocation: true
---

# /aidlc:sprint $ARGUMENTS — parallel items

Parallelism multiplies mistakes too — only INDEPENDENT items run concurrently. Default N=3,
hard cap 5.

## 1 · SELECT

**0. An execution plan, if one exists, supplies the candidate set.** `.aidlc/plan.md` at the control
plane is an active wave schedule (`aidlc:replan`), and a wave is *already* a conflict-free concurrent
set — computed against the same three constraints this section checks by hand
(`dependsOn`, one item per working tree, width cap). So when a fresh plan exists, **the candidate set is
the earliest wave with open items**, and §1.1's priority query is skipped.

Check it is trustworthy first — the freshness check exactly as `aidlc:replan` → *The freshness check*
states it (snapshot ids → fetch them → `--freshness .aidlc/plan.md items-now.json --complete`).

**none** → use the wave silently; **additive** → use it, and say in one line what is unscheduled;
**breaking** → **do not use it**, name the drift, fall back to §1.1–1.3 below, and suggest
`/aidlc:replan`.

Two things do NOT get skipped even on a fresh plan, because they are checks the packer cannot make:
**§1.2's file/subsystem overlap check** (the packer reads declared `dependsOn` edges and repos; it never
reads code) and **§1.3's one-tree constraint** (re-assert it — the plan may have been cut before an item
was re-routed). A wave member that fails either is queued, noted on the board as a plan/reality
disagreement, and is a reason to re-plan. Cap the launch at `min(N, wave size)`.

1. Adapter `query({status: "todo", limit: N*2})` — ready items, priority order (skip items
   with non-terminal run files, epics with open children — same rules as `/aidlc:next`).
   **Scope by ownership in shared mode**, exactly as `/aidlc:next` step 2 does (`team.pickScope`,
   default `mine-then-unassigned`). A sprint launches N pipelines at once, so an unscoped selection is
   the same collision as `next`'s multiplied by N — and it is worse here, because N runs branch at once
   and nobody is watching any one of them closely. Also check the control
   plane is current first (`aidlc:work-items` → *Control-plane freshness*): a plan-driven sprint that
   launches from a stale `.aidlc/plan.md` launches the wrong wave.
   **A wave from `.aidlc/plan.md` is scoped too.** The packer schedules the whole team's work — it has
   no idea whose machine is running — so filter the wave to your scope before launching and say what you
   dropped: `wave 2 is PROJ-103 ‖ PROJ-104 ‖ PROJ-107; launching 2 (PROJ-107 is Rahul's)`. Dropping a
   wave member for ownership is **not** plan/reality drift and must not be reported as one.
2. **Independence check** — dispatch **Agent → aidlc-analyst** with the candidate list, per
   `aidlc:planning` §dependency detection: likely file/subsystem overlap, AC referencing
   another candidate's output, parent-epic ordering, and **`dependsOn`** edges. Result: a
   conflict-free set of ≤ N (conflicting items queue behind their counterpart, noted on the
   board). **In poly, items in different repos are inherently independent** unless a `dependsOn`
   edge links them — cross-repo children of one epic parallelize freely once their dependencies
   have landed.
   **Contract-first siblings are the case this matters most for** (`aidlc:work-items` → *Contract-first
   siblings*): a backend and a frontend child that both `dependsOn` a **landed** contract child, and not
   on each other, are independent **by declaration**. Select them together. Do not re-derive a
   frontend-waits-for-backend edge from their titles or from the fact that one calls the other's API —
   the contract is precisely the artifact that removed that edge, and re-adding it here silently undoes
   the decomposition. The analyst's overlap check still applies to *files*, which in poly they don't
   share anyway.
3. **One in-flight item per working tree.** Two selected items that resolve to the **same** repo
   would branch and commit in the same checkout. In poly (control-plane launch, §2) that is a hard
   constraint: keep the first, **queue** the second behind it. Same for two `control-plane` items.
   In mono every item gets its own worktree, so this doesn't bind.

   **This constraint is about YOUR filesystem, not the team's.** Worktrees, checkouts and the
   one-item-per-tree rule are all local: they say nothing about Priya running her own sprint against the
   same repos from her laptop. The cross-machine protections are the ownership scope in §1.1 (you only
   launch your own items) and the board's `in_progress` transition (a started item leaves the query).
   Neither is a lock, so in shared mode **keep N small** — the point of a sprint is your own parallelism,
   and a team already has parallelism across people.
4. Show the user the selected set + queue before launching (say which wave it is, when it came from a
   plan). Confirm once; then run hands-off.

## 2 · LAUNCH — one background session per item

Each item runs as a **Claude Code background session** (`claude --bg`): a full interactive session
with no terminal attached. Unlike a `claude -p` process, it **can ask**. A plan approval, an `ask`
verification, a security confirm or a permission prompt makes it show as *needs you* on the board,
and the person answers from `claude agents` (Space on its row) or `claude attach <id>`. Its process
is supervised too: a crash restarts it, and a stopped run keeps its conversation.

`sprint.mjs` does the launching and the board, so the flags are always the same:

```
S="${CLAUDE_PLUGIN_ROOT}/skills/sprint/sprint.mjs"; F=<control plane>/.aidlc/sprint-<date>.json
node "$S" launch <ID> --cwd <launch cwd> --run-file <run file path> --sprint-file "$F" \
     --mode mono|poly [--repo <repo.name>] [--worktree <path>] --effort <pipeline.effort.headless|medium>
node "$S" board --sprint-file "$F"            # the board, any time
node "$S" watch --sprint-file "$F"            # one line per change, for the Monitor tool (§3)
```

`launch` prints one JSON line. `{"ok":true,…}` records the run in the sprint file. A failure names a
`reason`:
- `untrusted`: the launch cwd is not trusted (§2a: trust the worktree), then launch again. Do not
  fall back, because a `-p` run in an untrusted folder would also have every allow rule ignored.
- `bg-unavailable`: this Claude Code has no background sessions. Relaunch with `--headless` (the old
  `claude -p` launch, detached with a log file). The board reads both kinds. Say once that those runs
  cannot ask, so their gates take the non-interactive defaults (`aidlc:run` → *A run that cannot ask*).
- `failed`: print its `output` verbatim and stop.

Resolve each item's **target repo** first (`aidlc:work-items` → *Repos & routing*). **How the run is
launched depends on the layout** — this is not cosmetic, it decides whether the run can start at all.

### 2a · Pick the launch mode

| layout | launch cwd | isolation comes from |
|--------|-----------|----------------------|
| **poly** (`repos[]` non-empty) | the **control plane** (workspace root), unchanged | separate repo checkouts — one item per repo (§1.3) |
| **mono** | a **git worktree** of the repo | the worktree |

**Poly launches from the control plane — never from a worktree of a product repo (F42).** In poly,
AIDLC lives *entirely* at the control plane: `.claude/settings.json` (plugin enablement + the
permission allowlist), `.claude/aidlc.config.json` (tracker + `repos[]`), `backlog/`, `CLAUDE.md`.
The product repos typically have **no `.claude/` at all**, so a worktree of one is a bare project —
no `/aidlc:*` commands, no permissions, no tracker config, no backlog, and `repos[].path` entries
that are workspace-relative and meaningless inside a single-repo checkout. Trusting the worktree does
not fix this: **plugin enablement is a `settings.json` concern**, while `hasTrustDialogAccepted` in
`~/.claude.json` only clears the trust prompt. A worktree launch there dies instantly with
`Unknown command: /aidlc:run` — **at rc=0**, so it looks like success.

This costs nothing, because `/aidlc:run` **already routes per repo**: in poly every git/branch/commit/
push/PR/verify step runs with `cwd = workspace.root/<repo.path>` (`aidlc:run` §2.5), and the run file
lands at `<repo.path>/.aidlc/runs/{ID}.md`. Items in different repos are isolated by construction, so
per-repo worktrees add contention risk without adding isolation.

```
# POLY — cwd stays at the control plane; the pipeline routes into repo.path itself
node "$S" launch {ID} --cwd <control plane> --mode poly --repo {repo.name} \
     --run-file <control plane>/{repo.path}/.aidlc/runs/{ID}.md --sprint-file "$F" --effort <level>
```

```
# MONO — the repo IS the AIDLC workspace, so a worktree of it carries .claude/ + backlog/
git worktree add ../{repo.name}-wt-{ID} -b <branch> {remote}/<base>
# <branch>: the repo's branchPattern, rendered per aidlc:git-workflow → Branching (type map included)
# <base>:   the repo's integrationBranch when it declares one (GitFlow `develop`), else defaultBranch
node "$S" launch {ID} --cwd ../{repo.name}-wt-{ID} --mode mono --worktree ../{repo.name}-wt-{ID} \
     --run-file ../{repo.name}-wt-{ID}/.aidlc/runs/{ID}.md --sprint-file "$F" --effort <level>
```

- **AIDLC owns isolation, not Claude Code.** A background session normally moves into a worktree of
  its own (under `.claude/worktrees/`) before its first edit. In poly that would be a worktree of the
  control plane, which has none of the product repos in it. `sprint.mjs` therefore launches with
  `worktree.bgIsolation: "none"` (`bg-settings.json`). The one-item-per-tree rule (§1.3) is the
  isolation, exactly as before.
- **`--effort` sets each background session's own thinking level** — the orchestrating main thread
  of that run, routing and bookkeeping — from `pipeline.effort.headless` (default `medium`). Its agents
  still get their per-dispatch effort from `resolve-effort.mjs`. N runs at once multiply whatever this
  costs, which is why it is a setting rather than inherited from whatever session launched them.
- **Mono worktrees still need trusting** — a worktree is a new workspace path, and Claude Code
  ignores `.claude/settings.json` allow rules in untrusted workspaces (every git/npm command would be
  denied), and launched from a script, `claude --bg` there exits with `Workspace not trusted` instead of
  asking. Before launching, add `projects["<worktree-path>"].hasTrustDialogAccepted: true` to
  `~/.claude.json` for each worktree (both slash styles on Windows), and remove those entries during
  WRAP cleanup. The control plane is already trusted (you are running in it), so poly launches skip
  this step entirely.
- **Mono worktrees inherit only what's committed.** `.claude/settings.json` rides into the worktree
  because it's tracked — but `.claude/settings.local.json` is gitignored and does **not**. If plugin
  enablement or permissions live only in the local file, seed a copy into the worktree before
  launching (`enabledPlugins` + `extraKnownMarketplaces` + `permissions`), and delete it at WRAP.
  The §2b preflight is what tells you whether this applies.
- `launch` records `{item, repo, mode, cwd, worktree, runFile, launch, session | pid+logfile}` in the
  sprint file at the **control plane** (workspace root). The session is named `aidlc-<ID>` in agent view.
- Each run is a full pipeline: its run file lives at `<repo.path>/.aidlc/runs/{ID}.md`
  (poly, under the control plane) or `<worktree>/.aidlc/runs/{ID}.md` (mono) and is committed to its
  branch. Hooks (guard, checkpoint) apply in both.
- **A sprint run asks at gates, not at offers** (`aidlc:run` → `--sprint`, which `launch` passes). It
  honours `pipeline.planApproval`, the `ask` verification mode, `securityConfirm` and the local-merge
  confirmation, because a background session can ask and the board surfaces it. Offers with a safe
  default (the design pod's skeleton confirmation, the Figma jury offer) take the default. A run that
  waits holds its slot, so if you want the sprint hands-off, leave `planApproval` at `off`. Only the
  `--headless` fallback takes the non-interactive defaults at gates too.
- **Design-pod gate is deterministic (F11):** `aidlc:run` §2's **scaffold-scope gate** applies with no
  interaction in a sprint — a scaffold/skeleton item in a UI repo resolves to `ui: false`
  (skeleton-only, jury skipped), so a sprint never burns a full design-pod run on an empty shell. A real
  UI surface still fires the pod (ambiguity errs to `ui: true`).
- Stagger launches ~30s apart so npm installs/builds don't thundering-herd the machine.

### 2b · Preflight the launch cwd — before launching anything (F42)

A run that can't see the plugin ends within seconds with `Unknown command`, and its launch still
reported success, so a launch proves nothing. Check the launch cwd deterministically first — it's a
file read, not a run:

1. `<cwd>/.claude/aidlc.config.json` exists (the run needs tracker + repo registry).
2. The `aidlc` plugin is **enabled for that cwd** — `enabledPlugins` naming `aidlc@<marketplace>` in
   `<cwd>/.claude/settings.json`, `<cwd>/.claude/settings.local.json`, or the user-level
   `~/.claude/settings.json`; and the marketplace is known (`extraKnownMarketplaces` at either scope,
   or an installed plugin dir).
3. Mono only: the worktree path is trusted in `~/.claude.json`.
4. **The tracker is reachable without a prompt.** An MCP tool with no allow rule stops every background
   run on a permission prompt at its first `fetch` (N prompts at once), and fails a `--headless` run
   outright. `workItems.source: ado` survives that — its adapter falls back to `az boards`. **`jira`
   does not: `wi-jira` has no CLI tier.** For a Jira workspace, confirm the settings allow the Jira MCP
   tools by their real ids (`aidlc:doctor` → *MCP tool names* lists them); if they are not allowed, do
   not launch, and say which allow rule is missing. (`markdown` needs no tool and always passes.)

Any check fails → **do not launch**. Report exactly which one and where the file was expected. In poly
this will usually mean the launch cwd is wrong (a product repo instead of the control plane).

These three are the launch-cwd subset, kept inline because they must run per launch. For the full
picture — permission-rule shapes, `git -C` coverage, repo paths, settings parsing — point the user at
**`/aidlc:doctor`**: a sprint that preflights clean can still have every item block on its first git
call (F43), and that is a workspace fault worth finding before N pipelines discover it in parallel.

### 2c · Verify each launch actually started — never trust the launch line (F42)

After launching, before the launch counts as started, run `board` within ~90s:

- **Started**: the row says `running`, or `NEEDS YOU` with a phase. The run file exists, so the
  pipeline is under way.
- **Dead on arrival**: the row says `dead on arrival`. The session ended (or is waiting on a reply)
  without ever writing a run file. Read why with `claude logs <session>` (or the `--headless` log
  file). `Unknown command` there means the plugin is not enabled for the launch cwd.
- `starting` means it is still loading. Check again shortly.

**Launch the first item as a canary and confirm it started before launching the rest.** A
dead-on-arrival launch is an environment/config fault, not an item fault — it will hit every item
identically, so **abort the sprint**, print the canary's log verbatim, and re-check §2b rather than
burning the remaining slots on the same failure. Never report a sprint as launched on the launch line
alone.

## 3 · MONITOR

Start `node "$S" watch --sprint-file "$F"` with the **Monitor** tool, at its longest timeout. It checks
every minute and prints a line only when a run changes (its phase, a fix cycle, starting to wait on
someone, finishing), then exits once every run is over. A monitor expires after 30 minutes: re-arm it
while runs are still in flight. Without the Monitor tool, run `board` every few minutes instead.
Render the board on each change, adding the plan and queue lines the script does not know:

```
Sprint board — 3 runs · 3 in flight · 1 needs you
  plan wave 2 of 4 · .aidlc/plan.md        (this line only when a plan supplied the set)
  PROJ-124   backend    verify         fix-cycle 1  running
  PROJ-127   frontend   design         —            NEEDS YOU · input needed
  PROJ-130   website    done           —            PR #42 open
  queued: PROJ-131 (dependsOn PROJ-127 — starts when it lands)
Needs you:
  PROJ-127: input needed → `claude agents` (Space on aidlc-PROJ-127) or `claude attach 3f2a…`
```

- **`NEEDS YOU`** → tell the person at once, in one line: which run, what it waits on, and how to
  answer (the board says). A run waiting on a person still holds its slot; it continues by itself
  once answered. Do not answer for them, and do not message the run instead: the answer is the
  person's to give, and a run in a different permission mode from this session holds cross-session
  messages for approval anyway.
- **`blocked` / `waiting for your review` / `dead on arrival` / `session gone`** → the run is over for
  this sprint. Report it with the last `## Log` lines (or `claude logs`); do NOT auto-retry. Launch the
  next queued item in the freed slot (per §1.3, a queued item may be waiting on its repo's working
  tree, not just on `dependsOn`).
- Never edit files inside a live item's repo checkout or worktree from the parent session.

## 4 · WRAP

When all runs are terminal: summary table (item, repo, outcome, PR, findings resolved,
assumptions). Then cleanup:

- **Poly (control-plane launches)** — nothing to tear down; each run left its repo on its own branch
  with the PR open (or blocked, per §3). Just report state per repo.
- **A plan-driven sprint ends by naming the next wave**, not by going quiet: `wave 2 done — wave 3 is
  PROJ-120 (db) · /aidlc:sprint to launch it`. If any wave member was **queued** rather than launched
  (§1.0 — an overlap or one-tree conflict the packer could not see), say that the plan and reality
  disagreed there and that `/aidlc:replan` will re-pack it.
- **Mono (worktrees)** — for each item with an OPEN PR: `git worktree remove
  ../{repo.name}-wt-{ID}` (run from the repo; the branch lives on the remote, the run file is in the
  PR), then drop its `~/.claude.json` trust entry and any seeded `settings.local.json` copy. Blocked
  items keep their worktree for resumption (`/aidlc:run {ID}` inside it) and are listed as needing
  attention.
- **Sessions**: for each run that finished (PR open, merged, or waiting for review), `claude rm
  <session>` removes its row from agent view. In mono, remove the git worktree **first**: `claude rm`
  also deletes a session's worktree. Keep the session of a blocked run. `claude attach <session>`
  reopens it with the whole conversation, which is a better resume than starting over.

Delete the control-plane `.aidlc/sprint-{date}.json` last.
