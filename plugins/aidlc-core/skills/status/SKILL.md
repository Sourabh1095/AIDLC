---
name: status
description: Show the AIDLC dashboard — all active pipeline runs with their phase, branch and PR, plus a snapshot of ready backlog items. Use when the user asks about AIDLC progress, active runs, or what's next.
---

# /aidlc:status — AIDLC dashboard

Render a compact status board for this project.

**Steps 0–4 are read-only** — they query, glob and report, and must never mutate anything. The two
sections *after* them are not: *Ground-truth reconciliation* detects drift read-only but offers fixes,
and *Post-merge cleanup* transitions items, rolls parents up and archives run files. **Both write only
on the user's explicit pick**, and neither runs unattended. Keep the halves separate when you report:
the board is a fact, a proposed fix is a question.

## Step 0 — Control-plane freshness (shared mode only)

Before anything else, one line per `aidlc:work-items` → *Control-plane freshness*: is this workspace's
control plane current with its remote? Everything below reads shared state (`.aidlc/plan.md`, run files,
the markdown backlog if that is the source), and a dashboard rendered from a control plane four commits
behind is confidently wrong rather than usefully stale. Report and continue; never auto-pull.

## Step 1 — Active runs

Build the repo registry (`aidlc:work-items` → *Repos & routing*). Glob run files from **every**
location: the control-plane `.aidlc/runs/*.md` (mono runs + poly epic coordination files) **and**,
in poly, each declared repo's `<repo.path>/.aidlc/runs/*.md`. For each file, read ONLY the
frontmatter (`item`, `type`, `repo`, `package`, `branch`, `phase`, `fixCycles`, `contractAffecting`,
`pr`, `started`). **Also scan
`runs/archive/*.md` for `phase: done` runs whose PR is not yet merged** — in poly+remote a completed
run is archived on the branch pre-merge (F23), so a done-but-awaiting-merge run lives in `archive/`,
not `runs/`; surface it as "done — PR open (awaiting merge)" so it isn't invisible. Fully
merged+closed archived runs stay out of the active view.

Render a table (drop the Repo column in mono; drop the Package column when no repo declares `packages[]`):

| Item | Type | Repo | Package | Phase | Fix cycles | Branch | PR |
|------|------|------|---------|-------|-----------|--------|----|

Ordering: `blocked` first (flag with ⛔), then in-flight phases (start → requirements → design → implement → verify → pr → docs), then `done`.

**Group by package inside a monorepo repo.** Where a repo carries `packages[]`, nest its runs under the
package they resolved to and show a package with no in-flight work as absent rather than empty — the
useful reading is *which parts of the monorepo are being changed right now*, since concurrent runs in
one package are the ones likely to collide. A run whose `package:` is null in a repo that has packages
is worth a one-line flag: it will verify on the repo-wide gate, which may be broader or narrower than
the package's own. Mark `contractAffecting: true` runs with a ⚠ — a PR changing a public contract is
the one a reviewer should not miss in a long list.

The **PR** column shows the PR URL in remote mode; in **local mode** (`git.mode: local`) it shows
`local-merge:<sha>` once integrated, or `ready — local merge pending` for a run parked at
`review-pending`.

For BLOCKED runs, also read the run file's `## Findings` section and summarize the unresolved blockers in one line each.

**Epic rollup (poly):** for each epic coordination file, show its children grouped under it with
each child's repo, phase and PR state, so a cross-repo feature reads as one block.

## Step 1.5 — Tracker doctor (fail clearly, not opaquely)

> This step and Step 1.6 are the two environment checks the dashboard needs in order to be
> *truthful*, so they stay here and this section remains their home. When the answer is "the
> environment is broken" rather than "here is the board", point at **`/aidlc:doctor`** — it runs these
> plus plugin enablement, permission-rule shapes, repo paths, hook scripts and settings parsing, which
> are the faults that make every other reading meaningless.

Before querying the adapter, confirm the tracker is actually **reachable + authenticated**, not merely
"connected". For **ADO**: a registered MCP (`azure-devops · connected · N tools`) does not prove
reachability — it authenticates on the first call and fails opaquely (*"Failed to find api location for
area"*) when the **launch environment** is wrong. Do a cheap probe (e.g. `az account show` +
`echo $ADO_MCP_ORG`, or a 1-item WIQL). If it fails, print the exact remediation and name the root
cause — `ADO_MCP_ORG` set **and** `az login` accessible **in the shell that launched Claude Code**,
relaunch if `az` was installed mid-session (see `wi-ado` → *Connectivity*) — instead of a raw error.
For Jira, a failing probe means re-auth the Atlassian MCP. Report `tracker: reachable` / the
remediation line, then continue (backlog snapshot is skipped if unreachable).

**Reachable is not the same as understood.** The first adapter call of the session also resolves the
board's real fields and states (`aidlc:work-items` → *Schema discovery*) — so if the probe corrects
anything in `workItems.<source>.statusMap`/`.fieldMap`, say so in one line here rather than leaving the
dashboard to imply the config was authoritative. A status board built on a stale field id is exactly the
kind of confident wrongness the ground-truth reconciliation below exists to catch.

