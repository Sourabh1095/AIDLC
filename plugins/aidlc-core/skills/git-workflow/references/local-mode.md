# git-workflow — local mode

Part of the `aidlc:git-workflow` skill, kept apart so the runs that do not need it do not load it. Read when the resolved repo has `mode: local`, before integrating.

## Local mode (no remote)

Used when the resolved repo's `mode` is `local` — a project with no usable remote yet (e.g. before
the team has created the origin). Nothing is pushed and no PR is opened; the branch is integrated on the
local **`<base>`** instead. **The human gate is preserved — it moves from "review + merge the PR" to
"approve the local merge".** Never merge into `<base>` unattended.

After green verify (the orchestrator calls this at `aidlc:run` §8), from the repo's checkout
(cwd = `workspace.root`/`<repo.path>`):

1. **Show what will land**: the item, branch, commit list (`git log --oneline <base>..<branch>`),
   and a diffstat (`git diff --stat <base>...<branch>`). Any open BLOCKER/MAJOR finding →
   do NOT offer the merge; it goes back through the fix cycle first.
2. **Gate — get explicit approval** (this replaces PR review):
   - Interactive session → ask the user to confirm the local merge (AskUserQuestion where available).
   - Non-interactive (headless/sprint) or the user declines → do NOT merge. Leave the branch as-is,
     set phase `review-pending`, and report: `git diff <base>...<branch>` to review, then
     re-run `/aidlc:run <ID>` to integrate (or merge it yourself). This mirrors `manual` verification.
3. **Merge** (only after approval), into **`<base>`**, honouring the repo's `mergeStrategy` — a
   squash-only project must not receive a merge commit just because that is AIDLC's default:
   ```
   git checkout <base>
   # mergeStrategy: merge (default) — preserve the feature as a distinct merge commit
   git merge --no-ff <branch> -m "Merge <branch> ([<ID>] <imperative summary>)"
   # mergeStrategy: squash — one commit on <base>, message in the project's commit style
   git merge --squash <branch> && git commit
   # mergeStrategy: rebase — linear history, no merge commit
   git rebase <base> <branch> && git checkout <base> && git merge --ff-only <branch>
   ```
   The `rebase` path rewrites the feature branch's commits; that is expected here (it is the project's
   chosen strategy on a branch that has not been shared), but `git rebase` is in the `ask` permission list,
   so it prompts — which is correct, not a bug to route around.
   Record the resulting commit on the run file (`pr: local-merge:<short-sha>`) and via
   `adapter.link(id, {pr: "local-merge:<sha>"})`. Then delete the merged branch
   (`git branch -d <branch>`) unless the user wants it kept — **never** if it is a `longLivedBranches` entry.
4. **Never** push, force-anything, or touch a remote in local mode. If a `remote` is in fact
   configured and reachable, tell the user they can switch this repo to `mode: remote` for the
   PR flow — don't silently start pushing.

Merge conflict on step 3 (`<base>` moved under a long-running item): stop, report the
conflicting paths, and hand back to the implementer for a `git merge`-style resolution on the
branch first — never resolve conflicts blind on `<base>`.
