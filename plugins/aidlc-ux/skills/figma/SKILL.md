---
name: figma
description: Connect a project's Figma files to the pipeline and keep them in sync — link screens or a design system, scope which pages count, map frames to routes, extract the spec, variables and component inventory, and re-sync to detect drift after the designer moves. Invoked as /aidlc-ux:figma; the design pod calls the same extraction when it builds a Figma-sourced surface or adopts a Figma design system.
argument-hint: [<figma-url> | sync | status] [--system] [screen or route]
---

# /aidlc-ux:figma $ARGUMENTS — link, extract, re-sync

Owns the **connection between Figma and this project**, for two kinds of file:

- **Screens** — which frames are the app's screens, which routes they map to, what the design says,
  and whether the build has drifted from it.
- **A design system** — the brand's UI kit: which pages are canonical, what the variables and
  components are, and which frontends must follow them.

A project can have one, both, or neither, and they can be two separate files. The design pod
(`aidlc-ux:design`) calls the same extraction when it builds a Figma-sourced surface or adopts a
Figma design system — run this directly to link a file, refresh an extraction, or see what changed.

Discipline: `aidlc-ux:figma-handoff` (read order, page scoping, call budget, fidelity and compliance
rules). Config: the `ux.figma` block of `.claude/aidlc.config.json` — `url`/`fileKey`/`screens`
describe the **screens** file; `designSystem` describes the **system** file.

**Mono vs poly — and the one thing that isn't per-repo.** In mono, `ux.figma` is the top-level block
and the working dir is the repo root. In poly, **each frontend repo carries its own `ux.figma`** under
its `repos[]` entry (a monorepo package may carry its own under `packages[]`) — different apps have
different *screen* files. Resolve the target repo/package the way `aidlc-ux:design` does (passed in by
`/aidlc:run`, or from `$ARGUMENTS`, or ask) **before** reading or writing config.

**`designSystem` is the deliberate exception.** One brand, one system, many apps: a design system with
`scope: "workspace"` is declared **once in the top-level `ux.figma.designSystem`**, even in poly, and
every frontend derives from it. Resolution is repo entry first, then the top-level block. A repo that
genuinely has its own system (an acquired product mid-migration) overrides it locally and says why.

## 0 · Connection check (always first)

Confirm the `figma` MCP is connected and authenticated — call `whoami`. Not connected or not
authenticated → report it and stop with the options from `aidlc-ux:figma-handoff` (authenticate via
`/mcp` → `figma`; or work from exported PNGs in `design/figma/`; or stay `generated`). Never proceed
as if a design were available when it isn't.

Note the seat/plan constraint out loud when a read fails on rate limits: Starter plans and
View/Collab seats get only a few Figma tool calls per month.

## Modes

### `status` (also the no-argument default)

Report, in ≤10 lines: whether the MCP is authenticated and as whom; the linked file(s) — screens
and/or design system — for this repo/package; the screen→route map with each screen's last-extracted
timestamp; for a system, its canonical pages, variable count and how many components are detailed vs
inventory-only; whether `design/figma-spec.md` / `design/figma-system.md` match the config; and
anything obviously stale (a mapped route with no built page, a built page with no mapped frame, a
frontend not yet derived from the workspace system).

### `<figma-url>` — link (or re-link) a file

1. **Parse** the URL → `fileKey` (segment after `/design/`) and `node-id` if present. Drop the
   sender's editor params (`p`, `t`, view state); never store a URL carrying a `t=` share token.
2. **Decide what the file _is_ — screens or a design system — before extracting anything.**
   `get_metadata` gives the page list and enough structure to tell. It reads as a **design system**
   when the file is named like one, its pages are `Foundations`/`Tokens`/`Components`/`Patterns`/
   `Design System`, its content is component sets and specimen grids rather than page-sized artboards,
   or `get_libraries` shows it published. **State your read and have it confirmed** — an explicit
   `--system` (or `--screens`) in `$ARGUMENTS` settles it without asking. One file can be both: pages
   hold the system, other pages hold screens.