## Step 1.6 — Remote-repo gate check (F24 — never leave a remote repo silently ungated)

For each repo entry whose `mode` is `remote`, cheaply check whether an enforced PR gate exists:
CI config present (`.github/workflows/*.yml` for github, `azure-pipelines.yml` for azure-repos) **and**
a required/blocking PR-check policy (GitHub required status check / ADO blocking build-validation on
the default branch — `az repos policy list` / `gh api .../branches/<b>/protection` where reachable).
If a remote repo has neither, warn — "⚠ `<repo>` is `mode: remote` but has no detectable CI /
required-check policy: its PRs merge **ungated**." This is the proactive complement to the ground-truth
reconciliation below; remote mode's promise (CI enforces the gate before merge) is otherwise silently
unmet. Point at `aidlc:ci-cd` (and `aidlc-stack-web:ci-web` + the `aidlc-stack-web/templates/ci/`
templates on a Node/TS repo) and `/aidlc:init`'s CI offer.

## Step 1.7 — Execution plan (when `.aidlc/plan.md` exists)

The control-plane `.aidlc/plan.md` is the active wave schedule (`aidlc:replan`) and it is what
`/aidlc:next` and `/aidlc:sprint` will actually follow — so a dashboard that omits it is showing the
board's order, not the pipeline's. Read its frontmatter (`plan`, `driver`, `schedule`, `waves`,
`fingerprint`) and render two lines plus the wave the project is on:

```
Plan (2026-07-31, cut by priya@acme.com, "client wants checkout live before search"):  wave 2 of 4
  w0[PROJ-101]* -> w1[PROJ-102|PROJ-110] -> w2[PROJ-103|PROJ-104] -> w3[PROJ-120]
  held: PROJ-111 (blocked) · PROJ-112 (unrouted)
```

Show `cutBy:` in shared mode — a plan you did not cut, on a control plane that is behind (Step 0), is
the case where "the pipeline picked a strange item" has an answer nobody would otherwise find.

