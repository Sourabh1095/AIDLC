---
name: ceremony
description: How much process a piece of work gets — the four tiers (answer, direct, tracked, full), how to pick one, and how to move between them. Load before deciding whether a request needs a work item, a branch or a PR.
user-invocable: false
---

# Ceremony — match the process to the consequence, not to policy

**The rule this skill exists to state: ceremony is proportional to what happens if the work is wrong.**
A typo that ships is a typo. A change to tenant isolation that ships is a data breach. Charging both the
same process tax does not make the second one safer — it makes the first one so annoying that people stop
using the pipeline and go do it by hand, which is how you lose the audit trail on the changes that
actually needed one.

So the default is **the lightest tier that fits**, and heavier tiers are earned by consequence.

## The tiers

| Tier | What it produces | Fits |
|---|---|---|
| **0 · answer** | nothing | questions, opinions, explanations, diagnoses |
| **1 · direct** | a commit on the current branch | small, obvious, low-consequence changes |
| **2 · tracked** | run file + branch + commits; PR optional | real work that nobody needs a ticket for |
| **3 · full** | work item + run file + branch + verification + PR | stories, features, anything a team coordinates around |

### 1 · direct — the tier that was missing

Edit, run the project's gate, commit on **the branch that is already checked out**. No work item, no run
file, no PR, no approval prompt. Announce it in one line, do it, report what happened:

```
Direct — no item, no branch.
  edited  src/components/Header.tsx
  gate    lint ✓  typecheck ✓
  commit  fix(header): correct "Dashbaord" typo   [on feature/PROJ-140]
```

Reach for it when **all** of these hold: the change is small and its intent is unambiguous; you can state
what it touches in one line; it doesn't move a public interface, a schema or a security boundary; and a
reviewer looking at it later would not need context beyond the diff. Typos, a rename, a comment, a log
line, a dead import, a version bump, an obvious off-by-one, a config default.

**Committing on the default branch is allowed here** and is not the same risk as shipping: a local commit
is `git reset` away, and the guard hook still blocks pushing from a protected branch, so the change waits
for a human decision before it reaches anyone else. Say so in the report when it happens (`[on main —
not pushed]`) so nobody is surprised.

If the change turns out bigger than it looked once you are in the code, **say so and move up a tier**
rather than finishing a sprawling edit under a tier that promised a one-liner.

### 2 · tracked — a trail without a ticket

Branch + run file + commits, so the work is resumable and auditable, but no tracker item and no
mandatory PR. This is the right tier for most real work on a solo or small-team project: a refactor, a
non-trivial bug fix, a small feature nobody is coordinating around. Skip the requirements/analyst phase —
the run file's `## Plan` is enough. Open a PR if the repo's convention wants one; otherwise commit to the
branch and let the user merge.

### 3 · full — the pipeline

`aidlc:run` end to end: work item, requirements, plan, implement, verify per cadence, PR, tracker update.
Correct for a story or feature, for anything with acceptance criteria worth verifying, for anything a
team needs visibility into, and for anything an escalation trigger pulled up.

## Picking the tier

1. **Read `pipeline.ceremony`** — the project's **floor**, one of `direct` (default) · `tracked` ·
   `full`. It only ever raises, never lowers: a project that sets `full` gets the pipeline for
   everything, which is a legitimate choice for a regulated team.
2. **Take the lightest tier at or above the floor that fits the work**, per the descriptions above.
3. **Apply the escalation triggers** below — they override both your judgment and the floor.
4. **Announce it in one line before acting.** `Direct — no item, no branch.` /
   `Tracked — branch + run file, no ticket.` / `Full pipeline — PROJ-141.` A misread the user catches
   here costs nothing; one they catch after a ticket exists costs a cleanup.

Ambiguity resolves **downward**, with one exception: if getting it wrong is expensive to undo, resolve
upward. That is the whole heuristic — cheap-to-undo work errs light, expensive-to-undo work errs heavy.

## Moving between tiers — both directions are first-class

**Down.** *"just do it"*, *"don't make a ticket"*, *"no PR"*, *"commit it here"*, *"skip the process"* are
**instructions, not objections to argue with.** Drop to the tier they name, confirm in one line, proceed.
Do not explain the benefits of the tier they declined, do not ask twice, and do not quietly re-add the
ceremony later in the same run. A user who has to fight the tool for a one-line fix uninstalls the tool.

The one thing you still do on the way down: if an **escalation trigger** fires, say which one and why it
can't be waived — once, briefly — and then follow the user's decision if they repeat it. Their codebase,
their call.

**Up.** *"track this"*, *"make it an item"*, *"open a PR for that"* promotes work already done: create the
item, link the commits already made, and carry on. A direct change is never trapped at its tier — that is
what makes starting light safe.

**Sideways, after the fact.** A Tier 1 change that grew, or that turned out to matter, can be promoted
retroactively: the commits exist, so the item just needs creating and linking. Say what you promoted and
why.

## Escalation triggers — the short list that overrides the floor and the user's preference

These are not process preferences. Each one names something that is **not recoverable** by noticing it
later, which is the only justification for insisting:

1. **Auth, tenant isolation, or anything in `pipeline.securityReviewPaths` / `saas.authPaths` /
   `saas.tenantIsolationPaths`** → at least **tracked**, and the security review still applies per
   `aidlc:run` §7. A cross-tenant leak is not caught by review-it-next-time.
2. **A destructive migration under `liveDataConstraint: expand-contract`** — a dropped or renamed column,
   a narrowed type, a `NOT NULL` on an existing column → **full**. It runs clean against an empty test
   database and destroys production data.
3. **A change to a declared `saas.apiContracts` path** → at least **tracked**, and `public: true` means
   external consumers, which the report must name.
4. **Work an in-flight run already owns** (its branch touches this code) → that run's tier, and route it
   there. Two agents on one file is the one collision no tier protects against.
5. **The user asked for the pipeline** — an explicit `/aidlc:run <ID>`, or a prompt naming an item — is
   itself a Tier 3 request. Honor it; don't optimize it down.

Nothing here fires on an absent config field. A project with no `saas` block has no runtime constraints,
so triggers 1–3 simply do not apply — the pipeline never invents a constraint it has no evidence for.

## What every tier keeps

Three things do not scale down, because they are what makes a light tier safe rather than reckless:

- **The project's gate runs.** Resolved per `aidlc:run` §7 (`resolve-gate.mjs`) and executed before the
  work is called done, at every tier including direct. Ceremony is what got cut, not verification.
- **Work is never silently lost.** Every tier ends with the change either committed or explicitly
  reported as uncommitted, and says which branch it landed on. "I edited some files" is not a result.
- **The default branch is never pushed to unattended.** Tier 1 may commit there; nothing pushes there
  without a human. The relocated-not-removed principle from `git.mode: local` applies to weight the same
  way it applies to remoteness.
