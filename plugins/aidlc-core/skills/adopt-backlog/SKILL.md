---
name: adopt-backlog
description: Turn the debt an adoption scan found into tracked work — absent gates, untested critical paths, end-of-life dependencies, TODO clusters, sensitive paths with no review history, docs drift — as properly shaped items with testable acceptance criteria, deduplicated against the existing board, capped, and every one shown before anything is created. Opt-in and propose-only by default; findings whose location is itself a disclosure never carry it into an item. Use after /aidlc:adopt on a brownfield project to make what the scan found visible as work rather than as a report nobody re-reads.
argument-hint: "[--max-items <n>] [--only <kind|root>] [--dry-run] [path to profile.json]"
disable-model-invocation: true
---

# /aidlc:adopt-backlog — the report said it; this makes it work

`/aidlc:adopt` §8 recorded `debtFindings[]`: what the scan noticed is missing or wrong, each with
evidence. That list lives in `.aidlc/adoption/report.md`, and a report is read once. This command turns
the findings a team actually cares about into items on their board, where the pipeline can pick them up
like any other work.

Two things make this the most easily-misused door in the adoption set, and both rules below outrank any
instinct to be thorough:

> **1. Volume destroys it.** Twenty items appearing on a board overnight, labelled `adopted`, is not a
> gift — it is a mess somebody has to close one by one, and it is how a team decides the tool has poor
> judgement. Propose few. A finding you would not defend in standup does not become an item.
>
> **2. A tracker item may be public.** A GitHub issue is world-readable by default. A finding that names
> where an unfixed credential lives, or which fixture holds real customer data, would publish an
> exploitable detail under an adoption banner. Those findings are marked `sensitive` in the profile, and
> what goes on the board is their `trackerSafeTitle` — never their paths, never their evidence.

## 1 · Load the findings

