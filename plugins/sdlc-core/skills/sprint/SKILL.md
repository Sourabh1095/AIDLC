---
name: sprint
description: Run several independent work items in parallel, each in its own git worktree with a headless pipeline run, and aggregate progress into one board. Use when asked to work multiple backlog items at once or run a sprint.
argument-hint: "[N — max parallel items, default 3]"
disable-model-invocation: true
---

# /sdlc:sprint $ARGUMENTS — parallel items in worktrees

Parallelism multiplies mistakes too — only INDEPENDENT items run concurrently. Default N=3,
hard cap 5.

## 1 · SELECT

1. Adapter `query({status: "todo", limit: N*2})` — ready items, priority order (skip items
   with non-terminal run files, epics with open children — same rules as `/sdlc:next`).
2. **Independence check** — dispatch **Agent → sdlc-analyst** with the candidate list, per
   `sdlc:planning` §dependency detection: likely file/subsystem overlap, AC referencing
   another candidate's output, parent-epic ordering. Result: a conflict-free set of ≤ N
   (conflicting items queue behind their counterpart, noted on the board).
3. Show the user the selected set + queue before launching. Confirm once; then run hands-off.

## 2 · LAUNCH — one worktree + one headless run per item

For each selected item, from the repo root (clean default branch, fetched):

```
git worktree add ../{repo}-wt-{ID} -b {type}/{ID}-{slug} {remote}/{defaultBranch}
cd ../{repo}-wt-{ID}
claude -p "/sdlc:run {ID}" --permission-mode acceptEdits   # background process, capture PID + log file
```

- Launch as background processes; record `{item, worktree, pid, logfile}` in
  `.sdlc/sprint-{date}.json` in the MAIN repo.
- Each headless run is a full pipeline: its run file lives in ITS worktree at
  `.sdlc/runs/{ID}.md` and is committed to its branch. Hooks (guard, checkpoint) apply there too.
- Stagger launches ~30s apart so npm installs/builds don't thundering-herd the machine.

## 3 · MONITOR

Poll each worktree's `.sdlc/runs/{ID}.md` frontmatter (phase, fixCycles, pr) every few minutes
(or when a process exits). Render the board on each change:

```
Sprint board (3 running, 1 queued):
  PROJ-124  verify    fix-cycle 1   feature/PROJ-124-…
  PROJ-127  implement —             feature/PROJ-127-…
  PROJ-130  pr ✔      PR #42 open
  queued: PROJ-131 (overlaps PROJ-127 — starts when it lands)
```

- A run hits `blocked` or its process dies → report immediately with the last `## Log` lines;
  do NOT auto-retry. Launch the next queued item in the freed slot.
- Never edit files inside a live item's worktree from the parent session.

## 4 · WRAP

When all runs are terminal: summary table (item, outcome, PR, findings resolved, assumptions).
Then cleanup — for each item with an OPEN PR: `git worktree remove ../{repo}-wt-{ID}`
(the branch lives on the remote; the run file is in the PR). Blocked items keep their worktree
for resumption (`/sdlc:run {ID}` inside it) and are listed as needing attention.
Delete `.sdlc/sprint-{date}.json` last.
