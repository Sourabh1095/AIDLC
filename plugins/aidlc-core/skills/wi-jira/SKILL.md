---
name: wi-jira
description: Work-item adapter for Jira via the Atlassian MCP server. Implements fetch, query, children, create, transition, comment, link and updateAC over Jira issues using JQL, discovering the site's custom fields and its per-issue-type statuses before it maps anything. Load when workItems.source is "jira".
user-invocable: false
---

# wi-jira — Jira adapter (Atlassian MCP)

Implements the `aidlc:work-items` contract over Jira. Requires the `atlassian` MCP server, which ships
in the **`aidlc-tracker-jira`** plugin — install it (`/plugin install aidlc-tracker-jira@<marketplace>`)
and authenticate via OAuth on first use.

**This adapter has no CLI fallback**, unlike `wi-ado`'s `az boards` tier: if the server is missing or
unauthenticated, every operation fails and there is nothing to degrade to. Say that plainly and stop —
do not improvise a REST call or guess at issue state. `/aidlc:doctor` reports a missing plugin as a hard
failure for exactly this reason. Config: `.claude/aidlc.config.json →
workItems.jira` = `{ site, project, statusMap }`.

Discover the exact MCP tool names at runtime (ToolSearch for `jira`) — typical names:
`getJiraIssue`, `searchJiraIssuesUsingJql`, `createJiraIssue`, `editJiraIssue`,
`transitionJiraIssue`, `getTransitionsForJiraIssue`, `addCommentToJiraIssue`. If the server is
unavailable, tell the user to check `/mcp` and authenticate — do not fall back to guessing.

## Field mapping (Jira issue ↔ WorkItem)

**Jira field ids are per-site, so this table names concepts, not ids** — `customfield_10016` is Story
Points on one site and "Team" on the next, and nothing warns you. Resolve every *conventional* field
(`aidlc:work-items` → *The three classes of canonical field*) through *Schema discovery* below before
mapping, and **never hard-code a `customfield_*` number.**

| WorkItem | Jira |
|---|---|
| `id` | issue key (`PROJ-123`) |
| `type` | issuetype: Epic→epic, Story→story, Task→task, Bug→bug, Spike (or Task+label `spike`)→spike |
| `title` / `description` | summary / description (convert ADF→markdown on read, markdown→ADF on write if required by the tool) |
| `acceptanceCriteria` | the "Acceptance Criteria" custom field if the site has one; OTHERWISE a `## Acceptance Criteria` / "AC:" checklist inside the description — detect which convention the project uses from an existing issue before writing |
| `status` | via statusMap (below) |
| `priority` | Highest→P1, High→P2, Medium→P3, Low/Lowest→P4 |
| `estimate` | story points if present: ≤2→S, 3–5→M, 8→L, ≥13→XL |
| `parent` | parent/epic link key |
| `repo` | a `repo:<name>` label (default, no custom field needed) — or a Component if the project maps repos to components; detect which convention an existing issue uses before writing |
| `dependsOn` | issue links of type **"Depends on"** (inward) — read the outward "Blocks" side too |
| `labels` / `assignee` | labels / assignee displayName (read-only — the pipeline never writes it) |
| `links.url` | `https://{site}/browse/{key}` |

## Schema discovery — fields and statuses are per-site **and per-issue-type**

Implements `aidlc:work-items` → *Schema discovery* on Jira. Two Jira facts make this mandatory rather
than defensive:

- **Custom field ids are allocated per site.** Story Points, Acceptance Criteria, Team, Severity, Epic
  Link — all `customfield_<n>`, and the `<n>` differs between two sites of the same company. A
  hard-coded id reads whatever field happens to occupy that number, which is worse than reading nothing.
- **Statuses are scoped per issue type** by the project's workflow scheme. A Story can run
  *To Do → In Progress → In Review → Done* while a Bug on the same board runs
  *Open → Triaged → Fixing → Verified → Closed*. One flat name per canonical status cannot be right for
  both — the identical mistake F20 fixed for ADO.

**Probe once per session.** Tiers 1–2 answer *fields* (prefer 2 — see why below), tier 3 answers
*statuses*, and tier 4 is the fallback for either when the MCP exposes neither. Discover the tool names
via ToolSearch for `field`, `createmeta`, `issue type`, `status`:

1. **Field list** — the site's fields with `id`, `name`, `custom` and `schema`
   (`/rest/api/3/field` equivalent). Resolves display name → id.
2. **Createmeta, per issue type** — the project+type's *actual* field set with `required`,
   `allowedValues` and `schema` (`/rest/api/3/issue/createmeta?projectKeys={project}&expand=projects.issuetypes.fields`
   equivalent). **This is the authoritative tier** and the only one that answers "does this type have
   this field", which tier 1 cannot.
3. **Project statuses per issue type** (`/rest/api/3/project/{project}/statuses` equivalent) — each type
   with its statuses and each status's `statusCategory`.
4. **Last resort: a representative issue per type**, with field names expanded (`expand=names`) to map
   `customfield_*` → display name, plus `getTransitionsForJiraIssue` for reachable statuses. Weakest
   tier, and the reason it is last: **an empty field and an absent field look identical here** —
   `aidlc:work-items` → *Sampling an item is not a schema probe*. Say when you had to use it.

Record the result in `workItems.jira.fieldMap` (per-issue-type keys, `null` for absent) and
`workItems.jira.statusMap`.

### Fields

| Canonical | Resolve as |
|---|---|
| `acceptanceCriteria` | the custom field whose name reads as acceptance criteria, per type; else **`null` → the `## Acceptance Criteria` / "AC:" section of the description** |
| `estimate` | the story-points field **by name** — `Story Points` on company-managed, `Story point estimate` on team-managed. Read-only; the pipeline never writes it |
| `parent` | `parent` on any current site. A legacy company-managed site models epic children through the **"Epic Link"** custom field instead — resolve which, once, and use it in `children` too |
| `priority` | `priority` when the type has it. Some team-managed projects omit it: then order by **`rank`** (the board's own order) and report P3, rather than inventing a priority the board does not hold |
| `repo` | a `repo:<name>` label by default; a **Component** where the project maps repos to components. `null` means the label convention |
| `dependsOn` | issue links of type **"Depends on"** — confirm the link type exists on the site; its name is configurable and a site may only have "Blocks" |
| `labels` / `assignee` / `summary` / `description` / `status` | universal, no probe needed |

**Required-on-create comes from tier 2, before the first create** — not from a rejected create halfway
through an epic decomposition. Team-managed and company-managed projects differ here, and mandatory
`Team` / `Severity` / a required custom picklist are ordinary enterprise configuration. Fill from
canonical data, else the field's own default or single `allowedValues` entry, else **ask** (never
invent). This upgrades the old *"fetch createmeta if creation fails"* caution from reactive to proactive.

### Statuses — resolve by **category, per issue type**

The stable key is `statusCategory`, which every status carries: `new` (To Do) · `indeterminate` (In
Progress) · `done` (Done). Map canonical → the status whose category matches, **for that issue type**:

| canonical | Jira `statusCategory` | Default name when the site is stock |
|---|---|---|
| todo | `new` | To Do |
| in_progress | `indeterminate` | In Progress |
| in_review | *(no category of its own)* | In Review |
| done | `done` | Done |
| blocked | *(no category of its own)* | Blocked |

**`in_review` and `blocked` are the two that need care**, because Jira has only three categories and both
of these live inside `indeterminate`:

- **`in_review`** — prefer an `indeterminate` status whose name reads as review/QA/verification
  (*In Review*, *Code Review*, *In QA*, *Verifying*). Several candidates → prefer an explicit
  `statusMap` override, else the one reachable from the current status, and log the choice. None →
  the documented degradation: stay in the working status and comment.
- **`blocked`** — a real `Blocked` status where the type has one; otherwise keep the current status and
  add the `blocked` label + a comment. Never move an item backwards to fake it.

`workItems.jira.statusMap` may be **flat** (`canonical → name`, fine when every type shares one
workflow) or **per-issue-type** (`{ "<Issue Type>": { "<canonical>": "<status name>" } }`, preferred on a
site with a workflow scheme). Prefer per-type; treat a flat map as a hint, never as authoritative for a
type whose real statuses differ.

## Operations

