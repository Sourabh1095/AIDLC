---
name: wi-jira
description: Work-item adapter for Jira via the Atlassian MCP server. Implements fetch, query, children, create, transition, comment, link and updateAC over Jira issues using JQL and the project's status map. Load when workItems.source is "jira".
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

## Status map

Canonical → Jira defaults (override per project in `workItems.jira.statusMap`):

| canonical | Jira status |
|---|---|
| todo | To Do |
| in_progress | In Progress |
| in_review | In Review (fallback: In Progress + comment) |
| done | Done |
| blocked | Blocked (fallback: keep current status, add label `blocked` + comment) |

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
  through the legacy **"Epic Link"** custom field, epic children need `"Epic Link" = {id}` instead —
  detect which convention the project uses from an existing issue rather than assuming, the same way
  the AC field is detected. Map results through the `fetch` field mapping. Apply **no** ready rule and
  **no** priority re-sort. No match ⇒ `[]`, not an error.
- **create(item)** — create with mapped type/summary/description (AC embedded per the project's detected convention); set parent/epic link when given; add the `repo:<name>` label (or Component) when `repo` is set, and create "Depends on" issue links for each `dependsOn` ID (skip links to not-yet-created siblings and add them once all children exist). Return the new key.
- **transition(id, status)** — Jira transitions are by ID, not name: first get available transitions, pick the one whose TARGET status matches the mapped name (case-insensitive); if none matches, apply the documented fallback and comment what happened. Never guess transition IDs.
- **comment(id, markdown)** — add comment, prefixed `AIDLC:` so pipeline comments are filterable.
- **link(id, {branch, pr})** — Jira's dev panel links automatically when branch/commit messages contain the issue key (they do — `Refs: PROJ-123`). Additionally comment the branch/PR URL so it's visible without the dev panel.
- **updateAC(id, criteria[])** — rewrite the AC field/section per the detected convention; comment `AIDLC: acceptance criteria refined (n items)`.

## Cautions

- Respect the site's required fields on create (fetch createmeta if creation fails; report unfillable required fields to the user rather than inventing values).
- Batch reads where the MCP tools allow it. When a `limit` is set, don't over-fetch (stop at ~`limit + 10`); but a **full sweep passes no `limit`** and must page to completion (see the `query` op above) — the cap applies per page, not to the whole backlog.
- All writes are idempotent-by-check: re-read before transition/updateAC to avoid clobbering human edits made mid-run.
- **`currentUser()` is the OAuth identity, not `team.me`.** They are normally the same person, but if
  `team.me` is set and resolves to a different `accountId` than the authenticated account, say so once
  and filter on `team.me` — the config is the deliberate statement. A mismatch usually means a shared
  service account is authenticated, and silently picking up that account's queue is the wrong answer.
