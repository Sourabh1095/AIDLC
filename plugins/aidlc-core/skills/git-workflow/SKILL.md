---
name: git-workflow
description: Branch naming, conventional commits, push and PR creation for the AIDLC pipeline — GitHub (gh CLI) and Azure Repos (az CLI) paths. Load when branching for a work item, committing pipeline work, or opening a pull request.
user-invocable: false
---

# Git workflow — branch → commit → push → PR

Operate on the **resolved repo entry** for this run (see `aidlc:work-items` → *Repos & routing*),
not a hardcoded repo. Read from it: `host` (github | azure-repos), `mode` (remote | local; default
`remote`), `defaultBranch`, `remote`, `branchPattern`, and `path`. In **mono** this is the single
synthesized entry (`path: "."`); in **poly** it is the repo the orchestrator routed the item to
(§2.5 of `aidlc:run`). `mode` is resolved per-repo, so one repo can push+PR while another integrates
locally.

**Integration depends on `mode`.** `remote` (default) → push the branch and open a PR; a human
merges it (the mandatory gate). `local` → the repo has no usable remote, so there is nothing to
push to and no PR: after green verify the pipeline integrates by a **confirmed local `--no-ff`
merge** into the default branch (see *Local mode* below). Branching and commit rules are identical
in both modes — only the final integration step differs.

**Run every git command below with cwd = `workspace.root`/`<repo.path>`.** `git` and `gh` act on the
cwd's repo; `az repos` takes an explicit `--repository`. Never assume the control-plane cwd is a repo
in poly — always `cd` into the target repo first.

## Branching

- Pattern: `{type}/{id}-{slug}` — type map: story→`feature`, bug→`bugfix`, task→`task`, spike→`spike`.
- Slug: title lowercased, hyphens, ≤5 words. Example: `feature/PROJ-123-user-avatar-upload`.
- Always branch from up-to-date default branch:
  `git fetch <remote> && git checkout -b <branch> <remote>/<defaultBranch>`
- If the branch already exists (resume), just check it out.

## Commits

- Conventional commits: `feat|fix|chore|refactor|test|docs(scope): imperative message`
- Body references the item: `Refs: PROJ-123`
- One logical change per commit; the build/tests must pass at every commit.
- The run file (`.aidlc/runs/<ID>.md`) is committed along with the work it describes.
- **Bookkeeping commits (`.aidlc/**` only) — `--no-verify` + verify-before-push (F39).** A docs-only
  `.aidlc/` commit (a `chore(aidlc): archive run <id>` run-file move, a run-file checkpoint) carries no
  code to lint or test, so commit it with `git commit --no-verify`. That stops a repo-local quality hook
  (husky/lint-staged) that assumes `node_modules` is installed from blocking the framework's own
  bookkeeping — the exact trap where `lint-staged: not recognized` aborted every archive commit on a
  machine that hadn't run `npm ci`. The exemption is **only** for `.aidlc/**`-only commits; product-code
  commits always run the hooks.
- **Verify a commit landed before you push (F39).** A pre-commit hook that fails *aborts the commit*,
  but a following `git push` still runs — pushing an **empty branch** and masking the failure. After
  every commit, confirm it actually landed (`git rev-parse HEAD` advanced / `git status` clean /
  `git log -1` shows it) **before** pushing. Never push assuming the commit succeeded.

## Push + PR (remote mode)

Push: `git push -u <remote> <branch>` (never `--force`; `--force-with-lease` requires user approval).

### GitHub (`host: github`)

```
gh pr create --title "[<ID>] <imperative summary>" --body-file <tmp-body.md> --base <defaultBranch>
```
- Build the body from `${CLAUDE_PLUGIN_ROOT}/templates/pr-body.md` (fill all sections; delete inapplicable ones).
- Capture the PR URL from stdout → run-file frontmatter `pr:` + `adapter.link(id, {pr})`.
- If `gh` is not authenticated, report the exact error and tell the user to run `gh auth login`; do not retry blindly.

### Azure Repos (`host: azure-repos`)

