---
name: adopt-adr
description: Write retroactive ADRs for the decisions an existing codebase already embodies — from the adrCandidates the adoption scan derived, one ADR at a time behind its own approval, each citing the code that proves the decision and leaving its rationale explicitly unrecorded for a human to fill. Existing architecture docs elsewhere (Confluence, Notion, RFCs/) are linked from the index, never copied or relocated. Use after /aidlc:adopt on a brownfield project whose docs/adr/ is empty while its decisions are everywhere in the code.
argument-hint: "[--only <decisionKind>] [path to profile.json]"
disable-model-invocation: true
---

# /aidlc:adopt-adr — the decisions are in the code; write them down without inventing why

On a brownfield project `docs/adr/` is empty and the decisions are everywhere in the code. That hurts
more than it looks: `/aidlc:do` grounds itself in ADRs before answering (`do` §1), the architect reads
them before planning, and both are reduced to re-deriving from source what somebody decided years ago —
badly, because source shows *what* and never *why*.

This command closes the half of that gap a scan can honestly close. `/aidlc:adopt` §6 derived
`adrCandidates[]`: decisions the code embodies, ranked by how expensive they would be to undo, each with
`path:line` evidence. This writes the approved ones into `docs/adr/`.

> **The one rule everything else serves: no rationale is ever invented.** An ADR marked `accepted` is
> read as settled history. One plausible sentence about *why* — the kind that is easy to write and
> impossible to distinguish from a real one — becomes a decision record nobody authored and everybody
> trusts, cited in reviews and design arguments for years. So every rendered ADR says
> **"not recorded — confirm with the team"** where the why belongs, and that blank is the artifact's
> most valuable line.

## 1 · Load the candidates

Read `.aidlc/adoption/profile.json` (or the path in `$ARGUMENTS`) and **validate it first** — same
discipline as `/aidlc:adopt-apply` §1:

```
node "<plugin>/skills/adopt/validate-profile.mjs" .aidlc/adoption/profile.json
```

Non-zero ⇒ stop and report; an unrecognised `profileVersion` ⇒ stop.

**Staleness check — compare the *code*, not the commit hash.** Different commits do **not** mean
stale facts: `adopt` §10 requires the profile be git-tracked, so committing it is what moves HEAD, and a
raw hash comparison therefore fires on **every** correctly-followed adoption. A check that cries wolf on the
happy path teaches the user to dismiss it, and then the one time code really has moved it gets dismissed
too. So ask whether anything outside the adoption artifacts moved:

```
git -C "<control plane>" diff --name-only <scan.commit>..HEAD -- . ':(exclude).aidlc/adoption/'
```

- **Empty** ⇒ the profile still describes the workspace. Say so in one line — *"the profile is 1 commit
  behind HEAD, and that commit is the one that recorded it"* — and carry on.
- **Non-empty** ⇒ the code genuinely moved. Name the paths, say what that means for this command
  (a decision may have been superseded since), and offer to re-scan first. Proceed only if the user chooses to.

`skills/adopt/converged.mjs` exports `onlyAdoptionArtifactsMoved()` for this, so the three commands that
read a profile all answer it the same way.

No `adrCandidates[]`, or none with `status: "propose"` ⇒ say so plainly and stop. On a re-run that is
the **expected** outcome and a good one: every decision the scan can see is already recorded. Report the
`already-recorded` entries with their `existingAdr` so the silence is legible as *checked and covered*
rather than *nothing happened*.

`--only <decisionKind>` narrows this run to one decision.

## 2 · Reconcile against what already exists — twice

Two independent checks, because they catch different misses:

1. **The config's `adoption.adrs[]`** — the mapping this command writes. A `decisionKind` already there
   is skipped, and that is what makes re-adoption quiet.
2. **`docs/adr/` itself, read fresh.** Someone may have written an ADR by hand since the scan, or the
   scan's own de-duplication may have missed a differently-titled one. Read the H1 and status of each
   existing ADR before proposing anything, and never propose an ADR for a decision one already records.

