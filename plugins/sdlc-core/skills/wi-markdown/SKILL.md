---
name: wi-markdown
description: Work-item adapter for the local markdown backlog (backlog/ folder). Implements fetch, query, create, transition, comment, link and updateAC over one-file-per-item markdown with YAML frontmatter. Load when workItems.source is "markdown".
user-invocable: false
---

# wi-markdown — local markdown backlog adapter

Implements the `sdlc:work-items` contract over `backlog/`. Pure file operations — cheap, no auth.
Format spec lives in the project's `backlog/README.md`.

## Layout

- Items: `backlog/items/{id}-{slug}.md` · Epics: `backlog/epics/{id}-{slug}.md`
- ID counter: `backlog/.sequence` (single integer)

## Operations

### fetch(id)
Glob `backlog/{items,epics}/{id}-*.md`, parse frontmatter + sections into a WorkItem:
- `acceptanceCriteria` ← the `## Acceptance Criteria` checkbox lines (keep `[x]`/`[ ]` prefixes)
- `description` ← `## Description` body · `links.url` ← the file path

### query(filter)
Glob all item files, parse frontmatter only. Apply filter, drop non-ready items
(ready = `status: todo` AND ≥1 AC (task/spike exempt) AND parent not `blocked` — check parent
files when `parent` is set). Sort by priority (P1 first), then by numeric id ascending. Respect `limit`.

### create(item)
1. Read `backlog/.sequence` → n. Write back n+1 immediately (before creating the file).
2. Id = `{PROJECT_KEY}-{n}` (key from `.claude/sdlc.config.json`).
3. Instantiate `${CLAUDE_PLUGIN_ROOT}/templates/backlog-item.md` with the item's fields,
   slugify the title (lowercase, hyphens, ≤5 words) for the filename.
4. Epics go to `backlog/epics/`, everything else to `backlog/items/`.

### transition(id, status)
Edit the `status:` frontmatter field. Also append an Activity line (see below).
Valid statuses: `todo | in_progress | in_review | done | blocked` — no mapping needed (native).

### comment(id, markdown)
Append to `## Activity` (create the section if missing), one line:
`- {ISO-8601 UTC} [{actor}] {text}` — actor is the pipeline role writing it
(`orchestrator`, `analyst`, `implementer`, `reviewer`, `qa`). Multi-line comments: indent
continuation lines by two spaces. NEVER rewrite existing Activity lines.

### link(id, {branch, pr})
Set the `branch:` / `pr:` frontmatter fields (null → value; overwrite only if changed).

### updateAC(id, criteria[])
Replace the `## Acceptance Criteria` checkbox list. Preserve `[x]` state for criteria whose
text is unchanged; new criteria start `[ ]`. Append an Activity line noting AC were refined.

## Branch visibility (inherent to an in-repo backlog)

Status/AC updates made during a run are committed on the RUN'S branch — the default branch
shows the pre-run state until the PR merges. When reading backlog state, prefer the current
checkout and say which branch you read from if it matters. New items created outside a run
(intake, grooming, humans) are committed straight to the default branch — item creation is
backlog data, not code change, so the never-commit-to-main rule does not apply to it.
(Jira/ADO sources have no such divergence.)

## Concurrency & safety

- Read-modify-write each file in one step; do not cache item state across pipeline phases — re-read before writing.
- If a file's frontmatter is malformed, report the exact file and problem; never guess-fix silently.
- Timestamps: use `date -u +%Y-%m-%dT%H:%MZ` (bash) or `(Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mmZ")` (PowerShell) — never invent times.
