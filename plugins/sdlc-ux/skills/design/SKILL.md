---
name: design
description: Run the UI/UX design pod on a new OR existing frontend — a single page/screen or the whole app. Narrative → inspiration → design system → build/redesign + motion → strict jury loop until the rendered UI scores ≥ threshold (default 9/10). Accepts brand references (logo, colors, fonts, reference screenshots). Invoked as /sdlc-ux:design and called by /sdlc:run for UI items.
argument-hint: <id | page/route | path | "redesign X" | description>  [+ brand refs]
---

# /sdlc-ux:design $ARGUMENTS — the design pod pipeline

You are driving the **UX pod**: a narrative writer, an inspiration researcher, a design-system
owner (the uniformity anchor), a motion specialist, and a strict, unbiased jury. You do not design
or code yourself — you dispatch the specialists and run the jury loop to the quality bar. Runs in
the main session (subagents can't spawn subagents), same as `/sdlc:run`.

Config: read `.claude/sdlc.config.json` → `ux` block (`juryThreshold` default 9, `maxJuryRounds`
default 3, `juryPanelSize` default 1, `renderBaseUrl`, `target` `desktop-web`, `uiPaths`, and
`brand`). Missing block → use defaults and note it.

## 0 · Scope, mode & brand intake (do this first)

**Resolve the target scope** from `$ARGUMENTS`:
- a **page/route/screen** (e.g. `/dashboard`, `app/settings/page.tsx`) → scope = that surface;
- a **path/glob** → scope = those files;
- **"the whole thing" / "entire app" / a whole-project story** → scope = all `uiPaths`;
- a **plain description** → route through `sdlc:intake` first (if core is present) to get an item,
  then design its surface.
Record the scope in the run file.

**Detect the mode:**
- `greenfield` — no established design system exists in the project (no `design/design-system.md`
  and no theme/tokens in code). You **establish** the system and it becomes the project standard.
- `retrofit` — existing project, scope is a subset (one page/screen/component). You **adopt the
  project's established system first**, then redesign the target to the bar *within* that system so
  it stays uniform with the rest of the app.
- `redesign` — existing project, scope is the whole app OR the user explicitly said "redesign
  everything". You may **replace** the system, then propagate across all surfaces.
When unsure between retrofit and redesign, default to retrofit (least disruptive) and say so.

**Brand intake.** Collect brand anchors from, in priority order: (1) references the user passed in
`$ARGUMENTS` (image paths, hex values, font names, a screenshot of a logo/type); (2) files in
`ux.brand.referenceDir` (default `design/brand/`); (3) the `ux.brand` config (`logo`, `palette`,
`fonts`, `guidelines`). Resolve each to a concrete path/value and **Read any images yourself** to
confirm they exist. Write a short `design/brand.md` cataloguing what was supplied and what it
constrains. If brand anchors exist, they are **hard constraints**, not inspiration — pass them into
every downstream brief (writer, researcher, design-system, jury). None supplied → note it; the pod
derives its own palette/type.

## Run-file continuity

Launched by `/sdlc:run` → reuse the item's `.sdlc/runs/{ID}.md`; don't create a second. Standalone →
create a lightweight run file (id `UX-<slug>`) so scope, mode, brand, rounds and scores are
auditable. Checkpoint before and after every agent.

## Pipeline

**0 · AUDIT** *(existing surfaces only — skip for greenfield)*. Render the current target at
`renderBaseUrl` via the Playwright MCP (start the dev server if needed) and screenshot it to
`design/audit/`; also screenshot 1–2 sibling pages so you know what "consistent with the rest"
means. Dispatch **Agent → sdlc-design-system** in **audit mode** with those shots + the code: it
extracts the *current* design language (colors/type/spacing actually in use + where they live),
flags inconsistencies, and recommends **conform / elevate-in-place / replace**. If a scoped
retrofit's own established system is already below bar, surface that to the user — full redesign is
their call. Save the audit to `design/audit.md`.

**1 · NARRATIVE.** Dispatch **Agent → sdlc-ux-writer** → `design/narrative.md`. Brief includes the
mode, scope, brand anchors, and (for existing) the audit. On retrofit, the narrative must respect
what's preserved (logo, brand color, established patterns) while elevating the target. North star
for everything below.

**2 · RESEARCH.** Dispatch **Agent → sdlc-ux-researcher** (serving the narrative + brand) →
`design/inspiration.md`. Skip only if the item forbids external research; note the skip.

**3 · DESIGN SYSTEM.** Dispatch **Agent → sdlc-design-system**:
- `greenfield` → establish the canonical system at the project root (`design/design-system.md` +
  token files) — this is now the standard every future UI item adopts.
- `retrofit` → **adopt & extend** the established/audited system; apply brand anchors; add only
  what the target needs. Never fork a second system.
- `redesign` → evolve or replace the system, then it becomes the new standard.
Brand anchors (logo palette, fonts) are built in as hard constraints; WCAG-AA verified. Output is
the uniformity contract for the build.

**4 · BUILD + MOTION.** Apply the system to the target and layer motion:
- Invoked by `/sdlc:run`: core implementer builds/edits structure; here dispatch
  **Agent → sdlc-motion** for animation/interactions per `design/motion-spec.md`.
- Standalone greenfield: implementer (if core present) builds structure, then sdlc-motion.
- Standalone retrofit/redesign: the change is *editing existing screens* onto the system —
  dispatch the implementer to refactor components onto tokens + apply the new layout, then
  sdlc-motion; or sdlc-motion alone when only motion is being elevated.
Components MUST consume tokens — no ad-hoc colors/spacing, and no drift from the established system.

**5 · JURY LOOP.** `round = 1`.
1. Ensure the app renders at `renderBaseUrl` (start dev server if down; wait until it responds;
   record the URL). Un-renderable → phase `blocked`, report, STOP — the jury can't judge what
   won't render.
2. Dispatch **Agent → sdlc-ux-jury** (fresh context, blind to the makers' notes). Brief gives it the
   target scope, the brand anchors, and — for retrofit/redesign — the sibling-page shots so it can
   score **cross-page consistency + brand adherence**, not just the target in isolation. For
   `juryPanelSize > 1`, dispatch that many jurors in one parallel batch and average composites; keep
   every report.
3. Composite **≥ juryThreshold** → PASS. Go to **6**.
4. Below AND `round < maxJuryRounds` → increment `round`; route each required fix to its owner
   (**sdlc-design-system** / **sdlc-motion** / implementer) in one batch scoped to ONLY those
   defects; re-run this loop (re-render, re-judge fresh). Never regress the "what's working" list.
5. Below AT `maxJuryRounds` → **stop iterating** (cost guardrail). Keep the highest-scoring round,
   attach the remaining critique to `## Findings` as `[MAJOR][open] jury: …`, flag for human. Do NOT
   loop past the cap; NEVER escalate any agent to a larger model to chase the score.

**6 · HANDBACK.** Tear down any dev server you started. Append a `## Log` summary: mode, scope,
rounds, final composite, bar met?, artifact paths (`design/*`). Return to the caller: score,
PASS/CAPPED, mode, and artifact paths. Standalone → also give the ≤6-line user summary.

## Invariants

- **One system per project.** Greenfield establishes it; retrofit/redesign adopt or evolve it —
  never silently create a second, divergent system. A surface that drifts from the established
  system is a jury **Consistency** defect.
- **Brand anchors are hard constraints.** A supplied logo colour, font, or guideline is honored
  exactly, not "taken as inspiration".
- The design system is the single source of truth; a raw hex/off-scale px literal in a component is
  a jury defect, not an accepted exception.
- The jury is never shown who made what or their reasoning — protect its independence.
- Respect `maxJuryRounds` absolutely. The bar is ≥ threshold *or* an honest, human-flagged handback.
- Checkpoint the run file around every dispatch; keep your own context lean (verdicts + pointers).
