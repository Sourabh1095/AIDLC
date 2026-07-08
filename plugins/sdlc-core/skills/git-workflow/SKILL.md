---
name: git-workflow
description: Branch naming, conventional commits, push and PR creation for the SDLC pipeline — GitHub (gh CLI) and Azure Repos (az CLI) paths. Load when branching for a work item, committing pipeline work, or opening a pull request.
user-invocable: false
---

# Git workflow — branch → commit → push → PR

Read `.claude/sdlc.config.json → git` for: `host` (github | azure-repos), `defaultBranch`,
`remote`, `branchPattern`.

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
- The run file (`.sdlc/runs/<ID>.md`) is committed along with the work it describes.

## Push + PR

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
(org/project from `sdlc.config.json → workItems.ado`, or ask the user if source ≠ ado).

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

## Failure handling

- Push rejected (non-fast-forward): `git pull --rebase <remote> <branch>` requires approval — ask; never force.
- PR already exists for the branch: reuse it (`gh pr view --json url`), update the body if stale.
- Detached HEAD or dirty default branch: stop and report; never stash-and-hope on the default branch.
