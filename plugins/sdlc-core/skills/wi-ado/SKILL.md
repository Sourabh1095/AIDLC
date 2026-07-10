---
name: wi-ado
description: Work-item adapter for Azure DevOps Boards via the ADO MCP server with az boards CLI fallback. Implements fetch, query, create, transition, comment, link and updateAC using WIQL and the project's status map. Load when workItems.source is "ado".
user-invocable: false
---

# wi-ado — Azure DevOps Boards adapter

Implements the `sdlc:work-items` contract over Azure Boards. Config:
`.claude/sdlc.config.json → workItems.ado` = `{ org, project, statusMap }`.

**Tool preference:** the `azure-devops` MCP server (bundled) first — discover tool names via
ToolSearch for `work item` (typical: `wit_get_work_item`, `wit_create_work_item`,
`wit_update_work_item`, `wit_add_work_item_comment`, WIQL query tools). If the MCP server is
not connected, fall back to the `az` CLI (`az boards ...`, already permitted) — it covers every
operation below. If neither works, tell the user (`az login`, `az extension add --name azure-devops`).

CLI defaults: `az devops configure --defaults organization=https://dev.azure.com/{org} project={project}`
once per session, then omit `--org/--project` flags.

## ID convention

ADO work-item IDs are bare integers (`1234`). The pipeline's `{PROJECT_KEY}-{n}` form maps as:
strip the key prefix → numeric ID (`PROJ-1234` → `1234`); prepend it when displaying. Branch
names keep the prefixed form (`feature/PROJ-1234-slug`) — ADO links branches containing `#1234`
or via artifact links (below).

## Field mapping (work item ↔ WorkItem)

| WorkItem | ADO field |
|---|---|
| `type` | Epic→epic · User Story (Agile) / Product Backlog Item (Scrum)→story · Task→task · Bug→bug · spike = Task/Story tagged `spike`. Detect the process (Agile vs Scrum) from an existing item's type before creating. |
| `title` / `description` | System.Title / System.Description (HTML → markdown on read, markdown → HTML on write) |
| `acceptanceCriteria` | Microsoft.VSTS.Common.AcceptanceCriteria (HTML checklist) — the field exists on stories/PBIs and bugs |
| `status` | System.State via statusMap (below) |
| `priority` | Microsoft.VSTS.Common.Priority: 1→P1 … 4→P4 |
| `estimate` | StoryPoints/Effort: ≤2→S, 3–5→M, 8→L, ≥13→XL |
| `parent` | parent link (System.LinkTypes.Hierarchy-Reverse) |
| `repo` | a `repo:<name>` tag (default, no schema change) — or System.AreaPath if the project maps repos to area paths; detect the convention from an existing item before writing |
| `dependsOn` | Successor/Predecessor links (System.LinkTypes.Dependency); `dependsOn` = this item is the **successor** of each referenced id |
| `labels` | System.Tags (semicolon-separated) |
| `links.url` | `https://dev.azure.com/{org}/{project}/_workitems/edit/{id}` |

## Status map

Canonical → ADO defaults; override in `workItems.ado.statusMap`. Detect the process first:

| canonical | Agile (User Story) | Scrum (PBI) | Bug/Task |
|---|---|---|---|
| todo | New | New/Approved | New/To Do |
| in_progress | Active | Committed | Active/In Progress |
| in_review | Resolved | Committed + tag `in-review` | Resolved/In Progress + tag |
| done | Closed | Done | Closed/Done |
| blocked | keep state + tag `blocked` | same | same |

If a state transition is rejected (ADO enforces per-process rules), step through the nearest
legal intermediate state; if still rejected, apply the tag fallback and comment what happened.

## Operations

- **fetch(id)** — `az boards work-item show --id {n} --expand relations -o json` (or MCP equivalent); map as above.
- **query(filter)** — WIQL:
  `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '{project}' AND [System.State] IN ('New','To Do','Approved') AND [System.WorkItemType] <> 'Epic' ORDER BY [Microsoft.VSTS.Common.Priority] ASC, [System.Id] ASC`
  via `az boards query --wiql "..."`, then fetch + map the first `limit + few` and apply the "ready" rule client-side.
- **create(item)** — `az boards work-item create --type "{mapped type}" --title "..." --fields "System.Description=..." "Microsoft.VSTS.Common.AcceptanceCriteria=..."`; add parent with `az boards work-item relation add --relation-type parent`. When `repo` is set, add the `repo:<name>` tag (or set System.AreaPath per convention); for each `dependsOn` id add a `--relation-type predecessor` link (add these once all sibling children exist).
- **transition(id, status)** — `az boards work-item update --id {n} --state "{mapped}"` (with the stepping/fallback rules above).
- **comment(id, markdown)** — `az boards work-item update --id {n} --discussion "SDLC: ..."` (HTML allowed; keep it simple).
- **link(id, {branch, pr})** — best effort artifact link (`az repos` / MCP); reliable fallback that ALWAYS runs: a discussion comment with the branch name and PR URL. Commits referencing `#<id>` also auto-link.
- **updateAC(id, criteria[])** — write the AcceptanceCriteria field as an HTML list (checked items as ✅ text — ADO has no native checkbox in that field); comment that AC were refined.

## Cautions

- HTML fields: always convert cleanly (no raw markdown dumped into System.Description).
- Re-read before every write (humans edit boards mid-run).
- Area/iteration paths: leave defaults on create unless the config or parent specifies them.
