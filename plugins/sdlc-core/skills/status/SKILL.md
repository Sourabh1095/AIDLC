---
name: status
description: Show the SDLC dashboard — all active pipeline runs with their phase, branch and PR, plus a snapshot of ready backlog items. Use when the user asks about SDLC progress, active runs, or what's next.
---

# /sdlc:status — SDLC dashboard

Render a compact status board for this project. Read-only — never mutate state here.

## Step 1 — Active runs

Glob `.sdlc/runs/*.md`. For each file, read ONLY the frontmatter (`item`, `type`, `branch`, `phase`, `fixCycles`, `pr`, `started`).

Render a table:

| Item | Type | Phase | Fix cycles | Branch | PR |
|------|------|-------|-----------|--------|----|

Ordering: `blocked` first (flag with ⛔), then in-flight phases (start → requirements → design → implement → verify → pr → docs), then `done`.

For BLOCKED runs, also read the run file's `## Findings` section and summarize the unresolved blockers in one line each.

## Step 2 — Backlog snapshot

Load the `work-items` skill routing and query the active adapter (from `.claude/sdlc.config.json`) for:
- count of items by status
- top 5 ready items (status `todo`, priority order): show `id`, `type`, `priority`, `estimate`, `title`

If the source is `markdown`, this is just frontmatter parsing over `backlog/items/*.md` — do not spawn a subagent for this.

## Step 3 — Local extensions (when `.sdlc/extensions.json` has entries)

One line per noteworthy entry:
- `promotion: candidate` with `reuseCount >= 2` → "promotion-ready: <name> (used <n>×) — `/sdlc:promote <name>`"
- `promotion: pr-open` → show the PR URL and its state if cheaply checkable.
- Count of `local-only` extensions (no action needed).

## Step 4 — Suggestions

End with one actionable line, e.g.:
- runs blocked → "PROJ-123 is blocked at verify (2 unresolved findings) — review `.sdlc/runs/PROJ-123.md`"
- no active runs, ready items exist → "Run `/sdlc:next` to start PROJ-124 (P1, story)."
- done runs with merged PRs → "PROJ-120's PR merged — run cleanup: transition item to Done and archive the run file."

## Post-merge cleanup (only when the user confirms)

For any run in phase `done` whose PR is merged (`gh pr view --json state` / `az repos pr show`):
1. `adapter.transition(id, done)` and `adapter.comment(id, "PR merged: <url>")`.
2. Move `.sdlc/runs/<ID>.md` to `.sdlc/runs/archive/<ID>.md`.
3. Delete the local feature branch if fully merged.
