---
name: wi-jira
description: Work-item adapter for Jira via the Atlassian MCP server. Implements fetch, query, create, transition, comment, link and updateAC over Jira issues using JQL and the project's status map. Load when workItems.source is "jira".
user-invocable: false
---

# wi-jira — Jira adapter (Atlassian MCP)

Implements the `sdlc:work-items` contract over Jira. Requires the `atlassian` MCP server
(bundled; user authenticates via OAuth on first use). Config: `.claude/sdlc.config.json →
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
| `labels` / `assignee` | labels / assignee displayName |
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
  (+ `AND labels = {label}` when filtered). Apply the "ready" rule (≥1 AC except task/spike; parent not blocked) client-side after mapping. Respect `limit`.
- **create(item)** — create with mapped type/summary/description (AC embedded per the project's detected convention); set parent/epic link when given. Return the new key.
- **transition(id, status)** — Jira transitions are by ID, not name: first get available transitions, pick the one whose TARGET status matches the mapped name (case-insensitive); if none matches, apply the documented fallback and comment what happened. Never guess transition IDs.
- **comment(id, markdown)** — add comment, prefixed `SDLC:` so pipeline comments are filterable.
- **link(id, {branch, pr})** — Jira's dev panel links automatically when branch/commit messages contain the issue key (they do — `Refs: PROJ-123`). Additionally comment the branch/PR URL so it's visible without the dev panel.
- **updateAC(id, criteria[])** — rewrite the AC field/section per the detected convention; comment `SDLC: acceptance criteria refined (n items)`.

## Cautions

- Respect the site's required fields on create (fetch createmeta if creation fails; report unfillable required fields to the user rather than inventing values).
- Batch reads where the MCP tools allow it; never page through more than `limit + 10` issues for a query.
- All writes are idempotent-by-check: re-read before transition/updateAC to avoid clobbering human edits made mid-run.