Read `.aidlc/adoption/profile.json` (or the path in `$ARGUMENTS`) and **validate it first** — same
discipline as `/aidlc:adopt-apply` §1 and `/aidlc:adopt-adr` §1:

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
  (a finding may already be fixed, and filing an item for work somebody finished last week is the fastest way to lose the board's trust), and offer to re-scan first. Proceed only if the user chooses to.

`skills/adopt/converged.mjs` exports `onlyAdoptionArtifactsMoved()` for this, so the three commands that
read a profile all answer it the same way.

No `debtFindings[]`, or an empty one ⇒ **say so plainly and stop.** On a well-kept repo that is the
correct output and a good one; report it as *"the scan found nothing worth tracking"*, not as a failure.

`--only <kind|root>` narrows to one finding kind (`absent-gate`, `eol-dependency`, …) or one root.
`--max-items <n>` caps creation (default **20**, and the profile's own `maxDebtFindings` cap already
applies upstream). `--dry-run` proposes and creates nothing — the honest default for a first look, and
worth offering explicitly.

## 2 · Sweep the board — bounded, and say what the bound was

Every finding is checked against what already exists, exactly as `/aidlc:intake` §2's backlog sweep does
(*already fully covered → skip and report; partially → propose the delta*). On a mature
project this is the step that decides whether this command is useful: a brownfield team's board very
often *already has* an item for the missing typecheck gate, filed two years ago.

Use the tracker adapter (`aidlc:work-items`) and follow the **full-sweep discipline** there: count
first, then page to completion **or cap out loud**. On a board with thousands of items a full sweep is
not free, so bound it deliberately and **state the bound in the proposal** — "swept 340 open items
across 3 boards; closed items were not searched." A dedup sweep whose scope is unstated is worse than
none, because it makes "no duplicate found" sound like a fact.

Search on the words a human would have used, not on our finding kinds: `typecheck`, `prettier`,
`coverage`, the dependency name, the path. Then, per finding:

| Board state | What to do |
|---|---|
| An open item already covers it | **Skip.** Report the finding as already tracked, with the item id — that is a useful output, not a null result |
| An open item covers **part** of it | Propose only the **delta**, and link it to the existing item rather than restating its scope |
| A **closed** item covers it | The debt is back, or was never fixed. Propose it, and reference the closed item so the reviewer can see the history |
| An in-flight run touches the same code | Flag it and recommend sequencing after that item lands |
| Nothing | Propose it |

## 3 · Shape each item — no bare titles

A finding is an observation; an item is work with a definition of done. Author each one per
`aidlc:requirements` and `aidlc:planning`:

- **Title** — the finding's `title`, which already states an outcome. For a `sensitive` finding, the
  **`trackerSafeTitle`**, unchanged.
- **Type** from `suggestedType`, **size** from `suggestedSize`. A finding whose remedy is genuinely
  unclear is a **spike** ("establish why the tenant middleware has no tests and what covering it
  costs"), never a story with invented criteria. `XL` gets decomposed before creation, not created.
- **`repo`** resolved from the finding's `root`, **`package`** from its `package` — so the item routes and
  its gate scopes exactly as any other item does.
**Resolve `root` to a repo — do not use it as one.** A profile `root` name comes from the
`.code-workspace` `name` override, while `repos[].name` in the config is the short routing id, and the two
are **different namespaces**: a root called `billing-api` is routinely the repo `api`. Match
`root` against each `repos[]` entry's `name` **or** its `adoptedFromRoot`, and use that entry's `name`.
If a `root` resolves to no entry, **stop and say so** rather than stamping it: a repo name that matches
nothing makes `resolve-gate.mjs` return an empty step list, so the work runs no gate at all and reports
green.

- **≥3 testable acceptance criteria.** This is where most of the value is, and it is also where
  invention creeps in. Derive them from the evidence, not from what a fix probably looks like:

  > *Add a formatting gate to the api service*
  > - `pnpm format:check` exists in `api/package.json` and exits non-zero on an unformatted file
  > - `pipeline.gates.verify.repos.api.steps` includes it, ordered before `lint`
  > - CI runs the same command, so a local pass and a CI pass mean the same thing
  > - the existing tree passes it, or the formatting-only change that makes it pass is a separate commit

- **Description** — what the scan saw, with the `path:line` or command from `evidence`, and the finding's
  `note` where it carries one. **An unconfirmed judgement stays unconfirmed:** an `eol-dependency`
  finding says *"Ruby 2.7 is believed end-of-life — confirm against ruby-lang.org; the scan makes no
  network calls"*, because asserting it and being wrong on the first item is expensive.
- **Never write the remedy as the item.** The profile forbids a finding carrying a `fix`, and an item
  must not smuggle one back in. "Add the gate" is the outcome; which formatter, and whether the tree
  gets reformatted in one commit or ten, is decided when the item runs — planned, reviewed and verified
  like any other change.
- **A `sensitive` finding's item carries no location.** Body text is *"details are in
  `.aidlc/adoption/report.md` in this repo"*. Do not paste the path, the commit, the file name or the
  evidence. If the tracker is private and the user explicitly asks for the detail on the item, that is
  their call to make with the fact stated — the default is withheld.

## 4 · Propose everything, then create only what is approved

Creation is externally visible and mostly irreversible — most trackers cannot truly delete an item, so
a mistake here leaves a tombstone on the team's board. Show the full set first:

```
From the adoption scan of D:\ws at 4f2a9c1 I propose 4 items (of 6 findings):

  NEW  task  "Add a formatting gate to the api service"                [P3, S]  repo=api      — 4 AC
  NEW  story "Add test and review coverage for the tenant middleware"  [P1, S]  repo=api      — 3 AC
  NEW  task  "Rotate a credential found in git history"                [P1, M]  repo=api      — 3 AC
       ↳ details withheld from this item — they are in .aidlc/adoption/report.md
  NEW  story "Move the payments app off Ruby 2.7"                      [P2, L]  repo=payments — 4 AC
       ↳ EOL status needs confirming; the scan makes no network calls

  SKIP — "Add .gitattributes to the platform monorepo" already covered by PROJ-214 (todo)
  SKIP — PII seed fixture: PROJ-88 (done, 2024) covered it; the fixture is unchanged, so re-proposing
         it needs a human's read of whether it is the same data

  Board sweep: 340 open items across 1 board; closed items searched by title only.
Create these? [all / pick / adjust / none]
```

On approval, `adapter.create(...)` each one, then **read each back and assert it landed** — the
`aidlc:work-items` write-verification rule applies here as everywhere: a reported success is not proof.

**Stamp provenance on every created item**, so adoption-born work stays queryable against planned work
forever after:

- the label **`adopted`** (plus `unplanned`, since this work also entered outside planning), and
- a one-line note prepended to the description:
  `> Provenance: created via /aidlc:adopt-backlog on <UTC date> from the adoption scan at <scan.commit> — finding kind: <kind>.`

Use the real date (`date -u` / `Get-Date`), never invented, and the real `scan.commit`. Filtering the
board on `adopted` then answers *"what did adopting AIDLC actually put on our plate"* — a question
somebody will ask, and one that has no answer if the label is skipped.

**Stamp only what you create.** Never relabel an existing item you deduped against.

## 5 · Report

- The items created, by id, and the findings skipped with the item that already covers each.
- **The findings you deliberately did not propose**, and why. A scan that found 6 things and proposed 4
  should say what happened to the other 2 — silence there reads as an oversight.
- **The board sweep's scope**, repeated: what was searched, what was not.
- The `sensitive` findings, named as *"tracked without their detail; the report in this repo has it"* —
  and a reminder that a leaked credential is not fixed by an item existing. Rotation is urgent
  regardless of where it sits on a board.
- What comes next: these are ordinary items now. `/aidlc:run <id>` picks one up like any other, and the
  gate it runs against is the project's own (`pipeline.gates.verify`) — which for an `absent-gate`
  finding is exactly the hole the item exists to fill.

## 6 · What this command does not do

- It does **not** fix anything. It files work; the pipeline does the work.
- It does **not** create an epic to hold the findings unless the user asks. Debt items are usually
  unrelated to each other, and a parent that exists only to group them adds a rollup nobody wants.
- It does **not** re-scan. If the code has moved since `scan.commit`, re-run `/aidlc:adopt` first — this
  command reads a profile and never the code.
- It does **not** touch config, `CLAUDE.md` or `docs/adr/`. Those are `/aidlc:adopt-apply` and
  `/aidlc:adopt-adr`.