The current wave is the earliest one with open items. Then run the freshness check against the items
from Step 2 —

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/replan/resolve-waves.mjs" --freshness <plan-snapshot.json> <items-now.json>
```

— and report the class, because it decides what the other commands
will do: **none** (silent), **additive** → `plan is additively stale: 3 new items unscheduled`,
**breaking** → `⚠ plan is stale (PROJ-127 was re-decomposed) — next/sprint will ignore it and fall
back to priority order · /aidlc:replan`. This is read-only like the rest of `status`; it never re-cuts
a plan.

## Step 2 — Backlog snapshot

Load the `work-items` skill routing and query the active adapter (from `.claude/aidlc.config.json`) for:
- count of items by status
- top 5 ready items (status `todo`, priority order): show `id`, `type`, `priority`, `estimate`, `title`

**In shared mode, show ownership and split the "ready" count** — `ready: 11 (3 yours, 5 assigned to
others, 3 unassigned)` — and add an `Owner` column to the ready list. `/aidlc:next` will only pick from
your scope (`aidlc:next` §2·0), so a dashboard that reports one number answers a question the pipeline
does not act on. Also surface **items assigned to you that are already `in_progress` with no local run
file**: that is either work you started elsewhere or an item someone assigned you mid-flight, and both
are worth a line.

The active-runs table above is still **your machine only** — run files live on feature branches in each
developer's clone, so this dashboard cannot show what the team is running. Say so once in shared mode
rather than letting an empty table read as an idle team; the board's `in_progress` count is the honest
cross-machine signal and it is right there in the status counts.

If the source is `markdown`, this is just frontmatter parsing over `backlog/items/*.md` — do not spawn a subagent for this.

**Then journal the snapshot** (`aidlc:journal`, kind `board`). This step is the only place in the
framework that reliably has a fresh board reading, and the SessionStart hook cannot get one for itself
— it is a hook, with no tools and no network budget. So without this line every Jira and ADO project
opens a session with no sense of its backlog at all, which is most team projects:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/journal/journal.mjs" append <workspace-root> board \
  "<n> todo · <n> in progress · next <ID> (<priority>, <type>) <title>"
```

Write it only on a **successful** query — a snapshot recorded from a failed or unreachable tracker is
worse than none, because it carries a timestamp that makes it look current. Skip it silently when
Step 1.5 reported the tracker unreachable.

## Step 3 — Local extensions (when `.aidlc/extensions.json` has entries)

One line per noteworthy entry:
- `promotion: candidate` with `reuseCount >= 2` → "promotion-ready: <name> (used <n>×) — `/aidlc:promote <name>`"
- `promotion: pr-open` → show the PR URL and its state if cheaply checkable.
- Count of `local-only` extensions (no action needed).

## Step 4 — Suggestions

End with one actionable line, e.g.:
- runs blocked → "PROJ-123 is blocked at verify (2 unresolved findings) — review `.aidlc/runs/PROJ-123.md`"
- no active runs, ready items exist → "Run `/aidlc:next` to start PROJ-124 (P1, story)." — or, with a
  fresh plan, name the wave: "Wave 2 is ready (PROJ-103 ‖ PROJ-104) — `/aidlc:sprint`."
- a plan with **breaking** drift → "`.aidlc/plan.md` is stale (PROJ-127 re-decomposed) — `/aidlc:replan`"
- done runs with merged PRs → "PROJ-120's PR merged — run cleanup: transition item to Done and archive the run file."
- **a done/`in_review` run whose PR has unresolved review threads** → "PROJ-124's PR has 6 unresolved
  comments from @priya — `/aidlc:review-feedback PROJ-124`". Worth a cheap check on any open PR this
  pipeline opened (`gh pr view --json reviewDecision` / the ADO thread count), because the run file says
  `done` and nothing else in this dashboard would reveal that the change is waiting on the author, not
  on the reviewer. **`changes_requested` with no local activity is the most actionable line on the
  board** — surface it above the ready-items suggestion.

## Ground-truth reconciliation (drift detection — the audit, automated)

The run file and the board can silently diverge (a write that reported success but never persisted —
`aidlc:work-items` → *Write verification*; or a re-decomposition that orphaned its originals —
*Re-decomposition & supersession*). Reconcile **tracker state against what was actually built**, and
report drift. Run this as part of `/aidlc:status`, and always **at epic/story close** (the orchestrator
calls it before declaring an epic done). Read-only unless the user confirms a fix.

For each epic/story with a run file or recent activity, cross-check three sources:
1. **Board** — `fetch`/batch the item + its children: state, parent links, AC.
2. **Run files** — `.aidlc/runs/*.md` (+ per-repo, + archive): the phase/outcome the pipeline recorded.
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
  Where the story's run bound its plan to that Task (`wi:` — `aidlc:work-items` → *The Task tier*), the
  open Task means an **unticked plan line**: read the run file's `## Plan` and say which, because the
  two readings need opposite fixes. *Descoped* → retire the Task. *Never done* → it is a **dropped
  requirement**, and the story closed over it. Never offer "close the Task" as the tidy-up without
  naming which one it is — that would erase the only signal distinguishing them.

Apply fixes only on the user's pick; every applied transition is read-back-verified.

## Post-merge cleanup (only when the user confirms)

For any run in phase `done`/`in_review` that is integrated — **remote mode:** its PR is merged
(`gh pr view --json state` / `az repos pr show`); **local mode:** `pr:` is a `local-merge:<sha>`
(the merge already happened at §8, so it's integrated by definition):

**Poly+remote costs one archive PR per repo — warn first (F39).** Archiving in poly+remote is not a
free in-place move: each run file lives in its own repo, and a commit there reaches the default branch
only through the gate — i.e. **one `chore(aidlc): archive` branch → PR per repo**. Before starting a
batch, count the run files needing archival and state the cost to the user ("N run files across M repos
→ M PRs"). Prefer that each run was already archived on its delivering PR pre-merge (F23, `aidlc:run`
§10), so this batch path stays the exception. Each archive commit is `.aidlc/**`-only → commit it
`--no-verify` (husky can't block bookkeeping) and confirm it landed before pushing — the empty-branch
trap (`aidlc:git-workflow` → bookkeeping commits).

1. `adapter.transition(id, done)` and `adapter.comment(id, "PR merged: <url>")` (remote) /
   `adapter.comment(id, "Integrated locally: <sha>")` (local).
2. **Parent rollup (F19/F22).** After closing the item, roll its parent up if all the parent's
   children are now terminal (Feature closed when its last Story lands; Epic closed when its last
   Feature lands) — **type-aware** (an Epic's Completed state name differs from a Story's; `wi-ado`).
   **Never force-close a parent with open siblings** (correctly leave an Epic In Progress while other
   Features remain).
3. Move the run file to `archive/` **in its own location** — `<repo.path>/.aidlc/runs/archive/<ID>.md`
   for a poly per-repo run, else `.aidlc/runs/archive/<ID>.md` — following `aidlc:run-state` →
   *Archive*, which owns where and how. This step is the **fallback path**: a poly+remote run should
   already have archived on its branch pre-merge (F23), so reaching here means it didn't, and remote
   mode then costs a `chore(aidlc): archive` branch → PR rather than a direct push to the protected
   branch. Local mode is the normal path here and a local commit is fine — the user confirmed the
   merge at §8.
4. Delete the local feature branch if fully merged (in that repo). In local mode §8 usually deleted
   it already — skip if gone.

**ADO remote mode does NOT auto-close on merge (F22).** Unlike some GitHub setups (a PR body `Closes
#X`, or branch policy configured to transition), linking an ADO work item to a PR does **not**
transition it when the PR merges. So a merged ADO PR leaves its item sitting at `in_review`
indefinitely unless this cleanup runs. Treat the DONE transition + parent rollup as a **required
post-merge step**, not optional tidying — the ground-truth reconciliation below flags "**PR merged but
item still open**" precisely so it isn't missed.
