---
name: brain
description: The project brain (.aidlc/brain/) — this person's growing understanding of the product. A page per module (purpose, capabilities, user types, business rules, data, connections, entry points, gaps), plus the user types, end-to-end flows and vocabulary; every line says where it came from, every page records the commit it was checked against. Load before explaining, planning or changing a module, when taking over or handing over a module, after a run changes one, and when you have just learned how part of the product works.
user-invocable: false
---

# The project brain

What the product **is** and how it **works**, built up as the work happens, so that a person taking
over a module — or writing the business study when the project ends — starts from understanding, not
from a cold read of the code. It belongs to **one person**: it ignores itself in git, because on many
teams one person uses AIDLC and the rest change the code by other means. That is also why freshness
is checked against git rather than trusted.

Script — `B` below: `node "${CLAUDE_PLUGIN_ROOT}/skills/brain/brain.mjs" <command> <workspace> … [--json]`

| Command | Gives |
|---|---|
| `init` | the folder, with the `.gitignore` that keeps it out of git |
| `modules` | candidate modules from the code's layout |
| `status` | every page and whether its code has moved since it was checked |
| `changes <page>` | the files that moved, and the `git diff` to read |
| `stamp <page>` | the page marked as checked against HEAD |
| `index` | `index.md` regenerated |
| `which <files…>` | the pages that cover those files, and the module a file sits in when no page does yet |
| `digest` | everything a business study is assembled from |

**Switched off** when `aidlc.config.json` has `"brain": { "enabled": false }`. Then nothing below
applies, and nothing writes to it.

## What goes here, and what does not

| Question | Lives in |
|---|---|
| What does this module do, for whom, under which rules? How do the modules connect? | **the brain** |
| What happened, when | `.aidlc/journal.md` |
| Why the code is like this | `docs/adr/` |
| An operational truth ("tests need the db container") | `.aidlc/facts.md` |
| Which functions, hooks and components exist | the reuse catalog (`aidlc:reuse`) |
| One person's preferences and corrections to Claude | `.aidlc/memory/` |

A brain page states what the business would recognise and points at code; it never lists code.

## Layout

```
.aidlc/brain/
  index.md           generated — every module, what it does, whether it is behind the code
  overview.md        the product: what it is, for whom, the problem it solves
  actors.md          user types and roles, and what each can do
  glossary.md        the domain's words, as this product uses them
  modules/<name>.md  one per module — ${CLAUDE_PLUGIN_ROOT}/templates/brain-module.md
  flows/<name>.md    a journey across modules (signup, checkout, refund): numbered steps, each naming its module
```

Module frontmatter: `module`; `paths`, the comma-separated folders it covers, relative to the
workspace (in poly they start with the repo folder, and one module may span repos:
`core-api/src/modules/auth, web/src/features/auth`); `checked`, set only by `stamp` (one commit, or
`repo@commit` per repo it spans); and `updated`. A flow page may carry `paths` too; without them it is
dated, not diffed.

## Every line says where it came from

| Tag | Meaning |
|---|---|
| `[code: path]` | observed in the code at that path |
| `[req: ID]` | intended — a work item, requirement or acceptance criterion |
| `[told: YYYY-MM-DD]` | a person said so (the user explained a rule in conversation) |
| `[assumed]` | your inference — **never** stated as fact in a study until a person confirms it |

Where `[req]` and `[code]` disagree, say so under **Gaps & questions**. That line is often the most
useful one on the page.

## Reading it

1. `index.md`, then only the pages for the modules the task touches. Never load the whole brain.
2. `status` — a page that is `behind`, `off-branch` or `unknown-commit` describes code that has moved.
   Run `changes <page>` and read that diff before relying on the page.
3. A page is a map, not the territory: confirm a line in the code it points at before acting on it.

## Writing it — what you learned, when you learned it

- **After a change you made lands in a module:** update the capabilities, rules, data and entry points
  it changed.
- **After reading code to answer a question:** add what you learned, if the page did not already say it.
- **When the user explains intent or a rule:** write it, tagged `[told: <date>]`.
- **When requirements arrive** (intake, grooming, a run's acceptance criteria): add the intended
  behaviour as `[req: ID]`.

Edit in place — a delta, not a rewrite. One fact per line. A line the code no longer supports is
corrected or removed, never contradicted by a second line. Keep a page under ~150 lines; past that,
split the module into narrower modules with narrower `paths`. Create a page that does not exist from
the template, then `index`.

**`stamp` only after reading everything `changes` listed** — it tells every later session the page
matches the code. An edit that covered part of what moved leaves `checked` alone.

**Never** write secrets, credentials, tokens, personal or customer data, or anything read from an env
file. Never write outside `.aidlc/brain/`, and never commit it.

## Growing it as work happens

The brain needs no `/aidlc:learn` to start: the first time work touches a module, that module gets a
page. Give `B which <ws> <files…>` the files the work touched. For a file under an existing page, update
that page. For a file in a module with no page yet (`which` names the module and its paths), `B init`,
then create the page from `${CLAUDE_PLUGIN_ROOT}/templates/brain-module.md` with those paths. Fill only
what this work taught you: a page that starts with three true lines beats one that guesses at ten.
Files `which` leaves unmapped are shared code; the reuse catalog covers them.

## After a run

The pipeline (`aidlc:run` → §10) teaches the brain what the item changed, from what it already holds —
the branch's diff and the item's acceptance criteria — without reading anything new:

1. `git diff --name-only <base>...HEAD` → `B which <ws> <those files>`.
2. For each page or new module: add or correct the capabilities, business rules, data and entry points
   the item changed (`[code: path]`), and the item's acceptance criteria as intent (`[req: <ID>]`).
   One line per behaviour, not per file.
3. **Stamp only when `B changes <ws> <page>` lists nothing but this branch's own files.** Then the page
   describes everything that moved. When a teammate's change is in the list too, leave `checked` alone:
   that part was not read, and the page has to keep saying so.
4. `B index <ws>`.

Re-read a page right before editing it: parallel runs in sprint worktrees share one brain.

## Handing over a module

"I'm taking over payments", "brief me on orders", "explain the auth module": answer from the brain
first. Read the page; if `status` says it is behind, read `changes` and correct the page, then stamp.
Add to it:
- the run files and open work items that touch its paths;
- its journal lines;
- the `[assumed]` lines and **Gaps & questions**, said out loud;
- who has worked on it lately (`git log --since="3 months ago" --format=%an -- <paths> | sort | uniq -c`).

The brief is: what the module is for, who uses it, its main flows and rules, what changed recently,
what is in flight, what is uncertain, and who to ask. No page yet → `/aidlc:learn <module>` is the brief.

## Refreshing a page

`changes <page>` → read the diff it prints → update the lines it affects, and remove what it
invalidated → `stamp <page>` → `index`. Refresh what the task needs; `/aidlc:learn --stale` does the rest.
