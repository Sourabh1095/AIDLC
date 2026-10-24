---
name: intake
description: Turn a requirement described in plain language into proper backlog items — epic/stories/tasks/bugs with acceptance criteria — in the active tracker (Jira, Azure DevOps or markdown), deduplicated against what already exists. Use when the user describes something they want built or fixed that is not yet a work item.
argument-hint: "<the requirement, in plain language>"
---

# /aidlc:intake $ARGUMENTS — requirement in, backlog items out

**The tracking door.** The user describes WHAT they want; this produces well-formed, tracked work
items — not code. (Implementation starts afterwards via `/aidlc:run`.)

There is one general front door — **`/aidlc:do`** — and it routes here when a request turns out to
warrant a ticket. This skill is the door for *one* requirement; **`/aidlc:bootstrap` is the same job at
batch scale** — a requirements/features document or a brief carrying several requirements, decomposed
together with shared epics, cross-item dependencies and a capacity-planned sprint sequence. That holds
on an existing project as well as a new one: bootstrap detects brownfield and grounds in the code the
same way step 2 below does. **Hand a multi-feature document to bootstrap, not to this door one
requirement at a time** — the dependencies between them are exactly what that loses. Arriving here
directly is fine and common; arriving here for a typo is not (see below).

**This door is for work that warrants tracking.** Small, obvious, low-consequence changes are handled at
tier 1 without an item — see `aidlc:ceremony`. Arriving here means the tier decision already concluded
that a trail is worth having; if it plainly hasn't (a typo, a rename), hand it back rather than filing it.

## 1 · CAPTURE

Take the requirement from `$ARGUMENTS`. If it's missing or too thin to act on (no observable
outcome; e.g. just "improve performance"), ask ONE round of targeted questions (what outcome,
for whom, any constraints/deadline, in scope vs out). Don't interrogate — the analyst refines
details later; you only need enough to scope items.

## 2 · ANALYZE (dispatch Agent → aidlc-analyst, intake mode)

Brief the analyst with the requirement text (and, in poly, the repo registry from
`aidlc:work-items` → *Repos & routing*). It must:
1. **Read the codebase** enough to ground the requirement (which modules are affected, what
   exists already, feasibility signals). **In poly, ground across ALL declared repos** — a single
   requirement often spans several (an API change in `backend`, its UI in `frontend`, a
   marketing note on `website`). Determine which repo each piece of work belongs in.
2. **Sweep the existing backlog** — `adapter.query` across open items (all statuses except
   done) and compare against the requirement:
   - Already fully covered by an existing item → report it; nothing to create.
   - Partially covered → propose only the DELTA as new item(s), linked/related to the
     existing ones (note the relation in descriptions; set `parent` where a real epic exists).
   - Overlaps an in-flight run → flag it (the new work may conflict with an open branch;
     recommend sequencing after that item lands).
3. **Shape the work** per `aidlc:requirements` + `aidlc:planning`:
   - One outcome, ≤ size L, in ONE repo → a single story (or `bug`/`task`/`spike`).
   - Multiple independent outcomes, > L, **or work that spans repos** → an epic + 2–8 INVEST child
     stories. In poly, **each child targets exactly one repo** (`repo` set) with `dependsOn`
     capturing genuine cross-repo order.
   - **A frontend + backend pair is contract-first, not chained** — apply `aidlc:work-items` →
     *Contract-first siblings* (the full rule is in its `references/structure.md`). In short: a new or
     changing interface gets a small **contract child**, and both implementation children `dependsOn`
     it and **not each other**; an interface that already exists unchanged gets **no contract child and
     no edge** (read the contract and say so on both items). What is specific to authoring them here:
     give the frontend child AC satisfiable against generated types and contract-derived fixtures, so it
     never idles on a running backend; and chain two children only for a real ordering that is not the
     interface (a migration, a flag), with the reason written on the item.
   - **Poly — author cross-repo work at the tier `workspace.crossRepoSplit` sets** (`aidlc:work-items` →
     *Cross-repo split tier*): `story` (default) → a **Feature with one Story per repo**, never one fat
     cross-repo Story for `/aidlc:run` to split later; `task` → a **Story umbrella with one Task per
     repo**. A Task never spans repos, and when a split re-homes ACs, apply the **AC coverage map**
     (`aidlc:work-items` → *Re-decomposition & supersession*) — every original AC lands on a child.
   - Work that belongs to **no product repo** (workspace README, cross-repo docs, control-plane config)
     → target `control-plane` (F8), not a product repo. Work referencing a repo **not yet declared** (a
     shared lib, a future product) → note it and offer to declare it (`/aidlc:repo add`), don't fold it
     into an unrelated repo (F2).
   - Every story/bug gets testable AC; every item gets type, priority (ask if not inferable),
     estimate, labels, and — in poly — a resolved `repo` (or, if genuinely undecidable, left null
     for the run to resolve).

