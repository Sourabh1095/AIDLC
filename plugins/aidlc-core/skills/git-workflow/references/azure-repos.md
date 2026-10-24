# git-workflow — azure repos

Part of the `aidlc:git-workflow` skill, kept apart so the runs that do not need it do not load it. Read when the resolved repo has `host: azure-repos`.

## Azure Repos (`host: azure-repos`)

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
