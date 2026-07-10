---
name: status
description: Show the SDLC dashboard — all active pipeline runs with their phase, branch and PR, plus a snapshot of ready backlog items. Use when the user asks about SDLC progress, active runs, or what's next.
---

# /sdlc:status — SDLC dashboard

Render a compact status board for this project. Read-only — never mutate state here.

## Step 1 — Active runs

Build the repo registry (`sdlc:work-items` → *Repos & routing*). Glob run files from **every**
location: the control-plane `.sdlc/runs/*.md` (mono runs + poly epic coordination files) **and**,
in poly, each declared repo's `<repo.path>/.sdlc/runs/*.md`. For each file, read ONLY the
frontmatter (`item`, `type`, `repo`, `branch`, `phase`, `fixCycles`, `pr`, `started`).

Render a table (drop the Repo column in mono):

| Item | Type | Repo | Phase | Fix cycles | Branch | PR |
|------|------|------|-------|-----------|--------|----|

Ordering: `blocked` first (flag with ⛔), then in-flight phases (start → requirements → design → implement → verify → pr → docs), then `done`.

The **PR** column shows the PR URL in remote mode; in **local mode** (`git.mode: local`) it shows
`local-merge:<sha>` once integrated, or `ready — local merge pending` for a run parked at
`review-pending`.

For BLOCKED runs, also read the run file's `## Findings` section and summarize the unresolved blockers in one line each.

**Epic rollup (poly):** for each epic coordination file, show its children grouped under it with
each child's repo, phase and PR state, so a cross-repo feature reads as one block.

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

For any run in phase `done` that is integrated — **remote mode:** its PR is merged
(`gh pr view --json state` / `az repos pr show`); **local mode:** `pr:` is a `local-merge:<sha>`
(the merge already happened at §8, so it's integrated by definition):
1. `adapter.transition(id, done)` and `adapter.comment(id, "PR merged: <url>")` (remote) /
   `adapter.comment(id, "Integrated locally: <sha>")` (local).
2. Move the run file to `archive/` **in its own location** — `<repo.path>/.sdlc/runs/archive/<ID>.md`
   for a poly per-repo run, else `.sdlc/runs/archive/<ID>.md`.
3. Delete the local feature branch if fully merged (in that repo). In local mode §8 usually deleted
   it already — skip if gone.