## 3 · PROPOSE (always — creation is externally visible)

Show the user the proposed set BEFORE creating anything:

```
From your requirement I propose:
  NEW  epic  "User avatars"
  NEW  story "Avatar API contract (OpenAPI)"   [P2, S]  repo=backend   — 2 AC   ← lands first
  NEW  story "Upload avatar (5MB, png/jpeg)"   [P2, M]  repo=backend   — 4 AC   (dependsOn contract)
  NEW  story "Show avatar on profile"          [P2, S]  repo=frontend  — 3 AC   (dependsOn contract)
       ↳ the two above run IN PARALLEL once the contract lands — neither depends on the other
  SKIP — "Image storage bucket" already covered by PROJ-87 (todo); linked as dependency
  NOTE — overlaps in-flight PROJ-91 (profile page rework): sequence after it
Create these? [all / pick / adjust]
```

(The `repo=` column appears only in poly; in mono it's omitted. Every NEW item is created with the
`unplanned` label + a provenance note — mention this once so the user knows it'll be traceable.)

Apply adjustments; on approval → `adapter.create(...)` for each (epics first, then children
with `parent` set), and `adapter.comment` on related EXISTING items about the new links.

**Stamp provenance on every item intake creates** — this is what tells you, months later, *what was
done apart from the planned backlog*:
- add the label **`unplanned`** to each created item's `labels`, and
- prepend a one-line note to its `description`:
  `> Provenance: created via /aidlc:intake on <UTC date> from a direct request — "<verbatim requirement>".`
Use the real date (system clock — `date -u` / `Get-Date`), never invented. This is
**tracker-agnostic**: the adapter maps `labels` natively (markdown frontmatter · Jira labels · ADO
`System.Tags`) and every adapter writes `description`, so the stamp lands the same whether the
backlog is markdown, ADO or Jira. Stamp only the NEW items — never relabel the existing items you
linked to. Afterwards, filtering the tracker on `unplanned` surfaces everything that entered outside
planning.

## 4 · HAND OFF

**Record the intent in the project brain** when this person has one (`.aidlc/brain/`, unless
`brain.enabled` is false). For each created Story or Bug whose module has a page, add the business rules
and capabilities its acceptance criteria state as `[req: <ID>]` lines (`aidlc:brain` → *Writing it*).
Leave Tasks out, and leave out modules that have no page yet: the run that builds the item creates
the page from real code.

Report the created IDs, then offer exactly one next action:
- single item → "Run it now? `/aidlc:run <ID>`"
- multiple → "Start with <highest-priority ID>? (`/aidlc:next` will pick it up too)"
If the user asked to "build it" in the same breath (e.g. via `/aidlc:run <free text>`), proceed
into the run pipeline for the first ready item without re-asking — and since `run` is
`disable-model-invocation` and unreachable via the Skill tool (see `aidlc:run` → *Entry is
deliberate*), do that by **reading `${CLAUDE_PLUGIN_ROOT}/skills/run/SKILL.md` and following it
verbatim** with that ID as `$ARGUMENTS`. Absent that ask, stop here and let the user choose the door:
filing the items is a complete outcome.

## Rules

- **Once work is coming through THIS skill, items come before code** — the audit trail (assumptions, AC,
  run files) only works if the work is tracked, so don't half-track it by implementing first and filing
  after. But that is a rule about this door, **not about every change**: whether a request belongs here at
  all is decided upstream by `aidlc:ceremony`, and a small obvious change is answered at tier 1 (`do` →
  DIRECT) with no item at all. If a request reaches intake and clearly doesn't warrant tracking, say so
  and hand it back down a tier rather than manufacturing a ticket for a typo.
- Stamp provenance (`unplanned` label + a `created via /aidlc:intake on <date>` description note) on
  every item you create — the point is that request-born work stays visible and queryable afterwards.
- Dedup honestly: creating a near-duplicate of an existing item is worse than asking.
- Requirements that are pure bugs skip the epic question: one bug item with repro steps
  (ask for them if missing — the QA repro-first protocol depends on them).
