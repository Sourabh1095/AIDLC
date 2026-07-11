---
name: intake
description: Turn a requirement described in plain language into proper backlog items — epic/stories/tasks/bugs with acceptance criteria — in the active tracker (Jira, Azure DevOps or markdown), deduplicated against what already exists. Use when the user describes something they want built or fixed that is not yet a work item.
argument-hint: "<the requirement, in plain language>"
---

# /sdlc:intake $ARGUMENTS — requirement in, backlog items out

The front door of the pipeline: the user describes WHAT they want; this produces well-formed,
tracked work items — never code directly. (Implementation starts afterwards via `/sdlc:run`.)

## 1 · CAPTURE

Take the requirement from `$ARGUMENTS`. If it's missing or too thin to act on (no observable
outcome; e.g. just "improve performance"), ask ONE round of targeted questions (what outcome,
for whom, any constraints/deadline, in scope vs out). Don't interrogate — the analyst refines
details later; you only need enough to scope items.

## 2 · ANALYZE (dispatch Agent → sdlc-analyst, intake mode)

Brief the analyst with the requirement text (and, in poly, the repo registry from
`sdlc:work-items` → *Repos & routing*). It must:
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
3. **Shape the work** per `sdlc:requirements` + `sdlc:planning`:
   - One outcome, ≤ size L, in ONE repo → a single story (or `bug`/`task`/`spike`).
   - Multiple independent outcomes, > L, **or work that spans repos** → an epic + 2–8 INVEST child
     stories. In poly, **each child targets exactly one repo** (`repo` set) with `dependsOn`
     capturing cross-repo order (e.g. the frontend child depends on the backend child).
   - Every story/bug gets testable AC; every item gets type, priority (ask if not inferable),
     estimate, labels, and — in poly — a resolved `repo` (or, if genuinely undecidable, left null
     for the run to resolve).

## 3 · PROPOSE (always — creation is externally visible)

Show the user the proposed set BEFORE creating anything:

```
From your requirement I propose:
  NEW  epic  "User avatars"
  NEW  story "Upload avatar (5MB, png/jpeg)"  [P2, M]  repo=backend   — 4 AC
  NEW  story "Show avatar on profile"          [P2, S]  repo=frontend  — 3 AC  (dependsOn ↑)
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
  `> Provenance: created via /sdlc:intake on <UTC date> from a direct request — "<verbatim requirement>".`
Use the real date (system clock — `date -u` / `Get-Date`), never invented. This is
**tracker-agnostic**: the adapter maps `labels` natively (markdown frontmatter · Jira labels · ADO
`System.Tags`) and every adapter writes `description`, so the stamp lands the same whether the
backlog is markdown, ADO or Jira. Stamp only the NEW items — never relabel the existing items you
linked to. Afterwards, filtering the tracker on `unplanned` surfaces everything that entered outside
planning.

## 4 · HAND OFF

Report the created IDs, then offer exactly one next action:
- single item → "Run it now? `/sdlc:run <ID>`"
- multiple → "Start with <highest-priority ID>? (`/sdlc:next` will pick it up too)"
If the user asked to "build it" in the same breath (e.g. via `/sdlc:run <free text>`), proceed
into `sdlc:run` for the first ready item without re-asking.

## Rules

- NEVER start implementing from a raw requirement — items first, always. The audit trail
  (assumptions, AC, run files) only works if the work is tracked.
- Stamp provenance (`unplanned` label + a `created via /sdlc:intake on <date>` description note) on
  every item you create — the point is that request-born work stays visible and queryable afterwards.
- Dedup honestly: creating a near-duplicate of an existing item is worse than asking.
- Requirements that are pure bugs skip the epic question: one bug item with repro steps
  (ask for them if missing — the QA repro-first protocol depends on them).
