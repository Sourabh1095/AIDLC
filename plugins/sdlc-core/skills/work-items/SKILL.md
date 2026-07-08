---
name: work-items
description: The canonical WorkItem schema, adapter operation contract, and source routing for the SDLC pipeline. Load whenever you need to read or update epics, stories, tasks, bugs or spikes from any tracker (Jira, Azure DevOps, or the local markdown backlog).
user-invocable: false
---

# Work Items — schema, contract, routing

The SDLC pipeline never talks to a tracker directly. It speaks ONE schema and ONE operation
contract; a per-source adapter skill implements them. This is what makes trackers pluggable.

## Routing

1. Read `.claude/sdlc.config.json` → `workItems.source`.
2. Load exactly one adapter skill:
   - `markdown` → `sdlc:wi-markdown`
   - `jira` → `sdlc:wi-jira` (Atlassian MCP; OAuth on first use)
   - `ado` → `sdlc:wi-ado` (ADO MCP or `az boards` CLI)
3. Perform all operations through that adapter for the rest of the session.

## Canonical WorkItem schema

Every adapter normalizes to and from this shape:

```json
{
  "id": "PROJ-123",
  "source": "jira | ado | markdown",
  "type": "epic | story | task | bug | spike",
  "title": "string",
  "description": "markdown string",
  "acceptanceCriteria": ["string (checkbox state noted as [x]/[ ] prefix)"],
  "status": "todo | in_progress | in_review | done | blocked",
  "priority": "P1 | P2 | P3 | P4",
  "estimate": "S | M | L | XL | null",
  "parent": "PROJ-100 | null",
  "labels": ["string"],
  "assignee": "string | null",
  "links": { "url": "source URL or file path", "branch": "string | null", "pr": "string | null" },
  "sourceRaw": { "note": "adapter-private fields (e.g. ADO numeric id, Jira issue key)" }
}
```

## Adapter operation contract (all seven, always)

| Operation | Semantics |
|---|---|
| `fetch(id)` | One item → WorkItem. Error clearly if not found. |
| `query(filter)` | Ready items by priority. filter = `{status?, type?, label?, limit?}`. "Ready" = status `todo`, has ≥1 AC (except task/spike), parent not blocked. |
| `create(item)` | Create a new item (epic decomposition, spike creation). Returns assigned id. |
| `transition(id, status)` | Map canonical status → source workflow state. Each adapter documents its state map; project overrides live in config `statusMap`. |
| `comment(id, markdown)` | Append a progress milestone comment (external progress signal for humans). |
| `link(id, {branch?, pr?})` | Attach branch/PR references to the item. |
| `updateAC(id, criteria[])` | Write refined acceptance criteria back to the item. |

## Rules

- The **run file** (see `sdlc:run-state`) is the internal machine state; adapter comments are the
  external human-visible signal. Write both at phase milestones; on conflict the run file wins.
- Comment style: short, factual, timestamped by the tracker itself. E.g.
  `SDLC: implementation complete on feature/PROJ-123-avatar-upload (4 commits). Entering verify.`
- Never invent status values — if a source workflow lacks a state (e.g. no `in_review`), use the
  adapter's documented closest mapping.
