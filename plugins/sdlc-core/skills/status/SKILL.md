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
frontmatter (`item`, `type`, `repo`, `branch`, `phase`, `fixCycles`, `pr`, `started`). **Also scan
`runs/archive/*.md` for `phase: done` runs whose PR is not yet merged** — in poly+remote a completed
run is archived on the branch pre-merge (F23), so a done-but-awaiting-merge run lives in `archive/`,
not `runs/`; surface it as "done — PR open (awaiting merge)" so it isn't invisible. Fully
merged+closed archived runs stay out of the active view.

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

## Step 1.6 — Remote-repo gate check (F24 — never leave a remote repo silently ungated)

For each repo entry whose `mode` is `remote`, cheaply check whether an enforced PR gate exists:
CI config present (`.github/workflows/*.yml` for github, `azure-pipelines.yml` for azure-repos) **and**
a required/blocking PR-check policy (GitHub required status check / ADO blocking build-validation on
the default branch — `az repos policy list` / `gh api .../branches/<b>/protection` where reachable).
If a remote repo has neither, warn — "⚠ `<repo>` is `mode: remote` but has no detectable CI /
required-check policy: its PRs merge **ungated**." This is the proactive complement to the ground-truth
reconciliation below; remote mode's promise (CI enforces the gate before merge) is otherwise silently
unmet. Point at `sdlc:ci-cd` + the `sdlc-stack-web/templates/ci/` templates and `/sdlc:init`'s CI offer.

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
- **PR merged but item still open (F22)** — the run's PR is merged (`gh pr view --json state` / `az
  repos pr show`) yet the linked item is still `in_review`/open. ADO doesn't auto-close on merge, so
  this is expected drift, not a fluke → close the item (+ type-aware parent rollup) per *Post-merge
  cleanup* above. This is the detection backstop for the post-merge close.
- **Orphaned originals** — items superseded by a re-decomposition still `New`/`todo` → link to their
  delivering children + move to the type-appropriate terminal (`Removed`/`Closed` + superseded comment).
- **Dropped requirement** — an AC/deliverable in an original not covered by any child and not on disk →
  file a follow-up (or flag for grooming).
- **Tier/parent drift** — an open task hanging off a closed story, a child under the wrong parent.

Apply fixes only on the user's pick; every applied transition is read-back-verified.

## Post-merge cleanup (only when the user confirms)

For any run in phase `done`/`in_review` that is integrated — **remote mode:** its PR is merged
(`gh pr view --json state` / `az repos pr show`); **local mode:** `pr:` is a `local-merge:<sha>`
(the merge already happened at §8, so it's integrated by definition):
1. `adapter.transition(id, done)` and `adapter.comment(id, "PR merged: <url>")` (remote) /
   `adapter.comment(id, "Integrated locally: <sha>")` (local).
2. **Parent rollup (F19/F22).** After closing the item, roll its parent up if all the parent's
   children are now terminal (Feature closed when its last Story lands; Epic closed when its last
   Feature lands) — **type-aware** (an Epic's Completed state name differs from a Story's; `wi-ado`).
   **Never force-close a parent with open siblings** (correctly leave an Epic In Progress while other
   Features remain).
3. Move the run file to `archive/` **in its own location** — `<repo.path>/.sdlc/runs/archive/<ID>.md`
   for a poly per-repo run, else `.sdlc/runs/archive/<ID>.md`. (Poly+remote: the per-repo run file was
   ideally archived **on the branch pre-merge** so it rode into `main` already archived — F23; this
   step is the control-plane / local-mode fallback.)
4. Delete the local feature branch if fully merged (in that repo). In local mode §8 usually deleted
   it already — skip if gone.

**ADO remote mode does NOT auto-close on merge (F22).** Unlike some GitHub setups (a PR body `Closes
#X`, or branch policy configured to transition), linking an ADO work item to a PR does **not**
transition it when the PR merges. So a merged ADO PR leaves its item sitting at `in_review`
indefinitely unless this cleanup runs. Treat the DONE transition + parent rollup as a **required
post-merge step**, not optional tidying — the ground-truth reconciliation below flags "**PR merged but
item still open**" precisely so it isn't missed.
