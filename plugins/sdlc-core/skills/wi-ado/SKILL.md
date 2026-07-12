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
| `type` | **Epic and Feature → `epic`** (both are decomposable parents; the actual ADO type is preserved in `sourceRaw.adoType`, so writes never convert one into the other) · User Story (Agile) / Product Backlog Item (Scrum)→story · Task→task · Bug→bug · spike = Task/Story tagged `spike`. Detect the process (Agile vs Scrum) from an existing item's type before creating. |
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

## Hierarchy — Epic → Feature → Story

ADO nests **Epic → Feature → User Story → Task/Bug**. The canonical schema has no `feature` tier, so
**both Epic and Feature map to canonical `epic`**: the orchestrator runs them through the epic variant
(decompose into child stories — `sdlc:run` §2), and `sourceRaw.adoType` records which it actually is.
When decomposing:
- a **Feature** → create **User Story** children parented under it (natural ADO nesting);
- an **Epic** → ADO's strict Agile hierarchy expects a Feature in between. Prefer creating a Feature
  and the stories under it; if the project parents stories directly under Epics (many do), do that and
  note the choice. **Never change the parent's own type** — read/write it via `sourceRaw.adoType`.

`query` never returns Epics or Features as *ready work* — parents decompose, they don't run.

## Re-decomposition & supersession (ADO specifics)

Implements `sdlc:work-items` → *Re-decomposition & supersession* on Azure Boards. Three ADO
constraints shape it:

- **Terminal state is per-work-item-type, not per-process.** When superseding an original that was
  re-tracked under new children (throughput-neutral), prefer the **`Removed`** state — but `Removed`
  exists for **User Story**, while a **Task** on the same board may have only **`Closed`** as terminal.
  So **probe the available states for THAT item's type** (`az boards work-item show` the type / inspect
  the process, or attempt `Removed` and catch the rejection) and adapt: prefer `Removed`, else fall
  back to `Closed` **plus a `superseded; delivered under <child ids>` comment**. Never hard-code
  `Removed`. Never leave the original `New` (`query` would resurface it as ready).
- **No REST retype.** ADO cannot change a work item's *type* via the API — you cannot "convert" a Task
  into a Story. Restructure by **create-new + link + supersede**, or by making the original an
  **umbrella** parent with new correctly-typed children under it (e.g. a carved-out AC becomes a new
  Task under a new umbrella Story, not a converted Task). Preserve the parent's real type via
  `sourceRaw.adoType`.
- **AC field is Story-tier.** `Microsoft.VSTS.Common.AcceptanceCriteria` lives on Stories/PBIs/Bugs,
  not Tasks. `updateAC` must write ACs to the **Story**; a Task only carries them in its
  `System.Description`. When re-decomposing, ensure carried ACs land on a Story-tier item.

## Status map

Canonical → ADO defaults; override in `workItems.ado.statusMap`. Detect the process first
(Epic/Feature use the same state names as User Story — New/Active/Resolved/Closed in Agile):

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
  `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '{project}' AND [System.State] IN ('New','To Do','Approved') AND [System.WorkItemType] NOT IN ('Epic','Feature') ORDER BY [Microsoft.VSTS.Common.Priority] ASC, [System.Id] ASC`
  via `az boards query --wiql "..."`, then fetch + map the first `limit + few` and apply the "ready" rule client-side.
- **create(item)** — `az boards work-item create --type "{mapped type}" --title "..." --fields "System.Description=..." "Microsoft.VSTS.Common.AcceptanceCriteria=..."`; add parent with `az boards work-item relation add --relation-type parent`. A canonical `epic` creates an ADO **Epic** by default; when decomposing a fetched **Feature**, create its children as **User Story** parented under it (see *Hierarchy*) — don't recreate the parent. When `repo` is set, add the `repo:<name>` tag (or set System.AreaPath per convention); for each `dependsOn` id add a `--relation-type predecessor` link (add these once all sibling children exist).
- **transition(id, status)** — `az boards work-item update --id {n} --state "{mapped}"` (with the stepping/fallback rules above). **Then read back and assert** the state landed (see *Write verification*) — the `az.cmd` fallback can return cleanly without persisting.
- **comment(id, markdown)** — `az boards work-item update --id {n} --discussion "SDLC: ..."` (HTML allowed; keep it simple).
- **link(id, {branch, pr})** — best effort artifact link (`az repos` / MCP); reliable fallback that ALWAYS runs: a discussion comment with the branch name and PR URL. Commits referencing `#<id>` also auto-link.
- **updateAC(id, criteria[])** — write the AcceptanceCriteria field as an HTML list (checked items as ✅ text — ADO has no native checkbox in that field); comment that AC were refined.

## Write verification (reported success ≠ persisted)

Per `sdlc:work-items` → *Write verification*: **every** mutation here (`transition`/`create`/`comment`/
`link`/`updateAC`) must **fetch the item back and assert the change landed** before recording success.
ADO makes this acute — a `az.cmd` write can return exit 0 without persisting (the concrete cause of a
live board sitting at "Development in Progress" while the run file said Closed). Assert; **tolerate
eventual consistency** (an immediate read-after-write may show stale/`None` — a just-set `parent` read
back as `None`, then an authoritative `wit_get_work_items_batch_by_ids` re-fetch showed it correct);
retry 2–3× with a short backoff; on a persistent mismatch **raise a hard error**, do not stamp success.

## Connectivity — "connected" ≠ "authenticated"

`/mcp` showing `azure-devops · connected · N tools` means the MCP **process started and registered
tools** — it does NOT mean ADO is reachable. It authenticates on the first real call; a common failure
is the opaque *"Failed to find api location for area."* Root cause is almost always the **launch
environment**: `ADO_MCP_ORG` must be set **and** `az login` must be accessible **in the shell that
launched Claude Code**. Installing `az` mid-session doesn't help — it isn't on the launching shell's
PATH; a full relaunch from a shell with both is required. If board reads fail this way, verify (and
tell the user): `echo $ADO_MCP_ORG` is set, `az account show` succeeds, `az devops configure --defaults
organization=… project=…` ran — all in the launching shell — then relaunch. (`/sdlc:status` surfaces
this as a doctor check.)

## Cautions

- HTML fields: always convert cleanly (no raw markdown dumped into System.Description).
- Re-read before every write (humans edit boards mid-run).
- Area/iteration paths: leave defaults on create unless the config or parent specifies them.
- **statusMap self-heal (F7 echo):** if `init` left `workItems.ado.statusMap` empty or wrong for a
  **customized** board (states like *Development in Progress / Ready for QA*, not the Agile defaults),
  detect the real `System.State` values on first use and reconcile the map before transitioning
  (`init` should pre-populate it by querying the board — but never trust that it did).
