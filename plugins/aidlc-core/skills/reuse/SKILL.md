---
name: reuse
description: Use BEFORE writing or planning any new code in this project — a feature, screen, component, hook, helper, API client, type or test — to find what already exists (the reuse catalog), extend it instead of writing a second one, and put new shared code where the next change will find it. Also catches code a branch duplicated (dup-check). Load for any implement, plan or review task, including plain requests like "add X to Y".
user-invocable: false
---

# Reuse — use what exists, and leave things reusable

Most avoidable code in an AI-written change is code the project already had: a date formatter written
inline beside `lib/date.ts`, a second pagination hook, a table copied from the screen next door. The
cause is almost never carelessness — it is not knowing what exists. So this skill hands every planner
and implementer **the list**, and checks the result deterministically. It is stack-agnostic.

## The tools

```bash
R="${CLAUDE_PLUGIN_ROOT}/skills/reuse"
node "$R/catalog.mjs" query   <repo> <words…>      # what already exists for these words, ranked
node "$R/catalog.mjs" build   <repo> --out .aidlc/catalog --name <repo>   # full list → .aidlc/catalog/<repo>.md
node "$R/catalog.mjs" similar <repo> [--base <ref>]  # new exports on this branch that resemble existing ones
node "$R/dup-check.mjs"       <repo> [--base <ref>]  # code this branch duplicated (existing or within itself)
node "$R/exemplars.mjs" show  <repo> <kind>         # the golden path: how THIS project adds an endpoint,
                                                    #   page, migration, component, job or test
```

**Golden paths** answer the question the catalog cannot: not *what* exists, but *how this project does a
kind of change*. For each kind, `exemplars.mjs` takes the project's most recent example and asks git
which commit added it and what else that commit touched — a NestJS endpoint here might be a controller,
a service, a DTO, a module registration and a spec; a page might be a route folder with its own loading
state. That file set is the recipe a new change of the same kind should follow. A kind the project does
not have yet is reported absent: the first change of that kind establishes it.

The catalog covers the repo's **shared areas** — `components`, `ui`, `hooks`, `lib`/`utils`/`helpers`,
`services`/`clients`/`api`, `types`, `validators`/`schemas`, `errors`, `middleware`/`guards`, `store`,
test `fixtures`/`factories`/`conftest.py`, monorepo `packages`, plus anything in config
`reuse.sharedPaths` — across TS/JS, Python, Go, Java/Kotlin, C#, Rust, PHP and Ruby. It is generated,
never committed (`.aidlc/catalog/` is ignored) and cheap: query it every time rather than trusting an
old copy. `--config .claude/aidlc.config.json` passes the project's `reuse` settings. **No shell to run
it?** Read `.aidlc/catalog/<repo>.md` if it exists, else Glob/Grep the shared folders above for exported
names — the step is "know what exists before writing", not "run this command".

## The ladder — in this order, every time

1. **Reuse** it as is.
2. **Extend** it — a parameter, a prop, a variant, an overload — when it almost fits. Keep the existing
   callers working; extending is not rewriting.
3. **Extract** — when the logic you need is buried inside something else (a screen, a service method),
   move it into the shared area once and call it from both places.
4. **Create new** only when nothing fits — and create it **in the shared area it belongs to**, named for
   what it does, so the next change finds it in the catalog.

"Almost fits but I'd rather not touch it" is not a reason to fork. A second copy is a second place every
future fix has to be made, and the copies drift.

**But do not abstract on the first use.** One caller is not a pattern. Write it where it is used; the
second caller is what earns the extraction (step 3). A speculative "generic" helper with one caller and
four options nobody asked for is as much a cost as a copy.

## Planning (the architect, or the orchestrator for a small item)

**Follow the house pattern.** When a task adds something of a known kind (endpoint, page, migration,
component, job, test), read its golden path first (`exemplars.mjs show <repo> <kind>`) and plan the same
file set and structure — the task's `paths:` list mirrors the recipe, adapted to the new name. Diverge
only on purpose, and say why in the task line; an unexplained second way of doing the same thing is the
structural version of a duplicated helper.

Before writing `## Plan`, query the catalog with the item's nouns and verbs (`pagination users table`,
`avatar upload validation`) for each repo/package the plan touches. Then write a `### Reuse` block at the
top of `## Plan`:

```
### Reuse
- uses:    src/hooks/use-pagination.ts:usePagination · src/components/ui/table.tsx:DataTable
- extends: src/lib/date.ts:formatDate — add a `relative` option (2 existing callers unaffected)
- new shared: src/lib/currency.ts:formatMoney — nothing formats money today (queried: money, currency, price)
- rejected: src/legacy/grid.tsx:Grid — deprecated per ADR-0007
```

Write `- none found (queried: …)` rather than omitting the block — the absence of a reuse decision is
what this exists to prevent, and the queried words let a reviewer judge it. Plan task lines carry
`reuses: <path:symbol>` where a task consumes something, so the implementer brief names it.

**Look-alike tasks get a shared piece first.** When two or more tasks apply the same treatment to
different targets (pagination on three screens, validation on four forms), the first task extracts the
shared piece with `foundation: true` and the rest declare `reuses:`. Parallel implementers cannot see
each other — without the foundation task, each writes its own copy. `resolve-fanout.mjs` warns when it
sees this shape; treat the warning as a plan defect and fix the plan before dispatching.

## Implementing

- Before creating any **exported** function, hook, component, class, type, client or fixture:
  `catalog.mjs query` with its purpose. If something fits, use the ladder above.
- New shared code goes in the shared area the catalog shows for that kind of thing (the project's own
  `hooks/`, `lib/`, `components/ui/`…) — not inside the feature that first needed it, where nobody looks.
- Before reporting `COMPLETE`, run `catalog.mjs similar` and `dup-check.mjs` on your branch. Fix what
  they find, or say in your report why a flagged copy is intentional.
- Report three lines: **reused** (what you called), **extended** (what you changed, and that its old
  callers still pass), **new shared** (what you added, and where). The orchestrator copies them into the
  run file and the PR body.

## Verifying (always, regardless of agent cadence)

The orchestrator runs both checks in `aidlc:run` §7 for every item — they are deterministic and cost
seconds, so they do not wait for the reviewer's cadence:

| Result | Finding |
|---|---|
| `dup-check`: copy of **existing** product code, ≥ `reuse.minCloneLines` (default 8) | `[MAJOR][open] reuse: <file:from-to> repeats <other> — reuse or extract` |
| `dup-check`: copy **within the change** | `[MAJOR][open] reuse: … written twice in this change — write it once in a shared place` |
| `dup-check`: either kind, in **test** code | `[MINOR][open] reuse: … — a shared fixture/helper would do` |
| `similar`: new export resembling an existing one | `[MINOR][open] reuse: <new> may duplicate <existing> — use or extend it, or say why it differs` |

`reuse.duplication: "warn"` lowers the MAJORs to MINOR (a legacy codebase mid-cleanup); `"off"` skips
the check and says so in `## Findings`. A MAJOR goes through the normal fix cycle — the fix is the
ladder, never a cosmetic edit that defeats the matcher.

The reviewer, when it runs, reads the same output and judges what a matcher cannot: logic copied with
different names (`dup-check --fuzzy`), a new component that is an existing one with one prop changed,
a helper that duplicates a library the project already depends on.

## Writing code the next change can reuse

- **One job per unit, named for the job.** `formatMoney(amount, currency)`, not `helpers.ts`'s
  `processData`. The name is how the catalog query finds it.
- **Logic apart from wiring.** Pure functions for the calculation, a thin component/controller/handler
  that calls them. Logic fused into a screen or a route cannot be reused without copying it.
- **Parameters over copies.** A variant, an option or a prop is how a component serves a second caller;
  a near-copy with one line changed is how it stops being one component.
- **Export through the module's public surface** (its index/barrel, package exports, `__init__`) so
  callers import the shared thing, not a deep path into it.
- **One sentence of doc comment on every exported symbol** — it is the catalog's description, the thing
  the next planner reads to decide whether it fits.

## Config

| Key | Default | Meaning |
|---|---|---|
| `reuse.sharedPaths` | `[]` | Extra shared folders beyond the built-in names (per repo too: `repos[].reuse`) |
| `reuse.minCloneLines` | `8` | Smallest duplicated block `dup-check` reports |
| `reuse.duplication` | `"block"` | `block` (MAJOR, fix cycle) · `warn` (MINOR) · `off` |