Prereqs: `az` CLI with the `azure-devops` extension, logged in; set session defaults once:
`az devops configure --defaults organization=https://dev.azure.com/{org} project={project}`
(org/project from `aidlc.config.json → workItems.ado`, or ask the user if source ≠ ado).

```
az repos pr create --repository <repo> --source-branch <branch> --target-branch <defaultBranch> \
  --title "[<ID>] <imperative summary>" --description "<line1>" "<line2>" ... -o json
```
- `--description` takes one argument PER PARAGRAPH — split the filled pr-body template on blank
  lines and pass each block as a separate quoted argument (markdown renders fine in ADO).
- Capture `.url` (or build `.../{project}/_git/{repo}/pullrequest/{pullRequestId}`) from the JSON
  output → run-file `pr:` + `adapter.link(id, {pr})`.
- Link the work item to the PR: `az repos pr work-item add --id <prId> --work-items <numeric-id>`
  (strip the key prefix — ADO IDs are bare integers).
- If `az` is not installed/authenticated, report the exact error and print manual PR-creation
  instructions with the pushed branch name. Never silently skip the PR step.

## Local mode (no remote)

Used when the resolved repo's `mode` is `local` — a project with no usable remote yet (e.g. before
the team has created the origin). Nothing is pushed and no PR is opened; the branch is integrated on
the local default branch instead. **The human gate is preserved — it moves from "review + merge the
PR" to "approve the local merge".** Never merge into the default branch unattended.

After green verify (the orchestrator calls this at `aidlc:run` §8), from the repo's checkout
(cwd = `workspace.root`/`<repo.path>`):

1. **Show what will land**: the item, branch, commit list (`git log --oneline <defaultBranch>..<branch>`),
   and a diffstat (`git diff --stat <defaultBranch>...<branch>`). Any open BLOCKER/MAJOR finding →
   do NOT offer the merge; it goes back through the fix cycle first.
2. **Gate — get explicit approval** (this replaces PR review):
   - Interactive session → ask the user to confirm the local merge (AskUserQuestion where available).
   - Non-interactive (headless/sprint) or the user declines → do NOT merge. Leave the branch as-is,
     set phase `review-pending`, and report: `git diff <defaultBranch>...<branch>` to review, then
     re-run `/aidlc:run <ID>` to integrate (or merge it yourself). This mirrors `manual` verification.
3. **Merge** (only after approval), preserving the feature as a distinct merge commit:
   ```
   git checkout <defaultBranch>
   git merge --no-ff <branch> -m "Merge <branch> ([<ID>] <imperative summary>)"
   ```
   Record the merge commit on the run file (`pr: local-merge:<short-sha>`) and via
   `adapter.link(id, {pr: "local-merge:<sha>"})`. Then delete the merged branch
   (`git branch -d <branch>`) unless the user wants it kept.
4. **Never** push, force-anything, or touch a remote in local mode. If a `remote` is in fact
   configured and reachable, tell the user they can switch this repo to `mode: remote` for the
   PR flow — don't silently start pushing.

Merge conflict on step 3 (default branch moved under a long-running item): stop, report the
conflicting paths, and hand back to the implementer for a `git merge`-style resolution on the
branch first — never resolve conflicts blind on the default branch.

## Failure handling

- Push rejected (non-fast-forward): `git pull --rebase <remote> <branch>` requires approval — ask; never force.
- PR already exists for the branch: reuse it (`gh pr view --json url`), update the body if stale.
- Detached HEAD or dirty default branch: stop and report; never stash-and-hope on the default branch.
- Bookkeeping (run-file archival) never justifies a direct push to the protected default branch — the
  guard blocks that correctly, and it's not a bug to work around. Archive **on the feature/resolving
  branch pre-merge** (it rides in via the PR), or via a dedicated `chore(aidlc): archive` branch → PR;
  never poke a hole in branch protection to move a markdown file. (See `aidlc:run` §10 and
  `aidlc:run-state` → *Archive*.)
- Remote mode but no remote is configured (`git remote` is empty): stop and report — either add the
  remote, or set the repo's `mode: local` in `aidlc.config.json` to use the local-merge flow. Never
  invent a remote.
