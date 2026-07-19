---
name: wi-ado
description: Work-item adapter for Azure DevOps Boards via the ADO MCP server, with an az boards CLI fallback and a PAT+REST last-resort. Implements fetch, query, create, transition, comment, link and updateAC using WIQL and the project's status map. Load when workItems.source is "ado".
user-invocable: false
---

# wi-ado — Azure DevOps Boards adapter

Implements the `aidlc:work-items` contract over Azure Boards. Config:
`.claude/aidlc.config.json → workItems.ado` = `{ org, project, statusMap }`.

**Tool preference (three tiers — prefer the first that works):**
1. **`azure-devops` MCP server** (bundled) — discover tool names via ToolSearch for `work item`
   (typical: `wit_get_work_item`, `wit_create_work_item`, `wit_update_work_item`,
   `wit_add_work_item_comment`, WIQL query tools).
2. **`az boards` CLI** (`az ...`, already permitted) — covers every operation below. Use when the MCP
   server isn't connected. **Headless runs land here by design, not by failure.** The project
   template allowlists `az boards`/`az rest` but no `mcp__*` tools, and a headless run cannot answer
   a permission prompt, so tier 1 is DENIED and tier 2 carries the run. That is expected — report
   ADO as working, not as "gated", and do not escalate to tier 3 on a tier-1 denial alone. To take
   tier 1 headless, add the ADO MCP tools to the project's `permissions.allow`; the rule must carry
   the literal `mcp__<server>__` prefix exactly as the tool appears in that session (check `/mcp` or
   run with `--verbose` — a bare `mcp__*` allow rule is skipped with a warning and grants nothing).
3. **PAT + REST last-resort** (off by default — see below). Use only when **neither** the MCP nor
   `az` is available (a locked-down box with no Azure CLI, an offline-signed environment) **and** the
   user has explicitly supplied a PAT. Before falling this far, tell the user the normal fixes
   (`az login`, `az extension add --name azure-devops`, set `ADO_MCP_ORG` + relaunch) — the PAT path
   is a workaround, not the recommended route.

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
(decompose into child stories — `aidlc:run` §2), and `sourceRaw.adoType` records which it actually is.
When decomposing:
- a **Feature** → create **User Story** children parented under it (natural ADO nesting);
- an **Epic** → ADO's strict Agile hierarchy expects a Feature in between. Prefer creating a Feature
  and the stories under it; if the project parents stories directly under Epics (many do), do that and
  note the choice. **Never change the parent's own type** — read/write it via `sourceRaw.adoType`.

`query` never returns Epics or Features as *ready work* — parents decompose, they don't run.

## Re-decomposition & supersession (ADO specifics)

Implements `aidlc:work-items` → *Re-decomposition & supersession* on Azure Boards. Three ADO
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

## Status map — resolve by **state category, per work-item-type** (F20)

**ADO state names are scoped per work-item-type, so a flat `statusMap` is wrong.** On a customized
board an Epic's working state may be **"In Progress"** while a Story/Feature's is **"Development in
Progress"** — a single name per canonical status can't be valid for every type. The stable key is the
state's **category**, which every state carries and which is uniform across types:

| canonical | ADO state **category** |
|---|---|
| todo | `Proposed` |
| in_progress | `InProgress` |
| in_review | `Resolved` (if the type has one; else nearest `InProgress` state + tag `in-review`) |
| done | `Completed` |
| blocked | keep current state + tag `blocked` |
| (superseded) | `Removed` (if the type has one; else `Completed` + `superseded` comment — see below) |

**Resolution algorithm for `transition(id, canonical)`:**
1. Read the item's **type** (`System.WorkItemType` / `sourceRaw.adoType`).
2. Get that type's states + their categories from the **work-item-type states API** —
   `GET {org}/{project}/_apis/wit/workitemtypes/{type}/states?api-version=7.1` (via the MCP or
   `az rest`); each entry is `{ name, stateCategory }` with `stateCategory` ∈
   Proposed/InProgress/Resolved/Completed/Removed.
3. Pick the **state name** whose category matches the canonical status above. That name is what you
   write to `System.State`. If several states share a category, prefer an explicit `statusMap`
   override for that `(type, canonical)`, else the first legal one and log the choice.

So rolling an **Epic** to in_progress resolves to *the Epic type's* `InProgress` state ("In Progress"),
not the Story's "Development in Progress" — the flat-map bug that mis-targeted a non-existent Epic state.

`workItems.ado.statusMap` may be **flat** (legacy: `canonical → name`, used only when a type has one
obvious state per category) **or per-type** (`{ "<Type>": { "<canonical>": "<state name>" } }`,
preferred on customized boards). Prefer per-type; treat a flat map as a hint, never as authoritative
for a type whose real states differ. If a transition is still rejected (ADO enforces per-process
transition rules), step through the nearest legal intermediate state by category; if still rejected,
apply the tag fallback and comment what happened.

## Operations

- **fetch(id)** — `az boards work-item show --id {n} --expand relations -o json` (or MCP equivalent); map as above.
- **query(filter)** — WIQL:
  `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '{project}' AND [System.State] IN ('New','To Do','Approved') AND [System.WorkItemType] NOT IN ('Epic','Feature') ORDER BY [Microsoft.VSTS.Common.Priority] ASC, [System.Id] ASC`
  via `az boards query --wiql "..."`. The WIQL returns the **full** ordered id list — for a full sweep
  (no `limit`) batch-fetch and map **all** of them (`wit_get_work_items_batch_by_ids` / `az` in chunks
  of ~200), apply the "ready" rule client-side, and **report the total count**; slice to a page only when
  the caller passed `limit`, and then signal how many more remain. **Never hard-cap at a default page
  size (e.g. 50) on a full-backlog sweep** (F34 — see `aidlc:work-items` → *Full-backlog sweeps*). A cheap
  count is `SELECT [System.Id] FROM WorkItems WHERE …` run for its row count, or the query tool's total.
