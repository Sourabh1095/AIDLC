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
  "repo": "string | null",
  "dependsOn": ["PROJ-101"],
  "labels": ["string"],
  "assignee": "string | null",
  "links": { "url": "source URL or file path", "branch": "string | null", "pr": "string | null" },
  "sourceRaw": { "note": "adapter-private fields (e.g. ADO numeric id, Jira issue key)" }
}
```

- `repo` — the git repo (by `repos[].name`) this item is delivered in. `null` for epics (they span
  repos via their children) and for unrouted items (the orchestrator resolves it — see below). In
  **mono** it is always the single repo and can be left `null`.
- `dependsOn` — other item IDs that must land first. Used to sequence a cross-repo epic's children
  (e.g. the frontend story `dependsOn` the backend story). Empty by default.
- `links.branch` / `links.pr` stay **singular** — one run = one repo = one branch = one PR. An epic's
  PRs live on its children; the epic aggregates them.

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

## Repos & routing (mono and poly)

The pipeline operates on **repo entries**, never on a hardcoded "the repo". Build the registry from
`.claude/sdlc.config.json` once at the start of any command that touches git:

- **`repos[]` is non-empty → poly.** Each entry is a repo (`name`, `path`, `host`, `remote`,
  `defaultBranch`, `branchPattern`, `stack`, `labels`, optional `ux`, optional `default`). The config
  itself lives at the **workspace root** (the control plane: `.claude/`, `backlog/`, `.sdlc/`); repo
  paths are resolved under `workspace.root` (default `.`).
- **`repos[]` empty/absent → mono.** Synthesize ONE repo entry from the top-level `git` + `stack` +
  `ux` blocks: `{ name: project.key-lowercased, path: ".", default: true, host: git.host,
  remote: git.remote, defaultBranch: git.defaultBranch, branchPattern: git.branchPattern, stack, ux }`.
  Mono is just a one-entry registry, so everything downstream shares one code path.

**Item → repo resolution chain** (stop at the first that resolves; record the result on the run file's
`repo:` and, when writeable, on the item via `link`):
1. **Explicit** — the item's `repo` field is set to a known `repos[].name`.
2. **Label** — any of the item's `labels` matches a repo's `labels`. If several repos match, don't
   guess — fall through to grounding/ask.
3. **Single default** — exactly one repo is plausible (only one repo declared, or exactly one has
   `default: true`).
4. **Ground** — the orchestrator/analyst reads the candidate repos (their `role`, stack and the code
   the item describes) and picks the repo the change belongs in; log the reasoning as an assumption.
5. **Ask** — still ambiguous → ask the user, listing the declared repos.

Epics are never routed to a single repo; they **fan out** to one child per affected repo (each child
routed by this chain), with `dependsOn` sequencing. See `sdlc:run` §2.

## Rules

- The **run file** (see `sdlc:run-state`) is the internal machine state; adapter comments are the
  external human-visible signal. Write both at phase milestones; on conflict the run file wins.
- Comment style: short, factual, timestamped by the tracker itself. E.g.
  `SDLC: implementation complete on feature/PROJ-123-avatar-upload (4 commits). Entering verify.`
- Never invent status values — if a source workflow lacks a state (e.g. no `in_review`), use the
  adapter's documented closest mapping.
