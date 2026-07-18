---
name: sprint
description: Run several independent work items in parallel headless pipeline runs — routed per repo from the control plane in poly, or in isolated git worktrees in mono — and aggregate progress into one board. Use when asked to work multiple backlog items at once or run a sprint.
argument-hint: "[N — max parallel items, default 3]"
disable-model-invocation: true
---

# /aidlc:sprint $ARGUMENTS — parallel items

Parallelism multiplies mistakes too — only INDEPENDENT items run concurrently. Default N=3,
hard cap 5.

## 1 · SELECT

1. Adapter `query({status: "todo", limit: N*2})` — ready items, priority order (skip items
   with non-terminal run files, epics with open children — same rules as `/aidlc:next`).
2. **Independence check** — dispatch **Agent → aidlc-analyst** with the candidate list, per
   `aidlc:planning` §dependency detection: likely file/subsystem overlap, AC referencing
   another candidate's output, parent-epic ordering, and **`dependsOn`** edges. Result: a
   conflict-free set of ≤ N (conflicting items queue behind their counterpart, noted on the
   board). **In poly, items in different repos are inherently independent** unless a `dependsOn`
   edge links them — cross-repo children of one epic parallelize freely once their dependencies
   have landed.
3. **One in-flight item per working tree.** Two selected items that resolve to the **same** repo
   would branch and commit in the same checkout. In poly (control-plane launch, §2) that is a hard
   constraint: keep the first, **queue** the second behind it. Same for two `control-plane` items.
   In mono every item gets its own worktree, so this doesn't bind.
4. Show the user the selected set + queue before launching. Confirm once; then run hands-off.

## 2 · LAUNCH — one headless run per item

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
claude -p "/aidlc:run {ID}" --permission-mode acceptEdits    # background; capture PID + log file
```

```
# MONO — the repo IS the AIDLC workspace, so a worktree of it carries .claude/ + backlog/
git worktree add ../{repo.name}-wt-{ID} -b {type}/{ID}-{slug} {remote}/{defaultBranch}
cd ../{repo.name}-wt-{ID}
claude -p "/aidlc:run {ID}" --permission-mode acceptEdits    # background; capture PID + log file
```

- **Mono worktrees still need trusting** — a worktree is a new workspace path, and Claude Code
  ignores `.claude/settings.json` allow rules in untrusted workspaces (every git/npm command would be
  denied). Before launching, add `projects["<worktree-path>"].hasTrustDialogAccepted: true` to
  `~/.claude.json` for each worktree (both slash styles on Windows), and remove those entries during
  WRAP cleanup. The control plane is already trusted (you are running in it), so poly launches skip
  this step entirely.
- **Mono worktrees inherit only what's committed.** `.claude/settings.json` rides into the worktree
  because it's tracked — but `.claude/settings.local.json` is gitignored and does **not**. If plugin
  enablement or permissions live only in the local file, seed a copy into the worktree before
  launching (`enabledPlugins` + `extraKnownMarketplaces` + `permissions`), and delete it at WRAP.
  The §2b preflight is what tells you whether this applies.
- Record `{item, repo, mode, cwd, worktree?, pid, logfile}` in `.aidlc/sprint-{date}.json` at the
  **control plane** (workspace root).
- Each headless run is a full pipeline: its run file lives at `<repo.path>/.aidlc/runs/{ID}.md`
  (poly, under the control plane) or `<worktree>/.aidlc/runs/{ID}.md` (mono) and is committed to its
  branch. Hooks (guard, checkpoint) apply in both.
- **Design-pod gate is deterministic here (F11):** a headless run can't prompt, so it applies
  `aidlc:run` §2's **scaffold-scope gate** with no interaction — a scaffold/skeleton item in a UI repo
  resolves to `ui: false` (skeleton-only, jury skipped), so a sprint never burns a full design-pod run
  on an empty shell. A real UI surface still fires the pod (ambiguity errs to `ui: true`).
- Stagger launches ~30s apart so npm installs/builds don't thundering-herd the machine.

### 2b · Preflight the launch cwd — before launching anything (F42)

A headless run that can't see the plugin exits **rc=0** within seconds, so exit codes prove nothing.
Check the launch cwd deterministically first — it's a file read, not a run:

1. `<cwd>/.claude/aidlc.config.json` exists (the run needs tracker + repo registry).
2. The `aidlc` plugin is **enabled for that cwd** — `enabledPlugins` naming `aidlc@<marketplace>` in
   `<cwd>/.claude/settings.json`, `<cwd>/.claude/settings.local.json`, or the user-level
   `~/.claude/settings.json`; and the marketplace is known (`extraKnownMarketplaces` at either scope,
   or an installed plugin dir).
3. Mono only: the worktree path is trusted in `~/.claude.json`.

Any check fails → **do not launch**. Report exactly which one and where the file was expected. In poly
this will usually mean the launch cwd is wrong (a product repo instead of the control plane).

### 2c · Verify each launch actually started — never trust rc=0 (F42)

After launching, before the launch counts as started, probe within ~90s:

- **Started** — `<repo.path or worktree>/.aidlc/runs/{ID}.md` exists, or the log shows real pipeline
  output (phase transitions, tool use) and the process is alive.
- **Dead on arrival** — the process exited with no run file, or the log matches
  `Unknown command|Unknown slash command|No such command|command not found`, or the log is trivially
  small (< ~200 bytes) with no run file.

**Launch the first item as a canary and confirm it started before launching the rest.** A
dead-on-arrival launch is an environment/config fault, not an item fault — it will hit every item
identically, so **abort the sprint**, print the canary's log verbatim, and re-check §2b rather than
burning the remaining slots on the same failure. Never report a sprint as launched on exit codes alone.

## 3 · MONITOR

Poll each run's `.aidlc/runs/{ID}.md` frontmatter (phase, fixCycles, pr) every few minutes
(or when a process exits) — under `<repo.path>` in poly, inside the worktree in mono. Render the
board on each change:

```
Sprint board (3 running, 1 queued):        (repo column shown in poly only)
  PROJ-124  backend   verify    fix-cycle 1   feature/PROJ-124-…
  PROJ-127  frontend  implement —             feature/PROJ-127-…
  PROJ-130  website   pr ✔      PR #42 open
  queued: PROJ-131 (dependsOn PROJ-127 — starts when it lands)
```

- A run hits `blocked` or its process dies → report immediately with the last `## Log` lines;
  do NOT auto-retry. Launch the next queued item in the freed slot (per §1.3, a queued item may be
  waiting on its repo's working tree, not just on `dependsOn`).
- Never edit files inside a live item's repo checkout or worktree from the parent session.

## 4 · WRAP

When all runs are terminal: summary table (item, repo, outcome, PR, findings resolved,
assumptions). Then cleanup:

- **Poly (control-plane launches)** — nothing to tear down; each run left its repo on its own branch
  with the PR open (or blocked, per §3). Just report state per repo.
- **Mono (worktrees)** — for each item with an OPEN PR: `git worktree remove
  ../{repo.name}-wt-{ID}` (run from the repo; the branch lives on the remote, the run file is in the
  PR), then drop its `~/.claude.json` trust entry and any seeded `settings.local.json` copy. Blocked
  items keep their worktree for resumption (`/aidlc:run {ID}` inside it) and are listed as needing
  attention.

Delete the control-plane `.aidlc/sprint-{date}.json` last.