3. **Scope the pages** *(system files — the step that matters most)*. Present every page with a
   recommendation and a reason, and ask about the **exclusions** explicitly — "is `Components v2` the
   live set or a draft?" is the question that stops the whole app being built on a draft. A cover /
   thumbnail page is usually **in** scope (it carries the brand mark and the system's register);
   explorations, WIP, archive and deprecated pages are **out**. Store the confirmed list; from then
   on, anything outside it does not exist.
4. **Map screens → routes** *(screen files)*. Propose a mapping from frame names to the app's routes,
   grounded in the actual router (read the route files — `app/**/page.tsx`, route config, whatever the
   stack uses), not name-similarity alone. Interactive → show the proposed map and let the user
   correct it. Non-interactive → take the confident matches, leave the rest unmapped, and list them.
5. **Write config**, preserving anything already there and reporting every changed entry — never
   clobber a hand-edited map silently:
   - screens → `ux.figma`: `enabled: true`, `url`, `fileKey`, `screens` (`route → node-id`) on the
     resolved repo/package entry;
   - a system → `ux.figma.designSystem`: `url`, `fileKey`, `pages`, and `scope`. Ask whether it
     applies **workspace-wide** (the normal case — one brand, several frontends) and if so write it to
     the **top-level** block, then say which repos now derive from it.
6. **Extract** per §Extract below.

A URL with a `node-id` and an explicit screen/route argument links **just that frame**. Pointing at a
single component inside a system file means "here is the system", not "build this component" — resolve
the file first (step 2), then treat the node as where the sender happened to be looking.

### `sync` — re-extract and diff (the reason this command exists)

Designers move. `sync` re-reads what's linked and tells you what changed since the last extraction.

**Screens:** re-extract every mapped screen (or the one named in `$ARGUMENTS`) and diff against
`design/figma-spec.md` — layout/structure changes, added/changed/removed variables, new or removed
states, new assets, frames that no longer exist.

**A design system:** re-read the canonical pages and diff against `design/figma-system.md` — changed
or retired **variables** (the highest-blast-radius change there is), new/changed/removed
**components**, new pages that may need scoping, and a page that vanished. Then go further, because a
system change is a **workspace event**:

- name **every frontend** that derives from this system and is now out of date — not just the repo you
  happen to be standing in;
- for a changed variable, name the token it maps to and the repos whose token files must be
  regenerated;
- for a changed or retired component, name the code counterpart and its call sites.

In both cases: write the refreshed extraction, keep the previous one as `design/figma/spec-prev.md` /
`design/figma/system-prev.md` so the diff is reviewable in the PR, and **report drift against the
build**, not just against the file. That drift list is the work product — hand it to `/aidlc:intake`
or `/aidlc-ux:design <route>` rather than silently editing screens here. Removed or renamed
frames/components/pages are reported, never auto-deleted: a designer's rename is not a deletion, and
only a human can tell them apart.

`sync` is a **read + report** operation. It updates the extractions and the map; it does not touch
product code.

## Extract (shared by every mode, and by the design pod)

Dispatch **Agent → aidlc-figma** with the resolved repo/package and its working dir, the `fileKey`,
the run file (if any), and the template. It performs the read order, the call budget and the two-wave
library extraction defined in `aidlc-ux:figma-handoff` — those rules live there, not here, so the
command and the agent cannot drift apart. Brief it with:

- **Screens mode** — the in-scope node ids + `templates/figma-spec.md`. Output: `design/figma-spec.md`
  + reference shots in `design/figma/`.
- **Library mode** — the canonical page list + the workspace scope + `templates/figma-system.md`.
  Output: `design/figma-system.md` + component shots in `design/figma/system/`.

After a **system** extraction, hand off to **Agent → aidlc-design-system** in *figma-library mode* to
write `design/design-system.md` and emit the project's tokens from it. One system per project.

## Handoff

End by stating what a caller should do next, concretely:
- **screens** linked and extracted, nothing built yet → `/aidlc-ux:design <route>` (or
  `/aidlc:run <ID>` for a tracked item) builds it to the spec;
- **a system** linked and extracted → the tokens are emitted and every future UI item builds within
  it; name any frontend still to be brought onto it, and any conflict a human must settle;
- `sync` found drift → the per-route (or per-repo, for a system) list of what disagrees, and the
  command that fixes each;
- nothing changed → say so in one line. Don't manufacture work.

Mention the jury accurately for the case at hand: on a **Figma-sourced screen** it's an offer, never a
pending gate (fidelity is the gate; `ux.figma.jury` defaults to `suggest`). With **only a Figma
system**, the screens are still the pod's to design, so the jury gates exactly as it always did —
judging composition, with off-system values counted as defects rather than preferences.

## Hard rules

- Config writes go to the **resolved** repo/package entry — except a workspace-scoped `designSystem`,
  which belongs in the top-level block — and only within `ux.figma`.
- Never auto-delete or auto-rename a mapping, a component or a page; report and let the human decide.
- Never widen the canonical page list on your own, and never extract the whole file speculatively —
  inventory first, then pull only what's in scope (the call budget is real).
- This command never edits product code. Extraction and reporting only.
