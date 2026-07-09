---
name: design
description: Run the UI/UX design pod on a work item or a frontend surface — narrative → inspiration research → design system → build + motion → strict jury loop until the rendered UI scores ≥ threshold (default 9/10). Use for UI-touching stories, or standalone to elevate an existing frontend. Invoked as /sdlc-ux:design and called by the /sdlc:run orchestrator for UI items.
argument-hint: <work-item-id | path | description>
---

# /sdlc-ux:design $ARGUMENTS — the design pod pipeline

You are driving the **UX pod**: a narrative writer, an inspiration researcher, a design-system
owner (the uniformity anchor), a motion specialist, and a strict, unbiased jury. You do not design
or code yourself — you dispatch the specialists and run the jury loop to the quality bar. This runs
in the main session (subagents can't spawn subagents), same as `/sdlc:run`.

Config: read `.claude/sdlc.config.json` → `ux` block (`juryThreshold` default 9, `maxJuryRounds`
default 3, `juryPanelSize` default 1, `renderBaseUrl`, `target` `desktop-web`, `uiPaths`). Missing
`ux` block → use those defaults and note it.

## Run-file continuity

If launched by `/sdlc:run`, reuse the item's existing `.sdlc/runs/{ID}.md` and append; don't create
a second one. Standalone on a path/description → create a lightweight run file (id `UX-<slug>`) so
rounds and jury scores are auditable. Checkpoint before and after every agent, same as the core
orchestrator.

## Pipeline

**1 · NARRATIVE.** Dispatch **Agent → sdlc-ux-writer** → `design/narrative.md`. This is the north
star; everything below must trace to it.

**2 · RESEARCH.** Dispatch **Agent → sdlc-ux-researcher** (serving the narrative) →
`design/inspiration.md` with cited, transferable techniques + distilled directions. (Skip only if
the item explicitly forbids external research; note the skip.)

**3 · DESIGN SYSTEM.** Dispatch **Agent → sdlc-design-system** → tokens emitted to code
(`design/design-system.md` + the actual token files) with WCAG-AA contrast verified. This is the
uniformity contract for everything after it.

**4 · BUILD + MOTION.** Build the UI against the tokens, then layer motion:
- If invoked by `/sdlc:run`, the core implementer builds structure/screens first; here you dispatch
  **Agent → sdlc-motion** to add animation/interactions per `design/motion-spec.md`.
- Standalone, dispatch the implementer (if the core plugin is present) for structure, then
  sdlc-motion; or sdlc-motion alone when elevating an already-built surface.
Components MUST consume tokens — no ad-hoc colors/spacing.

**5 · JURY LOOP.** `round = 1`.
1. Ensure the app is rendering at `renderBaseUrl` — start the dev server in the background if it
   isn't up (per the project's run command), wait until it responds, and record the URL. If it
   cannot be served, phase `blocked`, report, STOP (the jury can't judge what won't render).
2. Dispatch **Agent → sdlc-ux-jury** (fresh context, blind to the makers' notes). For
   `juryPanelSize > 1`, dispatch that many jurors in one parallel batch and average their
   composites; keep every juror's report.
3. Composite **≥ juryThreshold** → jury PASS. Go to **6**.
4. Below threshold AND `round < maxJuryRounds` → increment `round`; route each required fix to its
   owner (**sdlc-design-system** / **sdlc-motion** / implementer) in one batch scoped to ONLY those
   defects; then re-run this jury loop (re-render, re-judge fresh). Never let a fix round regress
   the "what's working" list.
5. Below threshold AT `maxJuryRounds` → **stop iterating** (cost guardrail). Keep the
   highest-scoring round as the deliverable, attach the latest jury report's remaining critique to
   the run file's `## Findings` as `[MAJOR][open] jury: …`, and flag for human review. Do NOT loop
   past the cap, and NEVER escalate any agent to a larger model to chase the score.

**6 · HANDBACK.** Tear down any dev server you started. Append a `## Log` summary: rounds run, final
composite, whether the bar was met, artifact paths (`design/*`). Return to the caller: final score,
PASS/CAPPED, and the design-artifact paths. Standalone → also give the ≤6-line user summary.

## Invariants

- The design system is the single source of truth; a raw hex/off-scale px literal in a component is
  a jury defect, not an accepted exception.
- The jury is never shown who made what or their reasoning — protect its independence; don't paste
  maker self-assessments into its brief.
- Respect `maxJuryRounds` absolutely. The bar is ≥ threshold *or* an honest, human-flagged handback —
  never an endless or model-escalating loop.
- Checkpoint the run file around every dispatch; keep your own context lean (verdicts + pointers).