- **fetch(id)** — get the issue, map fields as above. Include the last ~5 comments in `sourceRaw` context when refining requirements.
- **query(filter)** — JQL:
  `project = {project} AND statusCategory = "To Do" AND issuetype IN (Story, Task, Bug, Spike) ORDER BY priority DESC, rank ASC`
  (+ `AND labels = {label}` when filtered). **`assignee` filter** (see `aidlc:work-items` → *Ownership*):
  `"me"` → **`AND assignee = currentUser()`** — prefer this over resolving an id, since the MCP is
  OAuth'd as that person and JQL evaluates it server-side; unassigned → `AND assignee IS EMPTY`; both
  (the `mine-then-unassigned` scope) → `AND (assignee = currentUser() OR assignee IS EMPTY)`. A named
  person other than the caller → resolve the email to an `accountId` (user-search tool) and compare on
  that; **never** match on `displayName`, which is neither unique nor stable. Apply the
  "ready" rule (≥1 AC except task/spike; parent not blocked) client-side after mapping. When a `limit` is given it bounds one page; with **no `limit`** (a full sweep) page through **all** matches via JQL `startAt`/`maxResults` until exhausted and report the total (`searchJiraIssuesUsingJql` returns `total`) — **never hard-cap a full-backlog sweep** (F34 — see `aidlc:work-items` → *Full-backlog sweeps*).
- **children(id, filter?)** — JQL `parent = {id} ORDER BY rank ASC` (+ `AND issuetype = Task` /
  `AND status = ...` when filtered); `rank` is the board's own order, which is what the callers want.
  `parent` covers both the subtask link and the modern parent field; on a site that still models epics
  through the legacy **"Epic Link"** custom field, epic children need `"Epic Link" = {id}` instead — take
  which one from the resolved `fieldMap.parent` (*Schema discovery*), not from a guess.
  Map results through the `fetch` field mapping. Apply **no** ready rule and
  **no** priority re-sort. No match ⇒ `[]`, not an error.
- **create(item)** — **resolve the type's createmeta first** (*Schema discovery* tier 2: the AC field's real
  id, and every required field), then create with mapped type/summary/description (AC in the resolved field
  or the description section); set parent/epic link via the resolved `parent` field when given; add the
  `repo:<name>` label (or Component) when `repo` is set, and create "Depends on" issue links for each
  `dependsOn` ID (skip links to not-yet-created siblings and add them once all children exist). Return the
  new key.
- **transition(id, status)** — Jira transitions are by ID, not name: first get available transitions, pick
  the one whose TARGET status matches the **per-type resolved** name (case-insensitive); if none matches,
  apply the documented fallback and comment what happened. Never guess transition IDs. **A transition can
  be screen-gated** — the available-transitions response carries the fields that transition's screen
  requires (a mandatory *Resolution*, *Fix Version*, a custom "Reason"). Read them from that response and
  supply them in the same call; fill from canonical data where the mapping allows, else ask. A transition
  rejected for a missing screen field is not an illegal transition, and treating it as one sends the
  fallback down the wrong path.
- **comment(id, markdown)** — add comment, prefixed `AIDLC:` so pipeline comments are filterable.
- **link(id, {branch, pr})** — Jira's dev panel links automatically when branch/commit messages contain the issue key (they do — `Refs: PROJ-123`). Additionally comment the branch/PR URL so it's visible without the dev panel.
- **updateAC(id, criteria[])** — rewrite the **resolved** AC field, or the description section when
  `fieldMap.acceptanceCriteria` is `null`; comment `AIDLC: acceptance criteria refined (n items)`.

## Cautions

- **Respect the site's required fields on create — proactively.** Read them from createmeta *before* the
  first create (*Schema discovery*), not after a rejection, and report unfillable required fields to the
  user rather than inventing values.
- **Team-managed and company-managed projects have different schemas**, and a site can hold both. Field
  ids, the story-points field's name, the available statuses and whether `priority` exists at all differ
  between them — so probe **the project you are configured for**, and never carry a resolution from one
  project to another.
- Batch reads where the MCP tools allow it. When a `limit` is set, don't over-fetch (stop at ~`limit + 10`); but a **full sweep passes no `limit`** and must page to completion (see the `query` op above) — the cap applies per page, not to the whole backlog.
- All writes are idempotent-by-check: re-read before transition/updateAC to avoid clobbering human edits made mid-run.
- **`currentUser()` is the OAuth identity, not `team.me`.** They are normally the same person, but if
  `team.me` is set and resolves to a different `accountId` than the authenticated account, say so once
  and filter on `team.me` — the config is the deliberate statement. A mismatch usually means a shared
  service account is authenticated, and silently picking up that account's queue is the wrong answer.
