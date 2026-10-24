# /aidlc:run — UI items and the design pod

Read from `aidlc:run` §2 when any UI signal fires (to apply the scaffold gate and record the design
inputs), and at §6 to hand the item to the design pod. Part of the run skill, kept apart so that
backend and infra runs do not load it.

## Scaffold-scope gate

**Scaffold-scope gate (deterministic — don't burn the pod on an empty shell).** A frontend/`ux.enabled`
repo is NOT enough to fire the pod: a **scaffold/skeleton** item renders no real UI surface yet. Set
`ui: false` (skeleton-only, jury skipped) — **even in a UI repo** — when the item reads as scaffold,
i.e. *any* of: minimal-shell / bootstrap / "stand up the app" scope with **no named page/route/screen**
to design; **functional-only** DoD/AC (builds, routes, lints, a placeholder/health page renders — no
visual/interaction/UX criteria); `ux.uiPaths` empty or pointing only at not-yet-built placeholders; or
the item is labeled/titled `scaffold`/`skeleton`/`bootstrap`/`init`/`wiring`. Conversely `ui: true`
when a concrete page/route/component is named or the AC ask for visual/layout/motion/UX quality (not
just "it renders"). **Ambiguity errs toward `ui: true`** — the scaffold read must be *clear* to skip.
This is the **same rule in interactive and non-interactive (`/aidlc:sprint`, headless) modes**: headless
applies it with no prompt; interactive may surface it as a confirmable *"Skeleton only [recommended] vs
Full design pod"* recommendation, but the recommendation is not the only gate. (Mirrors
`aidlc-ux:design` → *Pod-scope gate*, the pod's own view of the same contract.)

## What to resolve and record when `ui: true`

When true, also resolve and record on the run file:
- **scope** — a specific page/route/component named by the item, else the whole app;
- **mode** — `greenfield` only when the frontend has **no established system at all**: no
  `design/design-system.md` **and** no theme/tokens/component library in code (a Tailwind theme, CSS
  variables, a `components/ui` folder — `aidlc:reuse` → `catalog.mjs query <repo> component ui theme`
  shows it). Otherwise `retrofit` for a scoped surface, or `redesign` if the item asks to redo the whole
  app. Reading only for the design file classed every app that had never met the pod as greenfield, and
  the pod then built a second design system beside the one already in the code;
- **brand** — whether `ux.brand` config or `design/brand/` holds anchors to honor;
- **designSource** — `figma` when the screens already exist in Figma (the resolved repo/package has
  `ux.figma.enabled` with a `fileKey`, OR the item/AC/attachments carry a `figma.com/design/…` URL,
  OR `design/figma-spec.md` already covers this surface), else `generated`. This is not a detail: on
  `figma` the pod **implements an approved design** — tokens are extracted from the file, there's no
  narrative/inspiration phase, the gate is fidelity to the design, and the **jury is optional**
  (`ux.figma.jury`, default `suggest`). Record the file key and the node ids for the scoped screens
  where the map has them. Mixed scope is normal — a mapped route runs the Figma track, an unmapped one
  the generated track. (`aidlc-ux:design` §0.5.)
- **systemSource** — `figma` when the **design system** lives in Figma (`ux.figma.designSystem` on the
  resolved repo/package, else the **top-level** block — one brand, many apps, so a workspace-scoped
  system is declared once even in poly — or an existing `design/figma-system.md`), else `project`.
  Independent of `designSource`: the common enterprise case is a brand handing over a UI kit and no
  mockups (`systemSource: figma` + `designSource: generated`). The pod then still designs the screens
  and **the jury still gates** — but the values are given, so an off-system colour, space or
  re-invented component is a Consistency defect rather than a preference.

## Design pod handoff (§6)

**UI items → design pod.** If the run file's `ui:` flag (set at §2) is **true**: once
backend/structure is in place, hand the frontend off by following `aidlc-ux:design` for this item's
run file, passing the **scope, mode, brand, designSource and systemSource** you recorded at §2 — and,
in poly, the **resolved frontend repo** (its `path` as the working dir). The pod resolves the render
URL from the repo itself and fails loud rather than judging the wrong server (F13 — the protocol is
`aidlc-ux:design-jury` → *Render & evidence protocol*; core does not restate it). It runs
narrative → research →
design system → (build/redesign +) motion, then the **jury loop to `ux.juryThreshold` (default 9),
capped at `ux.maxJuryRounds`**. Its `[open]` jury findings join `## Findings` and gate the PR the
same as reviewer/QA findings.

**`systemSource: figma` changes what the design system is, not what the gate is.** The pod extracts
the brand's design-system file once (canonical pages only) into `design/figma-system.md`, emits the
project's whole token layer from its variables, and wires up the components it defines — then designs
the screens within that vocabulary and runs the **normal jury loop**. The system being given doesn't
lower the bar; it fixes the palette, type, spacing and components the bar is met with. Off-system
values and re-invented components are Consistency defects. In a workspace-scoped system every
frontend derives from the same extraction, so a system change makes every frontend stale at once —
`/aidlc-ux:figma sync` names them.

**`designSource: figma` changes what the gate is.** The pod extracts the design through the Figma MCP
(spec + variables + reference shots), maps the variables onto the project's tokens, builds to the
spec, and then runs the **fidelity check** instead of the jury: pass is **zero blocking deviations**
from the design, capped at `ux.figma.maxFidelityRounds` (default 2). Its `[open]` fidelity findings
join `## Findings` and gate the PR exactly as jury findings do. The **jury does not gate here** — the
design was approved outside this session, so it's offered (`ux.figma.jury: suggest`, the default) and
skipped without prompting on a headless/sprint run; when it does run it's advisory and never triggers
a redesign. If the Figma MCP is unreachable or unauthenticated, the pod **blocks and says so** rather
than inventing a design — treat it like any other blocked run (report, `## Findings`, stop); it is
never "solved" by letting the pipeline design the screens itself.

**Scaffold owns the port (F13).** When the implement phase **scaffolds a UX repo and assigns its
dev-server port** (e.g. picks :3100 to avoid colliding with an API on :3000), write that port back to
the repo's `ux.renderBaseUrl` in `aidlc.config.json` (the scaffold owns the port, so it owns the config
value) and **flag any cross-repo port collision**. This keeps the jury's fallback honest even before it
derives the port itself.
- If `ui: true` but `aidlc-ux` is not installed, build the UI with the implementer as usual and note
  in `## Findings` that the design gate was unavailable (so a human knows it shipped un-judged).
- `ui: false` items skip the pod entirely.
