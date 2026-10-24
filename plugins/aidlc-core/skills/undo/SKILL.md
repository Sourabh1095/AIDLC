---
name: undo
description: Reverse an AIDLC run cleanly — close its PR and delete its branch, or revert it through a new PR when it already merged — and put the board back the way the run found it. Never rewrites history, never force-pushes, never deletes a tracker item, shows the whole plan before touching anything. Use when a run should not have happened, went the wrong way, or the work is no longer wanted.
argument-hint: <work-item-id> [reason]
disable-model-invocation: true
---

# /aidlc:undo $ARGUMENTS — put things back the way the run found them

A run touches several places — a branch (local, and usually remote), maybe a PR, maybe a merge, the
work item's state, its bound Tasks, sometimes its parent, the items intake created for it, a run file and
a journal line. Undoing one by hand means remembering all of them, and the one forgotten is the one that
misleads the board for weeks. This command reads what the run did, shows it, and reverses exactly that.

**What it will never do:** rewrite history that left this machine (no reset of a pushed branch, no
force-push — the guard blocks both anyway), delete a tracker item (it closes or reopens, with a comment),
revert anything the run did not do, or touch a working tree with uncommitted changes. A merged change is
undone by a **revert PR** a human merges, never by editing the default branch.

## 1 · Find the run and read what it did — read-only

1. Locate the run file: `node "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/lib/run-files.mjs" <workspace-root> --all`
   (control plane, every repo, worktrees, and `runs/archive/`). No run file → it was not a run. If the
   journal shows a `direct` change for this description, it is one commit: offer `git revert <sha>` (a
   new commit, nothing rewritten) and stop.
2. From the run file and git, establish each fact — and say "unknown" rather than guess:
   - **Repo and branch** (`repo:`, `branch:`); whether the branch exists locally and on the remote; the
     commits on it that are not on its base (`git log <remote>/<base>..<branch> --oneline`).
   - **The PR** (`pr:`): open, merged or closed (`gh pr view <url> --json state,mergeCommit` /
     `az repos pr show`). In local mode, `pr: local-merge:<sha>` names the merge commit.
   - **The board**: the item's current state, and from `## Log` everything the run moved — the item's
     own transitions, bound Tasks it moved (`wi:` lines it ticked), a parent it rolled up (`§3a`), and
     items intake created for it.
   - **Other writes**: ADR files the run added, a sprint worktree (`<repo>-wt-<ID>`), a coordination file.
3. Check for anything that makes a step unsafe: uncommitted changes in the branch's working tree, a PR
   with **commits from someone else** on it, a merged change that **later commits build on** (the
   revert may conflict). Each is reported, and the step it affects is left for a human.

## 2 · Show the plan, then ask

One block, by state — only the lines that apply:

| State | What undo does |
|---|---|
| branch never pushed | switch to the base, delete the local branch, remove the sprint worktree |
| pushed, PR open (or no PR) | close the PR with a comment, delete the remote branch (`git push <remote> --delete <branch>`), then the local one |
| PR merged (remote) | branch `revert/<ID>-<slug>` from the base, `git revert` the merge (`-m 1`) or squash commit, push it and open a **revert PR** for a human to merge; the original branch is already gone or is left alone |
| merged locally (`local-merge`) | `git revert -m 1 <sha>` as a new commit on the default branch — only with explicit confirmation, exactly like the original local merge |
| the item | back to the state it had before the run (usually `todo`), or `removed`/closed if the user says the work is not wanted — with a comment naming the reason |
| bound Tasks | the ones the run moved go back to `todo`; one a human closed is left alone |
| parent rollup | a parent the run moved to `in_progress` goes back only if no other child is in flight |
| items intake created for it | listed; closed only if the user says so (never deleted) |
| run file | `## Log` gets `- <UTC> undone: <reason>`, `phase: abandoned`, archived per `aidlc:run-state` → *Archive* |

Ask with AskUserQuestion: **Undo all of it** (recommended) · **Choose parts** (then a multi-select of the
rows above) · **Cancel**. Anything §1 marked unsafe is shown as *left for you* and is not offered.

## 3 · Do it, in this order

1. **Code first, board second.** Close the PR / delete branches / create the revert PR. A board that says
   "undone" over a branch that is still open is the worse inconsistency.
2. **The board**, through the adapter, each transition read-back-verified (`aidlc:work-items` → *Write
   verification*). Comment once on the item: what was undone, why, and the revert PR if there is one.
   Never fight the tracker — a rejected transition is reported, not forced.
3. **The run file** — log, `phase: abandoned`, archive (commit it where the run lived: the revert branch
   for a merged run, the control plane for a coordination file; for an unpushed branch that no longer
   exists, the archive commit goes to the control plane's `.aidlc/runs/archive/`).
4. **Journal** one line: `node "${CLAUDE_PLUGIN_ROOT}/skills/journal/journal.mjs" append <workspace-root>
   undo "<ID> undone · <what was reversed> · <revert PR | branch deleted> · <anything left for a human>"`.

Report in ≤6 lines: what was reversed, the revert PR to merge if any, and every item left for a human.
A merged change is not undone until that revert PR merges — say so.
