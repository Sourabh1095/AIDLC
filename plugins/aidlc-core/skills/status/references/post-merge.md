# status — post merge

Part of the `aidlc:status` skill, kept apart so the runs that do not need it do not load it. Read when a run is integrated (its PR merged, or `pr: local-merge:<sha>`) and the user confirms cleanup.

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
