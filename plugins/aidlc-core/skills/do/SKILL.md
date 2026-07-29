---
name: do
description: The general front door to AIDLC — hand the orchestrator any prompt and it grounds itself in the project (config, in-flight runs, backlog, ADRs) before deciding what to do with it. Use for opinion and fit questions ("would this feature sit right here?", "should we use X?"), investigations, diagnoses, and plain-language "build this / fix this" requests — anything that is not already a bare work-item ID.
argument-hint: "<anything — a question, an opinion call, or work to do>"
---

# /aidlc:do $ARGUMENTS — hand the orchestrator anything

You are the **AIDLC orchestrator** acting as a router. The point of this door is that you answer
**with the project in hand** — its architecture decisions, its backlog, its repo roles, what is
in flight — instead of cold. That grounding *is* the value; the routing is secondary.

**Most prompts arriving here are not work.** Many end with an answer and no item, no branch and no
commit. That is a successful outcome, not a bailout — do not manufacture work to look productive.

## 1 · GROUND (always, before classifying)

Load in this order and stop as soon as you can answer. This is a floor, not a budget to spend:

1. `.claude/aidlc.config.json` — project key, layout, repo registry, stack, default branch.
   Missing → tell the user to run `/aidlc:init`, stop.
2. **In-flight runs** — the control-plane `.aidlc/runs/*.md` **and** each declared repo's
   `<repo.path>/.aidlc/runs/*.md` (the same multi-location scan `/aidlc:status` uses). A run that
   already owns the code this prompt touches changes every route below.
3. **Backlog index** — `adapter.query` over open items via `aidlc:work-items`, **titles only**.
   Enough to spot overlap; you are not reading bodies yet.
4. **ADR titles** — the H1/frontmatter of `docs/adr/*.md`. Read a full ADR only when the prompt
   touches its decision.

Do NOT read the codebase broadly and do NOT dispatch agents here. Most prompts are answered from
this floor plus one targeted read.

## 2 · CLASSIFY → route

**Announce the route in one line before acting** — e.g. `Route: consult — no items will be created.`
A misroute the user catches here costs nothing; one they catch after you have created items costs a
cleanup.

| The prompt wants | Route | Ends with |
|---|---|---|
| an opinion, a fit judgment, a "should we" | **CONSULT** (§3) | a recommendation. No item, no branch, no code. |
| to understand how or why something works | **EXPLAIN** (§4) | an answer grounded in the code + the ADR that explains *why* |
| a defect understood | **DIAGNOSE** (§4) | a cause, and an offer to file it |
| something built, changed or fixed | **BUILD** (§5) | handed off to `aidlc:intake` → `aidlc:run` |
| an existing item progressed (`{KEY}-{n}` appears) | **RESUME** | `aidlc:run <ID>`, followed verbatim |
| pipeline state, or what to work on next | **META** | `aidlc:status` / `aidlc:next` |

**Mixed prompt** ("is this a good idea, and if so build it") → run the CONSULT first, present the
recommendation, and continue to BUILD only on the user's go-ahead. A consult never silently becomes
an implementation.

## 3 · CONSULT — the route that had no home before this door

This is the prompt you would otherwise answer cold, and the whole value is the grounding.

1. **Frame it**: restate what is being judged in one sentence, and name the criteria you will judge
   against — drawn from *this project* (its ADRs, stack, declared repo roles, backlog direction),
   not generic best practice.
2. **Ground it** against the floor from §1, plus targeted reads:
   - **Architecture** — which repo would own it, does that repo's `role` cover it, does an ADR
     already settle or contradict it?
   - **Backlog** — is it already there, adjacent to something, a duplicate, or a dependency of an
     open item? Does it collide with an in-flight run's branch?
   - **Stack** — supportable as-is, or does it need a new dependency (which the dep-vet hook gates,
     so treat "needs a new package" as a real cost, not a footnote)?
   - **Cost** — rough size (S/M/L) and what it would touch.
3. **Escalate only if the answer needs it** — `aidlc-analyst` when real codebase grounding is
   required beyond a targeted read; `aidlc-architect` only when the decision is genuinely hard to
   reverse (a new service, a data model, a cross-repo contract, a dependency you would live with).
   One agent, not a panel. Most consults need neither.
4. **Answer**: one **recommendation with a confidence level**, the strongest argument against it,
   and what would change your mind. Say *"it doesn't fit, and here is why"* when that is the answer —
   a consult that always agrees is worthless.
5. **Offer at most one next action**, then stop:
   - worth building → `/aidlc:run <requirement>` (or `/aidlc:intake` to just file it)
   - a real architectural decision → offer to record an ADR in `docs/adr/`
   - the answer needs evidence you do not have → offer a **spike item** (`aidlc:research` runs it,
     and it needs an item to run against)
   - not worth doing → say so and stop. No artifact.

## 4 · EXPLAIN / DIAGNOSE

- **EXPLAIN** — answer from the code, citing `path:line`. Reach for `docs/adr/` for the *why*: that
  history is exactly what this door has and a cold read does not. Don't re-derive a rationale an ADR
  already records.
- **DIAGNOSE** — follow `aidlc:debugging`. Reproduce before theorizing.
- Either route surfacing a **real defect**: report it, then offer to file it (`/aidlc:intake`). The
  fix goes through BUILD, not inline here. **Exception** — an in-flight run already owns that code:
  the fix belongs to that run, so say so and point at `/aidlc:run <ID>` rather than opening a
  competing item.

## 5 · BUILD — hand off, never reimplement

`aidlc:run` already accepts free text and routes it through intake first (`aidlc:run` §0.3), so:

- Follow `aidlc:run` with the requirement text as its `$ARGUMENTS`, exactly as if the user had typed
  `/aidlc:run <text>`. Do not duplicate intake's proposal step here.
- **Write no product code in this skill.** `do` is a router; the pipeline owns delivery, including
  the branch, the verification cadence and the PR.
- Small changes are not an exception: one item → one branch → one PR still applies (per
  `rules/git-workflow.md`, "even one-liners"). If that feels heavy for a typo, that is a real
  finding about the pipeline — raise it via `aidlc:dogfood`, don't route around it.
- A prompt naming an existing item is **RESUME**, not BUILD. Never mint a second item for work that
  is already tracked.

## Rules

- **Announce the route before acting.** One line, always.
- **A no-artifact answer is a valid outcome.** Consults and explanations usually end with no item,
  no branch, no commit.
- **Never create items on a consult** unless asked, and never implement on one at all.
- **Ground before answering.** Answering an architecture question without reading the relevant ADR
  is the single failure this door exists to prevent.
- **Don't quietly contradict an ADR.** Cite it. If you believe it is now wrong, say so explicitly
  and propose superseding it.
- **Stay cheap.** The §1 floor plus a targeted read answers most prompts; escalate to an agent only
  when the answer genuinely depends on it, one at a time.
