---
name: run-state
description: The SDLC run-file format and checkpoint/resume protocol. A run file (.sdlc/runs/<ID>.md) is the durable, resumable state of one pipeline run. Load whenever creating, updating, resuming or archiving a pipeline run.
user-invocable: false
---

# Run state — durable pipeline memory

One run = one work item flowing through the pipeline = one file: `.sdlc/runs/{ID}.md`.
It is committed to the feature branch, so the PR carries a full audit trail of what the
pipeline did, assumed, found and fixed.

## Format (template: `${CLAUDE_PLUGIN_ROOT}/templates/run-file.md`)

```markdown
---
item: PROJ-123
source: markdown
type: story
branch: feature/PROJ-123-user-avatar-upload
phase: implement       # start|requirements|design|implement|verify|pr|docs|done|blocked
fixCycles: 0
pr: null
started: 2026-07-08T09:12Z
updated: 2026-07-08T10:03Z
---
## Item snapshot
(normalized WorkItem as fetched — JSON in a fenced block)

## Assumptions
(one bullet per assumption the pipeline made; mirrored to work-item comments)

## Plan
(ordered checkbox list of implementation tasks)
- [x] 1. Add avatar column migration
- [ ] 2. Upload endpoint

## Findings
(reviewer/qa findings; each with severity, status)
- [BLOCKER][resolved] reviewer: upload endpoint missing file-type validation
- [MINOR][open] qa: no test for 5MB boundary

## Log
(append-only, one line per phase transition or agent completion)
- 2026-07-08T09:12Z phase start → requirements
- 2026-07-08T09:20Z analyst: AC refined (2 assumptions logged)
```

## Protocol

**Create** — at run start, from the template. Frontmatter first, then sections in the order above.

**Checkpoint** — update the run file:
- on EVERY phase transition (`phase:` + `updated:` + a Log line) — before starting the next phase;
- after every subagent completes (its section content + a Log line);
- whenever an assumption is made or a finding is raised/resolved.

**Resume** — if `/sdlc:run <ID>` finds an existing run file:
1. Read frontmatter → jump to the recorded `phase`. Never redo completed phases.
2. Verify the branch exists and is checked out (`git rev-parse --abbrev-ref HEAD`); if not, check it out.
3. If phase is `blocked`: report the open Findings and ask the user how to proceed
   (retry fix cycle / adjust item / abandon) — this is the one place resume pauses.
4. If phase is `done`: nothing to do; suggest `/sdlc:status` for post-merge cleanup.

**Subagent contract** — every agent brief must include: the run-file path, which section(s) the
agent appends to, and the instruction to return only a short verdict + pointer to what it wrote.
Agents append; they never rewrite other sections.

**Scope changes** — the item snapshot is versioned, never overwritten: re-fetches that differ
append `### Snapshot v2/v3 … (re-fetched <UTC>)` sections. Plan tasks affected by a scope
change are marked `[needs-rework]` or struck through `~~…~~ (descoped)` — history stays
readable; completed work that still stands is never redone. (Reconciliation itself is the
orchestrator's job — see `sdlc:run` §1.)

**Archive** — after PR merge + item transitioned to done, move the file to `.sdlc/runs/archive/`.

## Invariants

- `Log` and `Findings` are append-only (findings flip `[open]`→`[resolved]` in place).
- One run file per item; a re-run after archive starts a fresh file.
- Timestamps from the system clock (`date -u` / `Get-Date`), never invented.
