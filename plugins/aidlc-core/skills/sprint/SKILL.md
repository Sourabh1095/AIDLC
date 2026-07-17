---
name: sprint
description: Run several independent work items in parallel, each in its own git worktree with a headless pipeline run, and aggregate progress into one board. Use when asked to work multiple backlog items at once or run a sprint.
argument-hint: "[N — max parallel items, default 3]"
disable-model-invocation: true
---

# /aidlc:sprint $ARGUMENTS — parallel items in worktrees

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
3. Show the user the selected set + queue before launching. Confirm once; then run hands-off.

## 2 · LAUNCH — one worktree + one headless run per item

Resolve each item's **target repo** first (`aidlc:work-items` → *Repos & routing*). For each
selected item, from **its target repo's** root (clean default branch, fetched):

```
# cwd = {workspace.root}/{repo.path}   (in mono, the single repo)
git worktree add ../{repo.name}-wt-{ID} -b {type}/{ID}-{slug} {remote}/{defaultBranch}
cd ../{repo.name}-wt-{ID}
claude -p "/aidlc:run {ID}" --permission-mode acceptEdits   # background process, capture PID + log file
```

- Each worktree branches from ITS repo's `remote`/`defaultBranch`; items in different repos never
  contend. Record the repo alongside `{item, worktree, pid, logfile}`.

- **Trust each worktree first** — a worktree is a new workspace path, and Claude Code ignores
  `.claude/settings.json` allow rules in untrusted workspaces (every git/npm command would be
  denied). Before launching, add `projects["<worktree-path>"].hasTrustDialogAccepted: true`
  to `~/.claude.json` for each worktree (both slash styles on Windows), and remove those
  entries during WRAP cleanup.
- Launch as background processes; record `{item, repo, worktree, pid, logfile}` in
  `.aidlc/sprint-{date}.json` at the **control plane** (workspace root).
- Each headless run is a full pipeline: its run file lives in ITS worktree at
  `.aidlc/runs/{ID}.md` and is committed to its branch. Hooks (guard, checkpoint) apply there too.
- **Design-pod gate is deterministic here (F11):** a headless run can't prompt, so it applies
  `aidlc:run` §2's **scaffold-scope gate** with no interaction — a scaffold/skeleton item in a UI repo
  resolves to `ui: false` (skeleton-only, jury skipped), so a sprint never burns a full design-pod run
  on an empty shell. A real UI surface still fires the pod (ambiguity errs to `ui: true`).
- Stagger launches ~30s apart so npm installs/builds don't thundering-herd the machine.

## 3 · MONITOR

Poll each worktree's `.aidlc/runs/{ID}.md` frontmatter (phase, fixCycles, pr) every few minutes
(or when a process exits). Render the board on each change:

```
Sprint board (3 running, 1 queued):        (repo column shown in poly only)
  PROJ-124  backend   verify    fix-cycle 1   feature/PROJ-124-…
  PROJ-127  frontend  implement —             feature/PROJ-127-…
  PROJ-130  website   pr ✔      PR #42 open
  queued: PROJ-131 (dependsOn PROJ-127 — starts when it lands)
```

- A run hits `blocked` or its process dies → report immediately with the last `## Log` lines;
  do NOT auto-retry. Launch the next queued item in the freed slot.
- Never edit files inside a live item's worktree from the parent session.

## 4 · WRAP

When all runs are terminal: summary table (item, repo, outcome, PR, findings resolved,
assumptions). Then cleanup — for each item with an OPEN PR: `git worktree remove
../{repo.name}-wt-{ID}` (run from that item's repo; the branch lives on the remote, the run file
is in the PR). Blocked items keep their worktree for resumption (`/aidlc:run {ID}` inside it) and
are listed as needing attention. Delete the control-plane `.aidlc/sprint-{date}.json` last.
