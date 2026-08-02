---
name: run-state
description: The AIDLC run-file format and checkpoint/resume protocol. A run file (.aidlc/runs/<ID>.md) is the durable, resumable state of one pipeline run. Load whenever creating, updating, resuming or archiving a pipeline run.
user-invocable: false
---

# Run state — durable pipeline memory

One run = one work item flowing through the pipeline = one file: `.aidlc/runs/{ID}.md`.
It is committed to the feature branch, so the PR carries a full audit trail of what the
pipeline did, assumed, found and fixed.

**Location (mono vs poly).** In mono the run file is `.aidlc/runs/{ID}.md` at the repo root. In
poly a per-item run file lives in ITS target repo at `<repo.path>/.aidlc/runs/{ID}.md` (still
committed to that repo's branch — the PR trail is preserved), and its frontmatter carries `repo:`.
An **epic coordination file** (cross-repo feature) lives at the **control plane**
`.aidlc/runs/{EPIC-ID}.md` with `repo: null`; it tracks child IDs, their repos, `dependsOn` order and
a status rollup, and is NOT committed to any product branch. `/aidlc:status` aggregates both places.

## Format (template: `${CLAUDE_PLUGIN_ROOT}/templates/run-file.md`)

```markdown
---
item: PROJ-123
source: markdown
type: story
branch: feature/PROJ-123-user-avatar-upload
phase: implement       # start|requirements|design|implement|verify|pr|docs|done|blocked
fixCycles: 0
reviewRounds: 0        # human PR-feedback rounds (aidlc:review-feedback) — its own budget, not fixCycles'
fanout: 1 -> [2|3|4] -> 5   # the implement schedule actually used; null when all-serial
pr: null
started: 2026-07-08T09:12Z
updated: 2026-07-08T10:03Z
---
## Item snapshot
(normalized WorkItem as fetched — JSON in a fenced block)

## Assumptions
(one bullet per assumption the pipeline made; mirrored to work-item comments)

## Plan
(ordered checkbox list of implementation tasks, each declaring the paths it touches — `aidlc:run` §6
reads these to schedule concurrent implementers, so an undeclared task is always run serially)
- [x] 1. Add avatar column migration  ·  paths: db/migrations/0007_avatar.sql  ·  foundation: true
- [ ] 2. Upload endpoint  ·  paths: src/api/avatar.ts, src/api/avatar.test.ts

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

**Resume** — if `/aidlc:run <ID>` finds an existing run file:
1. Read frontmatter → jump to the recorded `phase`. Never redo completed phases.
2. Verify the branch exists and is checked out (`git rev-parse --abbrev-ref HEAD`); if not, check it out.
3. If phase is `blocked`: report the open Findings and ask the user how to proceed
   (retry fix cycle / adjust item / abandon) — this is the one place resume pauses.
4. If phase is `done`, **the PR decides what happens next — do not answer "nothing to do" without
   looking.** In remote mode a `done` run is a run awaiting a human, and that human may already have
   replied:
   - **PR merged** → post-merge cleanup (`/aidlc:status`): transition, parent rollup, archive.
   - **PR open with unresolved review threads** → hand to `aidlc:review-feedback` with this ID. This is
     the common case on a team and the reason this step is not a one-liner: a run that reports
     "nothing to do" while six review comments sit on its PR is wrong in the most useless possible way.
     That skill is **`disable-model-invocation`** (it commits and pushes), so the Skill tool cannot
     reach it — **read `${CLAUDE_PLUGIN_ROOT}/skills/review-feedback/SKILL.md` and follow it verbatim**
     with this ID as its `$ARGUMENTS`, exactly as `/aidlc:next` hands off to `run`. The user asked to
     resume this run, so the handoff is explicit; don't stop and make them re-type a command.
   - **PR open, no threads** → nothing to do; say it is awaiting review and name
     `/aidlc:review-feedback` for when comments arrive.
   - **`mode: local`** → integration already happened at `/aidlc:run` §8; suggest `/aidlc:status` cleanup.

**Subagent contract** — every agent brief must include: the run-file path, which section(s) the
agent appends to, and the instruction to return only a short verdict + pointer to what it wrote.
Agents append; they never rewrite other sections.

**Scope changes** — the item snapshot is versioned, never overwritten: re-fetches that differ
append `### Snapshot v2/v3 … (re-fetched <UTC>)` sections. Plan tasks affected by a scope
change are marked `[needs-rework]` or struck through `~~…~~ (descoped)` — history stays
readable; completed work that still stands is never redone. (Reconciliation itself is the
orchestrator's job — see `aidlc:run` §1.)

**Archive** — move the completed run file to `…/runs/archive/{ID}.md`. **Where + when depends on
mode/layout (F23):**
- **Poly + remote** — the per-repo run file merges into `main` via the PR, so archive it **on the
  feature branch as the run's final commit** (`git mv` → `runs/archive/`, `chore(aidlc): archive run
  {ID}`, pushed to the open PR) so it rides into `main` **already archived**. Archiving after merge
  would require a forbidden direct-to-`main` commit — that's the trap this avoids. `/aidlc:run` §10
  owns this step.
- **Local mode** — the branch is merged in-session (`/aidlc:run` §8), so archive via `/aidlc:status`
  post-merge cleanup. A **local commit** on the default branch is acceptable here — the user already
  confirmed the merge, and the protected-branch guard is a *push* guard, so a commit that is never
  pushed doesn't trip it. (Remote is different — see *Remote post-merge fallback* below.)
- **Control-plane** — the epic coordination file isn't on any product branch; archive it at the
  control plane `.aidlc/runs/archive/`.
- **Remote post-merge fallback (F36/F39).** If a remote run's file merged into the default branch
  **un-archived** (F23's on-branch archive didn't happen — e.g. a blocked→resolved-via-separate-PR run),
  it can NOT be archived by a direct commit+push to the protected default branch: the guard blocks that,
  correctly. Archive it via a dedicated `chore(aidlc): archive run {ID}` **branch → PR** (docs-only, so
  `--no-verify`; verify the commit landed before pushing — `aidlc:git-workflow`), or fold it into the
  resolving PR pre-merge (`aidlc:run` §10). In **poly+remote** this is one branch+PR **per repo**, so it
  is not free — `/aidlc:status` post-merge cleanup warns of the cost before starting.

Resume + status therefore look for a run file in **both** `runs/` and `runs/archive/`; a file found
only in `archive/` means the run already completed (suggest `/aidlc:status` cleanup / confirm the
merge), never redo it.

**Archived is not immutable — one path reopens it.** A poly+remote run archives on the branch
*pre*-merge (F23), so an open PR's run file normally sits in `archive/` while the PR is still being
reviewed. When review comments come back, `aidlc:review-feedback` `git mv`s it back to `runs/`, sets
`phase: verify`, works the findings, and re-archives at the end. That is the only sanctioned
un-archive: it keeps `/aidlc:status` honest (an actively-changing run must not read as finished) and it
preserves F23's invariant, since the file still merges in archived.

## Invariants

- `Log` and `Findings` are append-only (findings flip `[open]`→`[resolved]` in place).
- One run file per item; a re-run after archive starts a fresh file.
- Timestamps from the system clock (`date -u` / `Get-Date`), never invented.
