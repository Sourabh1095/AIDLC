# Local Markdown Backlog — Format Specification

This folder is the project's work-item tracker when `.claude/aidlc.config.json → workItems.source = "markdown"`.
It is read and written exclusively by the AIDLC pipeline (`wi-markdown` adapter). Humans may add and edit items
freely — but never change `status`, `branch`, or `pr` by hand while a run is active.

## Layout

```
backlog/
├── .sequence          # next numeric ID (single integer, incremented on create)
├── epics/             # one file per epic:  {KEY}-{n}-{slug}.md
└── items/             # one file per story/task/bug/spike: {KEY}-{n}-{slug}.md
```

## Item file format

```markdown
---
id: PROJ-123
type: story            # epic | story | task | bug | spike
title: User can upload an avatar
status: todo           # todo | in_progress | in_review | done | blocked
priority: P2           # P1 (highest) … P4
estimate: M            # S | M | L | XL | null
parent: PROJ-100       # epic ID or null
labels: [frontend, api]
branch: null           # set by pipeline
pr: null               # set by pipeline
---

## Description
As a user, I want to upload an avatar so that my profile feels personal.

## Acceptance Criteria
- [ ] PNG/JPEG up to 5 MB accepted; other formats rejected with a clear error
- [ ] Avatar visible on profile immediately after upload

## Notes
(free-form context, links, screenshots)

## Activity
- 2026-07-08T09:12Z [orchestrator] Run started on feature/PROJ-123-user-avatar-upload
```

## Rules

- **IDs** are `{PROJECT_KEY}-{n}`; `n` comes from `.sequence` (read, use, increment, write back).
- **`## Activity`** is append-only: `- <ISO-8601 UTC> [<actor>] <one line>`.
- **Acceptance criteria** are checkboxes; the pipeline ticks them as they are verified.
- An item is **ready** when: status `todo`, has ≥ 1 acceptance criterion (except spikes/tasks), and its parent (if any) is not `blocked`.
- Epics hold no code work themselves — the pipeline decomposes them into child items.
