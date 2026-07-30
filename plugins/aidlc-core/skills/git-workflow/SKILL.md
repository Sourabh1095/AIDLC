---
name: git-workflow
description: Branch naming, conventional commits, push and PR creation for the AIDLC pipeline — GitHub (gh CLI) and Azure Repos (az CLI) paths. Load when branching for a work item, committing pipeline work, or opening a pull request.
user-invocable: false
---

# Git workflow — branch → commit → push → PR

**Scope: this is the shape of a *tracked* change** (`aidlc:ceremony` tier 2–3). A **tier-1 direct
change** takes no branch and no PR — it commits on whatever branch is checked out, and the only rule
below that still binds it is *nothing is pushed to `<base>` unattended*. Don't apply the branch/PR
machinery to a typo; don't skip it for a story.

Operate on the **resolved repo entry** for this run (see `aidlc:work-items` → *Repos & routing*),
not a hardcoded repo. Read from it: `host` (github | azure-repos), `mode` (remote | local; default
`remote`), `defaultBranch`, `remote`, `branchPattern`, and `path`. In **mono** this is the single
synthesized entry (`path: "."`); in **poly** it is the repo the orchestrator routed the item to
(§2.5 of `aidlc:run`). `mode` is resolved per-repo, so one repo can push+PR while another integrates
locally.

**Also read the project's own conventions from that entry** (or the mono `git` block) — they override
every default below, because an adopted project's conventions win over AIDLC's:
`integrationBranch` · `commitStyle` · `mergeStrategy` · `longLivedBranches` · `hotfixRoute` ·
`contribution` (`direct` | `fork`) + `upstreamRemote` · `conventionsSource`. Absent means AIDLC's default
applies. `conventionsSource: "human"` means someone authored them deliberately — follow them exactly and
never "correct" them.

**`integrationBranch` replaces `defaultBranch` as the branch target wherever it is set.** Define once, at
the top of the run:

> **`<base>` = `integrationBranch` if set, else `defaultBranch`.**

Every branch-from, PR `--base`/`--target-branch`, and local merge below uses `<base>`. On a GitFlow
project that means feature work branches from and integrates into `develop`, and **never** touches `main`.
Getting this wrong opens PRs against the wrong branch, which is worse than failing.

**Integration depends on `mode`.** `remote` (default) → push the branch and open a PR; a human
merges it (the mandatory gate). `local` → the repo has no usable remote, so there is nothing to
push to and no PR: after green verify the pipeline integrates by a **confirmed local `--no-ff`
merge** into the default branch (see *Local mode* below). Branching and commit rules are identical
in both modes — only the final integration step differs.

**Run every git command below with cwd = `workspace.root`/`<repo.path>`.** `git` and `gh` act on the
cwd's repo; `az repos` takes an explicit `--repository`. Never assume the control-plane cwd is a repo
in poly — always `cd` into the target repo first.

## Branching

- Pattern: the repo's `branchPattern` — AIDLC's default is `{type}/{id}-{slug}` with type map
  story→`feature`, bug→`bugfix`, task→`task`, spike→`spike`. An adopted project may use its own
  (`JIRA-123-description`, `feature/JIRA-123`); follow it, don't normalise it — its branch names feed the
  team's tooling and dashboards.
- Slug: title lowercased, hyphens, ≤5 words. Example: `feature/PROJ-123-user-avatar-upload`.
- Always branch from the up-to-date **`<base>`** (see above — `integrationBranch` when set):
  `git fetch <remote> && git checkout -b <branch> <remote>/<base>`
- If the branch already exists (resume), just check it out.
- **Never branch off, delete, or force-update a `longLivedBranches` entry** (`develop`, `release/*`,
  `hotfix/*`) as if it were a feature branch.
- **A production-incident item follows `hotfixRoute`** where the project has one — typically cut from the
  latest release tag rather than from `<base>`, and merged back to more than one branch. If the item is an
  urgent production fix and a hotfix route exists, say so and follow it instead of the normal flow; do not
  invent a hotfix path where the project has none.

## Commits

- **Follow the project's `commitStyle`:**
  - `conventional` (AIDLC's default): `feat|fix|chore|refactor|test|docs(scope): imperative message`
  - `id-prefixed`: `PROJ-123 imperative message`
  - `imperative-freeform`: a plain imperative subject, no type prefix
  - `mixed` or absent: use conventional, the safest superset — but do **not** rewrite or reformat the
    project's existing history to match.
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

### Fork-based contribution (`contribution: "fork"`)

The user cannot push to the upstream repo, so pushing to `<remote>` would fail — this is detected at
adoption time precisely so a run does not discover it at push time. Instead:

1. Push the branch to the **fork** (the repo's own `remote`, conventionally `origin`, which points at the
   fork): `git push -u <remote> <branch>`.
2. Open the PR **against the upstream**, from the fork's branch:
   `gh pr create --repo <upstream owner/repo> --head <fork owner>:<branch> --base <base> …`
   (`<upstream owner/repo>` from `upstreamRemote`'s URL). On Azure Repos, fork PRs need the fork as the
   source repository — if `az` cannot express it, stop and print the exact manual PR step rather than
   opening a PR against the wrong repo.
3. If the fork does not exist yet, **do not create it silently** — creating a repo under the user's account
   is their call. Report what is needed (`gh repo fork <upstream> --remote=false`) and stop.

Everything else — branching, commits, the gate — is unchanged.

### GitHub (`host: github`)

```
gh pr create --title "<PR title per the project's convention>" --body-file <tmp-body.md> --base <base>
```
- **PR title** follows the project's convention. AIDLC's default is `[<ID>] <imperative summary>`; a
  project whose history/PRs use `PROJ-123: …` or a bare imperative gets that instead. Check
  `commitStyle` and recent PR titles rather than imposing brackets.
- Build the body from `${CLAUDE_PLUGIN_ROOT}/templates/pr-body.md` (fill all sections; delete inapplicable ones).
- Capture the PR URL from stdout → run-file frontmatter `pr:` + `adapter.link(id, {pr})`.
- If `gh` is not authenticated, report the exact error and tell the user to run `gh auth login`; do not retry blindly.

### Azure Repos (`host: azure-repos`)

Prereqs: `az` CLI with the `azure-devops` extension, logged in; set session defaults once:
`az devops configure --defaults organization=https://dev.azure.com/{org} project={project}`
(org/project from `aidlc.config.json → workItems.ado`, or ask the user if source ≠ ado).

```
az repos pr create --repository <repo> --source-branch <branch> --target-branch <base> \
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