- **create(item)** — `az boards work-item create --type "{mapped type}" --title "..." --fields "System.Description=..." "Microsoft.VSTS.Common.AcceptanceCriteria=..."`; add parent with `az boards work-item relation add --relation-type parent`. A canonical `epic` creates an ADO **Epic** by default; when decomposing a fetched **Feature**, create its children as **User Story** parented under it (see *Hierarchy*) — don't recreate the parent. When `repo` is set, add the `repo:<name>` tag (or set System.AreaPath per convention); for each `dependsOn` id add a `--relation-type predecessor` link (add these once all sibling children exist).
- **transition(id, status)** — `az boards work-item update --id {n} --state "{mapped}"` (with the stepping/fallback rules above). **Then read back and assert** the state landed (see *Write verification*) — the `az.cmd` fallback can return cleanly without persisting.
- **comment(id, markdown)** — `az boards work-item update --id {n} --discussion "AIDLC: ..."` (HTML allowed; keep it simple).
- **link(id, {branch, pr})** — best effort artifact link (`az repos` / MCP); reliable fallback that ALWAYS runs: a discussion comment with the branch name and PR URL. Commits referencing `#<id>` also auto-link.
- **updateAC(id, criteria[])** — write the AcceptanceCriteria field as an HTML list (checked items as ✅ text — ADO has no native checkbox in that field); comment that AC were refined.

## Write verification (reported success ≠ persisted)

Per `aidlc:work-items` → *Write verification*: **every** mutation here (`transition`/`create`/`comment`/
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
organization=… project=…` ran — all in the launching shell — then relaunch. (`/aidlc:status` surfaces
this as a doctor check.)

## PAT + REST last-resort (tier 3 — off by default)

When **neither** the MCP nor `az` can reach the board and the user has explicitly provided a
Personal Access Token, the same seven operations can run over the ADO REST API directly. This is a
deliberate escape hatch, not a normal path — prefer fixing MCP/`az` first.

- **Gate it.** Use this tier only when (a) tiers 1–2 are confirmed unavailable, and (b) a PAT is
  present. A PAT needs **Work Items: Read & Write** + **Project & Team: Read** at minimum. Never
  invent or persist one.
- **Secret handling — never write the token to a file.** Read it from the environment
  (`AZURE_DEVOPS_EXT_PAT`, the same var `az` honors) or accept it for in-session use only. **Do not
  echo it, commit it, or embed it in any generated artifact.** In particular, **never generate a
  self-contained HTML file with the PAT baked in** — that browser-pusher pattern (from the standalone
  claude.ai planner skill) is for sandboxes with no network and no CLI; here the write path is a
  direct, verified REST call, and a token-in-a-file is an avoidable leak.
- **Transport.** Basic auth header `Authorization: Basic base64(":" + PAT)`; create via
  `POST {org}/{project}/_apis/wit/workitems/${type}?api-version=7.1` with a
  `application/json-patch+json` body of `{op:add, path:/fields/<field>, value}` ops; iterations via
  `POST .../_apis/wit/classificationnodes/iterations`; parent/child via a `PATCH` adding a
  `System.LinkTypes.Hierarchy-Forward` relation. Field/type names per process are in the bootstrap
  skill's `references/work_item_types.md`.
- **Same contract still applies.** REST writes are subject to the identical **write-verification**
  (read back, assert, retry, hard-error on mismatch) and per-type **status-category** resolution as
  the MCP/`az` tiers — the transport changes, the guarantees do not.

## Cautions

- **PR merge does NOT transition the linked item (F22).** In ADO, `link`-ing a work item to a PR is a
  reference only — merging the PR does **not** move the item to a done state unless branch policy is
  explicitly configured to (most aren't). So the DONE transition is always an **explicit
  `transition(id, done)` adapter call** made post-merge (by `/aidlc:status` cleanup or a `/aidlc:run`
  resume), followed by the type-aware parent rollup. Never assume merge closed the item.
- HTML fields: always convert cleanly (no raw markdown dumped into System.Description).
- Re-read before every write (humans edit boards mid-run).
- Area/iteration paths: leave defaults on create unless the config or parent specifies them.
- **statusMap self-heal — key on `(type → category → real state name)` (F7 + F20).** If `init` left
  `workItems.ado.statusMap` empty or wrong for a **customized** board (states like *Development in
  Progress / Ready for QA*, not the Agile defaults), detect the real states on first use and reconcile
  before transitioning. F7's original self-heal only checked whether a state exists **on the board at
  all** — not whether it's legal for **this item's type** — so a state valid for Story ("Development in
  Progress") slipped through for an Epic that has none. Self-heal must resolve per the algorithm above:
  fetch the *item's type's* states + categories and map canonical → the category's real state name for
  **that type**. (F15 already made *terminal* states per-type; F20 extends it to the non-terminal
  working states.) `init` should pre-populate a **per-type** map by querying the board — but never
  trust that it did.
- **Parent rollup transitions are type-aware too (F19).** The proactive parent rollup (`aidlc:run` §3;
  `aidlc:work-items` → *Parent rollup*) transitions an Epic/Feature via this same category resolution —
  which is exactly why it must be type-aware: rolling an Epic to in_progress lands on the Epic type's
  `InProgress` state, not the Story's.