**Existing docs elsewhere are LINKED, never copied or relocated.** A decision recorded in Confluence,
Notion, an `RFCs/` directory or a design doc (the profile's `docs[]` entries) stays where the team keeps
it. Add a line to the ADR index pointing at it — moving a team's documentation into our directory
structure is not adoption, it is annexation, and it breaks every link they have.

## 3 · Render each ADR

From `${CLAUDE_PLUGIN_ROOT}/templates/adr-template.md`, numbered `NNNN` = next free number in
`docs/adr/` (four digits, zero-padded, continuing the project's existing sequence — never restarting it).
File: `docs/adr/NNNN-<slug>.md`, slug from the title.

| Field | Retroactive value |
|---|---|
| H1 | `NNNN. <candidate title>` — the decision **as a statement** (*"Isolate tenants in one shared Postgres schema keyed by `tenant_id`"*), never its topic |
| **Status** | `accepted (retroactive)` — accepted because the code already runs on it; *retroactive* because nobody approved this document at the time |
| **Date** | `decidedAt.value` where history established it, else **`unknown`** with the reason in one clause (*"unknown — the pattern predates this repo's oldest commit"*). A squashed history genuinely cannot answer this, and a plausible date is a lie with a citation |
| **Work item** | `none — retroactive, derived from the codebase at <scan.commit>` |
| **Context** | What the code shows about the situation, **with `path:line` citations**: the constraints that are visibly true (this is a multi-tenant Postgres service; these 11 repositories all filter by tenant). Not a story about what the team was thinking |
| **Decision** | The decision in one paragraph, present tense — *"The project isolates tenants by…"*, not *"We will…"*: it is already done |
| **Rationale** | **`not recorded — confirm with the team.`** Verbatim. Nothing else goes here, no matter how obvious the reason seems |
| **Alternatives considered** | `not recorded — confirm with the team.` The scan cannot know what was rejected, and listing the obvious alternatives *as if they had been weighed* is the same invention in a different section |
| **Consequences** | Only `consequencesObserved` — what the code demonstrably costs or buys, each traceable (*"every query must filter by `tenantId`; 3 of 11 repositories do it by hand"*). No judgement on whether the decision was wise |
| **Evidence** | A closing `## Evidence` list of the candidate's `path:line` citations. This is what makes a retroactive ADR auditable rather than an assertion |

Two things to get right because they are easy to get wrong:

- **Never edit an existing ADR to "improve" it.** If a decision has changed, the ADR protocol is to
  write a new one and mark the old `superseded by NNNN` (`aidlc:architecture`) — and superseding is a
  human's call, not a scan's. Report the apparent conflict; do not resolve it.
- **Keep it under a page.** A retroactive ADR is shorter than a normal one by nature: two of its
  sections are honest blanks.

## 4 · Approve one at a time, then write

1. **Show the rendered ADR in full** — not a summary. It is a page; the user reads it.
2. **Ask per ADR**: write / skip / edit-the-title-then-write. Approving one says nothing about the next,
   and skipping is a normal outcome (a decision the team does not consider settled should not get an
   `accepted` record). Present them in the candidate order — highest reversibility cost first — so the
   ones that matter are decided while attention is fresh.
3. **Write only the approved ones.** Then, for each: append `adoption.adrs[]` in
   `.claude/aidlc.config.json` with `{decisionKind, adr, repo?, rationaleConfirmed: false}` — where
   `repo` is the candidate's `root` **resolved** to a `repos[]` entry by `name` or `adoptedFromRoot`, never
   the raw root name (a root called `billing-api` is routinely the repo `api`, and the unresolved name
   matches nothing) — and after
   writing, **re-read the config and `JSON.parse` it** (the F49 discipline: a malformed config makes
   Claude Code skip the file, silently disabling every AIDLC plugin for the project).
   `rationaleConfirmed` stays **false**. This command never sets it true; only a human filling in the
   rationale can.
4. **Update the ADR index** if the project keeps one (`docs/adr/README.md` or an index in `docs/`):
   one line per new ADR, plus the link-out lines for external docs from §2. If there is no index, offer
   to create one — an unindexed directory of ADRs is a directory nobody reads.
5. **Do not commit, and do not branch.** Report the file list and `git status --porcelain`; the team
   reviews and commits their own decision records. If the workspace routes docs through the pipeline,
   `/aidlc:run` on a docs item is the door for that — this command writes files, nothing more.

## 5 · Report

- The ADRs written, by path, and the ones skipped with why.
- **The rationale gap, as a task rather than a footnote.** Say how many ADRs are waiting on a human:
  *"3 ADRs written; each has `## Rationale` blank. Fill them from the team's memory while it still
  exists — that is the half of the decision record no scan can ever recover, and it gets harder every
  quarter."* This is the single most useful sentence this command produces.
- Any decision whose evidence looked **contradictory** (two data stores, two auth models) — reported,
  never resolved by picking one.
- What comes next: `/aidlc:do` and the architect now read these; a decision the team disagrees with is
  superseded through the normal ADR protocol, not by editing history.
