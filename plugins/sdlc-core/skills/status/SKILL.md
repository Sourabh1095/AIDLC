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

## Step 1.5 — Tracker doctor (fail clearly, not opaquely)

Before querying the adapter, confirm the tracker is actually **reachable + authenticated**, not merely
"connected". For **ADO**: a registered MCP (`azure-devops · connected · N tools`) does not prove
reachability — it authenticates on the first call and fails opaquely (*"Failed to find api location for
area"*) when the **launch environment** is wrong. Do a cheap probe (e.g. `az account show` +
`echo $ADO_MCP_ORG`, or a 1-item WIQL). If it fails, print the exact remediation and name the root
cause — `ADO_MCP_ORG` set **and** `az login` accessible **in the shell that launched Claude Code**,
relaunch if `az` was installed mid-session (see `wi-ado` → *Connectivity*) — instead of a raw error.
For Jira, a failing probe means re-auth the Atlassian MCP. Report `tracker: reachable` / the
remediation line, then continue (backlog snapshot is skipped if unreachable).

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

## Ground-truth reconciliation (drift detection — the audit, automated)

The run file and the board can silently diverge (a write that reported success but never persisted —
`sdlc:work-items` → *Write verification*; or a re-decomposition that orphaned its originals —
*Re-decomposition & supersession*). Reconcile **tracker state against what was actually built**, and
report drift. Run this as part of `/sdlc:status`, and always **at epic/story close** (the orchestrator
calls it before declaring an epic done). Read-only unless the user confirms a fix.

For each epic/story with a run file or recent activity, cross-check three sources:
1. **Board** — `fetch`/batch the item + its children: state, parent links, AC.
2. **Run files** — `.sdlc/runs/*.md` (+ per-repo, + archive): the phase/outcome the pipeline recorded.
3. **Disk + git** — does the deliverable actually exist? (files present, commits on the default branch,
   scaffold/config in the repo). A "Closed" item with nothing on disk is drift; a "New" item that's
   verifiably built is drift.

Report drift as a short list, each with the proposed reconciliation (do NOT mutate without confirm):
- **Status drift** — run file says done/closed but board shows otherwise (or vice-versa) → re-assert the
  transition (with write-verification) or correct the record.
- **Orphaned originals** — items superseded by a re-decomposition still `New`/`todo` → link to their
  delivering children + move to the type-appropriate terminal (`Removed`/`Closed` + superseded comment).
- **Dropped requirement** — an AC/deliverable in an original not covered by any child and not on disk →
  file a follow-up (or flag for grooming).
- **Tier/parent drift** — an open task hanging off a closed story, a child under the wrong parent.

Apply fixes only on the user's pick; every applied transition is read-back-verified.

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
