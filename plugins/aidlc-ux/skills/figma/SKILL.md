---
name: figma
description: Connect a project's Figma designs to the pipeline and keep them in sync — link a file/frame, inventory its screens, map them to routes, extract the spec and variables, and re-sync to detect design drift after the designer moves. Invoked as /aidlc-ux:figma; the design pod calls the same extraction when it builds a Figma-sourced surface.
argument-hint: [<figma-url> | sync | status] [screen or route]
---

# /aidlc-ux:figma $ARGUMENTS — link, extract, re-sync

Owns the **connection between a Figma file and this project**: which frames are the app's screens,
which routes they map to, what the design says, and whether the build has drifted from it. The
design pod (`aidlc-ux:design`) calls the same extraction when it builds a Figma-sourced surface —
run this directly when you want to link a file, refresh a spec, or see what changed in Figma.

Discipline: `aidlc-ux:figma-handoff` (read order, call budget, fidelity rules). Config: the `ux.figma`
block of `.claude/aidlc.config.json`.

**Mono vs poly.** In mono, `ux.figma` is the top-level block and the working dir is the repo root. In
poly, **each frontend repo carries its own `ux.figma`** under its `repos[]` entry (a monorepo package
may carry its own under `packages[]`) — different apps have different design files. Resolve the target
repo/package the way `aidlc-ux:design` does (passed in by `/aidlc:run`, or from `$ARGUMENTS`, or ask)
**before** reading or writing config, and write to that entry's `ux.figma`, not the top-level one.

## 0 · Connection check (always first)

Confirm the `figma` MCP is connected and authenticated — call `whoami`. Not connected or not
authenticated → report it and stop with the options from `aidlc-ux:figma-handoff` (authenticate via
`/mcp` → `figma`; or work from exported PNGs in `design/figma/`; or stay `generated`). Never proceed
as if a design were available when it isn't.

Note the seat/plan constraint out loud when a read fails on rate limits: Starter plans and
View/Collab seats get only a few Figma tool calls per month.

## Modes

### `status` (also the no-argument default)

Report, in ≤10 lines: whether the MCP is authenticated and as whom; the linked file (key + name) for
this repo/package; the screen→route map with each screen's last-extracted timestamp; whether
`design/figma-spec.md` exists and how it compares to the config's screen list; and anything obviously
stale (a mapped route with no built page, a built page with no mapped frame).

### `<figma-url>` — link (or re-link) a file

1. **Parse** the URL → `fileKey` (segment after `/design/`) and `node-id` if present.
2. **Inventory** — `get_metadata` on the file (or that node) → the frame tree. Identify the top-level
   frames that read as **screens** (page-sized frames), and separate out component/spec/scratch pages
   so they aren't mistaken for app screens.
3. **Map screens → routes.** Propose a mapping from frame names to the app's routes, grounded in the
   actual router (read the route files — `app/**/page.tsx`, route config, whatever the stack uses),
   not in name-similarity alone. Interactive → show the proposed map and let the user correct it.
   Non-interactive → take the confident matches, leave the rest unmapped, and list them.
4. **Write config** — `ux.figma`: `enabled: true`, `url`, `fileKey`, and `screens` (`route → node-id`)
   on the resolved repo/package entry. Preserve anything already there; never clobber a hand-edited
   map silently — report changed entries.
5. **Extract** the in-scope screens per §Extract below.

A URL with a `node-id` and an explicit screen/route argument links **just that frame**, adding it to
the map without re-inventorying the whole file.

### `sync` — re-extract and diff (the reason this command exists)

Designers move. `sync` re-reads the linked frames and tells you what changed since the last spec:

1. Re-run the extraction for every mapped screen (or just the one named in `$ARGUMENTS`).
2. **Diff against the current `design/figma-spec.md`** — per screen: layout/structure changes, changed
   or added/removed variables, new or removed states, new assets, and frames that no longer exist.
3. Write the refreshed spec, keeping the previous one as `design/figma/spec-prev.md` so the diff is
   reviewable in the PR.
4. **Report drift against the build**, not just against the spec: for each changed screen, name the
   implemented route/files that now disagree with the design. That list is the work — hand it to
   `/aidlc:intake` or `/aidlc-ux:design <route>` rather than silently editing screens here.
5. Removed or renamed frames are reported, never auto-deleted from the map — a designer's rename is
   not a deletion, and only a human can tell them apart.

`sync` is a **read + report** operation. It updates the spec and the map; it does not touch product
code.

## Extract (shared by every mode, and by the design pod)

Dispatch **Agent → aidlc-figma** with: the resolved repo/package and its working dir, the `fileKey`,
the in-scope node ids, the run file (if any), and the spec template. It performs the read order in
`aidlc-ux:figma-handoff` — `get_design_context` per node, `get_screenshot` per frame,
`get_variable_defs` once — and writes `design/figma-spec.md` plus reference shots to `design/figma/`.
It never edits product code.

Where the file consumes a shared library or the project has Code Connect wired, the extraction records
which frames are **library instances mapped to existing components** — those get reused, not rebuilt.

## Handoff

End by stating what a caller should do next, concretely:
- linked and extracted, nothing built yet → `/aidlc-ux:design <route>` (or `/aidlc:run <ID>` for a
  tracked item) builds it to the spec;
- `sync` found drift → the per-route list of what disagrees, and the command that fixes each;
- nothing changed → say so in one line. Don't manufacture work.

Mention the jury only as an **offer**, never as a pending gate: a Figma-sourced surface is judged on
fidelity to the design, and the jury is opt-in (`ux.figma.jury`, default `suggest`).

## Hard rules

- Config writes go to the **resolved** repo/package entry, and only the `ux.figma` block.
- Never auto-delete or auto-rename a mapping; report and let the human decide.
- Never extract the whole file speculatively — inventory first, then pull only in-scope nodes
  (the call budget is real).
- This command never edits product code. Extraction and reporting only.
