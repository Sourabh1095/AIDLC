---
name: design
description: Run the UI/UX design pod on a new OR existing frontend — a single page/screen or the whole app. Screens already in Figma → extract the design, build to it, check fidelity (jury optional). No designs → narrative → inspiration → design system → build/redesign + motion → strict jury loop until the rendered UI scores ≥ threshold (default 9/10). Accepts brand references (logo, colors, fonts, reference screenshots) and Figma URLs. Invoked as /aidlc-ux:design and called by /aidlc:run for UI items.
argument-hint: <id | page/route | path | "redesign X" | figma-url | description>  [+ brand refs]
---

# /aidlc-ux:design $ARGUMENTS — the design pod pipeline

You are driving the **UX pod**: a Figma handoff specialist, a narrative writer, an inspiration
researcher, a design-system owner (the uniformity anchor), a motion specialist, a fidelity checker
and a strict, unbiased jury. You do not design or code yourself — you dispatch the specialists and
run the pipeline's gate to the quality bar. Runs in the main session (subagents can't spawn
subagents), same as `/aidlc:run`.

Config: read `.claude/aidlc.config.json` → `ux` block (`juryThreshold` default 9, `maxJuryRounds`
default 3, `juryPanelSize` default 1, `renderBaseUrl`, `target` `desktop-web`, `uiPaths`, `brand`,
and `figma`). Missing block → use defaults and note it.

**What already exists decides what you do.** Two independent questions, both answered in §0.5 before
anything else: do the **screens** exist (in Figma) — then you implement rather than invent, and the
gate is fidelity; and does the **design system** exist (in Figma, or in code) — then the values are
given and your creative work is composition within them. A project can have both, either, or neither.

**Mono vs poly — which `ux` block, which working dir.** In **mono** the settings above are the
top-level `ux` block and the working dir is the repo root. In **poly** the top-level `ux` block is
empty — each frontend repo carries its own `ux` under its `repos[]` entry (see `aidlc:work-items` →
*Repos & routing*). When `/aidlc:run` invokes the pod for a UI item it passes the **resolved frontend
repo** (from `aidlc:run` §2.5): operate with **cwd = `workspace.root`/`<repo.path>`** and read
`renderBaseUrl` / `uiPaths` / `target` / `brand` / `figma` (and the jury settings) from **that repo
entry's `ux`**, not the top-level block — every `renderBaseUrl` reference below means that repo's, and
different apps legitimately have different Figma files. All `design/*` artifacts and the dev server
live in that repo's checkout. Standalone in a poly workspace
with no repo passed → resolve the target repo from `$ARGUMENTS` (a path under a repo) or ask which
repo, before anything else.

## 0 · Scope, mode & brand intake (do this first)

**Resolve the target scope** from `$ARGUMENTS`:
- a **page/route/screen** (e.g. `/dashboard`, `app/settings/page.tsx`) → scope = that surface;
- a **path/glob** → scope = those files;
- **"the whole thing" / "entire app" / a whole-project story** → scope = all `uiPaths`;
- a **plain description** → route through `aidlc:intake` first (if core is present) to get an item,
  then design its surface.
Record the scope in the run file.

**Pod-scope gate — scaffold/skeleton vs real UI surface (decide right after scope).** Not every item
in a frontend repo warrants the pod. The full pod (narrative → inspiration → design system → build +
motion → jury) is reserved for a **real UI surface**; a **scaffold/skeleton** scope gets
**skeleton-only** treatment — `ui:false`, jury skipped — where the core implementer builds the
functional shell and the pod does not design an empty app.
- **Reads as scaffold/skeleton → skeleton-only** when any hold: the scope is a minimal shell /
  bootstrap / "stand up the app" with **no named page/route/screen** to design; the item's DoD/AC are
  **functional-only** (it builds, routes, lints, a placeholder/health page renders) with no
  visual/interaction/UX acceptance criteria; `ux.uiPaths` is empty or points only at not-yet-built
  placeholders (no real surface exists yet); or the item is labeled/titled scaffold / skeleton /
  bootstrap / init / wiring.
- **Reads as a real UI surface → full pod** when any hold: the scope names a concrete
  page/route/screen/component to design or redesign; the AC/DoD ask for visual, layout, styling,
  motion or UX quality (not just "it renders"); or `ux.uiPaths` resolves to actual surfaces with
  content to judge.
- **Genuine ambiguity errs toward the full pod** — a wrongly-skipped surface ships un-judged UI,
  which is worse than an over-invoked jury. The scaffold read must be *clear* to skip.

**This gate is deterministic and is the default in both modes:**
- **Non-interactive (headless / `/aidlc:sprint`):** apply it as-is — scaffold read → skeleton-only
  with no prompt; real UI surface → full pod. A batched sprint never burns a full design-pod run on
  an empty shell.
- **Interactive (`/aidlc:run`, standalone `/aidlc-ux:design`):** apply the **same** default, surfaced
  as a *confirmable recommendation* ("Skeleton only [recommended] vs Full design pod"). The prompt is
  a confirmation, not the only gate; unattended, the default stands.

**Contract with core.** `/aidlc:run` §2 (UI detection) and `/aidlc:sprint` consume this exact gate to
set the run file's `ui:` flag: a scaffold/skeleton scope → `ui:false` (skeleton-only, jury skipped)
**even in a `ux.enabled` frontend repo**; a real UI surface → `ui:true` → invoke this pod. If core
already set `ui:false`, the pod isn't invoked; if invoked standalone on a scope that reads as a
scaffold, the pod self-applies this gate and returns skeleton-only rather than designing a shell.

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
derives its own palette/type. On `designSource: figma` (next) the **file itself is the brand source** —
supplied anchors then only cover what Figma doesn't (a favicon, an untouched marketing page); an
anchor that *contradicts* the design is a question for the human, not a licence to override the
approved screens.

## 0.5 · Sources — what already exists (resolve before the pipeline)

Two independent axes. Record both on the run file; they select different phases and different gates.

| | `designSource` — the screens | `systemSource` — the values |
|---|---|---|
| `figma` | drawn in Figma → build to them, gate on **fidelity** | tokens + components from a Figma design-system file |
| `generated` / `project` | the pod designs them → gate on the **jury** | the pod invents or audits the system |

All four combinations occur, and the middle one is the common enterprise case: **a brand hands you a
design system, not mockups.**

### `designSource` — are the screens drawn?

Record `designSource: figma | generated`. It is **`figma`** when any of these hold:
- `ux.figma.enabled` is true for the resolved repo/package and it has a `fileKey`/`url`;
- `$ARGUMENTS`, the item, or its AC carry a **Figma URL** (`figma.com/design/<fileKey>/…`) or
  attachment;
- `design/figma-spec.md` already covers this surface;
- the user says the designs exist / "build the Figma".

Otherwise **`generated`** — today's invent-it pipeline, unchanged.

**Why the fork is hard.** A Figma design has already been decided and usually signed off by someone
who isn't in this session. On `figma` you implement it: tokens are **extracted**, not invented; there
is no narrative or inspiration phase to justify choices that were already made; and the gate is
**fidelity to the design**, not taste — the jury is optional (see F5). On `generated` nothing
changes. Never blend them: a Figma-sourced surface does not also get a narrative-driven re-invention
of its palette.

**Verify the connection before you promise a Figma build.** Check the `figma` MCP (`whoami`). If it's
unreachable or unauthenticated, **stop and report** — options are: authenticate (`/mcp` → `figma`,
OAuth); work from exported PNGs the user drops in `design/figma/` (say plainly that it's screenshots
only — no variables, no exact values); or the user explicitly chooses `generated`. Silently falling
back to inventing a design is the worst failure mode here: it looks like success and ships something
the client never approved. Discipline: `aidlc-ux:figma-handoff`.

**Partial Figma is normal.** Some surfaces are drawn, some aren't. Resolve the source **per surface
in scope**, not per project — a mapped route runs the Figma track, an unmapped one runs the generated
track under the same design system, and the run file records which was which.

### `systemSource` — is the design system given?

Record `systemSource: figma | project`. It is **`figma`** when a design-system file is linked for this
repo/package (`ux.figma.designSystem`, resolved **repo entry first, then the top-level block** — one
brand, many apps, so a workspace-scoped system is declared once), when `$ARGUMENTS` or the item carry
a URL to a file that reads as a UI kit, or when `design/figma-system.md` already exists. Otherwise
`project`: the pod invents the system (greenfield) or audits and adopts the one in code (retrofit).

**This is orthogonal to `designSource`, and the combination that surprises people is
`systemSource: figma` + `designSource: generated`** — the brand's UI kit exists, the screens don't.
Then the pod still designs: narrative, inspiration and the **jury all stay**, because taste is still
open. What changes is that the vocabulary is fixed. Every value resolves to a system token, every
component the system defines is used rather than re-invented, and "off-system" stops being a
preference — it's a defect the jury scores as such. That is what a design system is for: the creative
work is composition, not colour-picking.

**Scope the pages before reading a system file.** A UI kit also contains covers, WIP, explorations and
deprecated sets, and building against a deprecated component is worse than ignoring the system —
it looks compliant and isn't. The canonical pages come from config (`ux.figma.designSystem.pages`);
if none are recorded, link the file properly first (`/aidlc-ux:figma <url> --system`) rather than
guessing. Anything outside that list **does not exist**.

**A workspace system is a workspace fact.** When the linked system has `scope: "workspace"`, it is the
standard for *every* frontend, and each repo emits tokens in its own idiom from the same extraction.
Adopting it in one repo while another still runs its old palette is drift; say so when you see it.

## Run-file continuity

Launched by `/aidlc:run` → reuse the item's `.aidlc/runs/{ID}.md`; don't create a second. Standalone →
create a lightweight run file (id `UX-<slug>`) so scope, mode, design source, brand, rounds and
scores/deviations are auditable. Checkpoint before and after every agent.

## Pipeline

Route on §0.5. **`designSource: figma`** → *The Figma track* below (F1–F5), then **6 · HANDBACK**.
**`designSource: generated`** → phases 0–5 here, then **6 · HANDBACK**. Mixed scope → run each surface
on its own track; one design system still covers both.

Every phase that renders the built UI uses the **shared render protocol** in `aidlc-ux:design-jury` →
*Render & evidence protocol* (steps 1–4): derive the port from the repo's `dev` script, treat
`renderBaseUrl` as a fallback, and stop rather than render the wrong server. It is stated once there;
the phases below just say when to render.

**0 · AUDIT** *(existing surfaces only — skip for greenfield)*. Render the current target at the
**resolved render URL** via the Playwright MCP (start the dev server if needed) and screenshot it to
`design/audit/`; also screenshot 1–2 sibling pages so you know what "consistent with the rest"
means. Dispatch **Agent → aidlc-design-system** in **audit mode** with those shots + the code: it
extracts the *current* design language (colors/type/spacing actually in use + where they live),
flags inconsistencies, and recommends **conform / elevate-in-place / replace**. If a scoped
retrofit's own established system is already below bar, surface that to the user — full redesign is
their call. Save the audit to `design/audit.md`.

**1 · NARRATIVE.** Dispatch **Agent → aidlc-ux-writer** → `design/narrative.md`. Brief includes the
mode, scope, brand anchors, and (for existing) the audit. On retrofit, the narrative must respect
what's preserved (logo, brand color, established patterns) while elevating the target. North star
for everything below.

**2 · RESEARCH.** Dispatch **Agent → aidlc-ux-researcher** (serving the narrative + brand) →
`design/inspiration.md`. Skip only if the item forbids external research; note the skip.

**3 · DESIGN SYSTEM.** Dispatch **Agent → aidlc-design-system**. Which mode depends on
`systemSource`:

- **`systemSource: figma`** → **figma-library mode**. Extract first if `design/figma-system.md` is
  missing or stale: dispatch **Agent → aidlc-figma** in *library mode* with the canonical pages
  (wave 1 — the whole variable set plus the component inventory; component detail comes on demand).
  Then the design-system agent emits the **full token layer** from that variable table and writes
  `design/design-system.md` citing the system as the source. Conflicts with tokens already in code are
  listed for a human, never silently resolved. Components with a code counterpart (a published
  package, a Code Connect mapping) are wired up to be **used**, not rebuilt. This is not a
  greenfield/retrofit/redesign decision — the system is given; those modes only describe the screens.
- **`systemSource: project`** → as before:
  - `greenfield` → establish the canonical system at the project root (`design/design-system.md` +
    token files) — this is now the standard every future UI item adopts.
  - `retrofit` → **adopt & extend** the established/audited system; apply brand anchors; add only
    what the target needs. Never fork a second system.
  - `redesign` → evolve or replace the system, then it becomes the new standard.

Brand anchors (logo palette, fonts) are built in as hard constraints; WCAG-AA verified. Output is
the uniformity contract for the build. A contrast failure **inherited from a given system** is
corrected, recorded with both ratios, and reported to the designer as a system bug.

**4 · BUILD + MOTION.** Apply the system to the target and layer motion:
- Invoked by `/aidlc:run`: core implementer builds/edits structure; here dispatch
  **Agent → aidlc-motion** for animation/interactions per `design/motion-spec.md`.
- Standalone greenfield: implementer (if core present) builds structure, then aidlc-motion.
- Standalone retrofit/redesign: the change is *editing existing screens* onto the system —
  dispatch the implementer to refactor components onto tokens + apply the new layout, then
  aidlc-motion; or aidlc-motion alone when only motion is being elevated.
Components MUST consume tokens — no ad-hoc colors/spacing, and no drift from the established system.

**5 · JURY LOOP.** `round = 1`.
1. Ensure the app renders at the **resolved render URL** (shared protocol, above). Start the dev
   server if down; wait until it responds; record the resolved URL. Un-renderable, or a non-UI
   response → phase `blocked`, report, STOP — the jury can't judge what won't render, and must never
   silently score the wrong server.
2. Dispatch **Agent → aidlc-ux-jury** (fresh context, blind to the makers' notes). Brief gives it the
   target scope, the brand anchors, and — for retrofit/redesign — the sibling-page shots so it can
   score **cross-page consistency + brand adherence**, not just the target in isolation. On
   `systemSource: figma`, also pass `design/figma-system.md` and the component reference shots: the
   **Consistency dimension is then judged against the given system**, so an off-system value or a
   re-invented component is a defect to name, not a stylistic call. For `juryPanelSize > 1`, dispatch
   that many jurors in one parallel batch and average composites; keep every report.
3. Composite **≥ juryThreshold** → PASS. Go to **6**.
4. Below AND `round < maxJuryRounds` → increment `round`; route each required fix to its owner
   (**aidlc-design-system** / **aidlc-motion** / implementer) in one batch scoped to ONLY those
   defects; re-run this loop (re-render, re-judge fresh). Never regress the "what's working" list.
5. Below AT `maxJuryRounds` → **stop iterating** (cost guardrail). Keep the highest-scoring round,
   attach the remaining critique to `## Findings` as `[MAJOR][open] jury: …`, flag for human. Do NOT
   loop past the cap; NEVER escalate any agent to a larger model to chase the score.

## The Figma track (`designSource: figma`)

**F1 · EXTRACT.** Dispatch **Agent → aidlc-figma** with the working dir, the `fileKey`, the in-scope
node ids and the spec template → `design/figma-spec.md` + reference shots in `design/figma/`. Node
ids come from `ux.figma.screens`, from a Figma URL in `$ARGUMENTS`, or from an inventory
(`get_metadata`) when the surface isn't mapped yet — link it as `/aidlc-ux:figma <url>` does, so the
map survives the run. **There is no narrative and no inspiration phase here**: those exist to justify
invented choices, and nothing is being invented. (A narrative is an add-on if the user wants one for
copy or marketing — never a gate.)

**F2 · TOKENS.** Dispatch **Agent → aidlc-design-system** in **figma mode**: the file's variables are
the token source of truth, mapped into the project's token layer — not a palette derived from
screenshots, and not an invented scale. One system per project still holds: greenfield → the Figma
variables *become* the project standard; existing → map onto the established tokens and surface every
conflict (same role, different value) for a human to settle rather than silently picking a winner.
Values Figma never defines (focus rings, disabled/loading/empty, breakpoints it didn't draw) are
derived, labelled `derived:` in the spec, and listed for the designer.

**F3 · BUILD.** The implementer builds to the spec — reusing library-instance components and Code
Connect mappings rather than re-implementing them, and translating `get_design_context` output into
this project's framework and component layer instead of pasting it. Then **Agent → aidlc-motion**:
realize the file's prototype interactions / Smart Animate transitions where they exist; where the
file says nothing about motion, apply the restrained defaults of `aidlc-ux:motion` and record them as
additions to the design, so the designer can see what was added.

**F4 · FIDELITY LOOP.** `round = 1`.
1. Ensure the app renders at the **resolved render URL** (shared protocol, above; un-renderable or a
   non-UI response → phase `blocked`, report, STOP).
2. Dispatch **Agent → aidlc-fidelity** with the spec, the reference shots and the routes in scope. It
   renders at the **design's own artboard width** and classifies every difference
   `[BLOCKING]`/`[MINOR]`/`[ADAPTATION]` → `design/fidelity-report.md`.
3. Zero `[BLOCKING]` → PASS. Go to **F5**.
4. Blocking defects AND `round < ux.figma.maxFidelityRounds` (default 2) → route each fix to its owner
   (implementer / design-system / motion) in one batch scoped to those defects only; re-render,
   re-check fresh.
5. At the cap → stop iterating. Attach the remaining defects to `## Findings` as
   `[MAJOR][open] fidelity: …` and flag for a human.
**Never close a fidelity defect by editing the spec** to match what was built. The spec records what
Figma says; if the design genuinely changed, re-sync it (`/aidlc-ux:figma sync`) and say so.

**F5 · JURY — offered, never imposed.** The design was approved by someone else; scoring it out of 10
and "fixing" it toward a higher score would overwrite their decision. So on `figma` the jury does not
gate. Read `ux.figma.jury`:
- **`suggest` (default)** — after fidelity passes, *offer* it in one line ("the build matches the
  design; want the jury to score it as well? advisory only"). Non-interactive (`/aidlc:sprint`,
  headless) → skip it and record `jury: not run (figma-sourced; offer stands)`.
- **`advisory`** — always run it, still non-gating.
- **`off`** — never run it.
- **`gate`** — opt-in only, for teams treating Figma as a starting point: run the full §5 jury loop
  with its threshold and rounds, exactly as `generated`.
When the jury runs non-gating, split its output: findings that are **also deviations from the design**
route to owners like any fidelity defect; findings that are **critique of the design itself** go to
the human and the designer as suggestions and are **never built**. The composite is recorded as
information — it does not gate the PR and does not trigger a redesign round.

**6 · HANDBACK.** Tear down any dev server you started. Append a `## Log` summary: both sources
(`designSource` / `systemSource`), mode, scope, rounds, the gate result — final composite + bar met?
on `generated`, blocking-defect count + PASS/CAPPED on `figma` — and artifact paths (`design/*`, plus
`figma-spec.md` / `fidelity-report.md` / `design/figma/` on the Figma track, `figma-system.md` /
`design/figma/system/` where a system was adopted). Return to the caller: that result, both sources,
the mode, and the artifact paths; on `designSource: figma` also state whether the jury ran, was
declined, or is still on offer; on `systemSource: figma` name any **system gap or conflict** the
designer must settle, and any other frontend still to be brought onto the system. Standalone → also
give the ≤6-line user summary.

## Invariants

- **One system per project — and one per workspace when the brand says so.** Greenfield establishes
  it; retrofit/redesign adopt or evolve it; a Figma design system replaces that whole question — it
  *is* the system, for every frontend that derives from it. Never silently create a second, divergent
  one. A surface that drifts from the established system is a jury **Consistency** defect.
- **A given system is not a suggestion.** With `systemSource: figma` the pod still designs the
  screens, but every value resolves to a system token and every component the system defines is used
  rather than re-invented. What the system doesn't cover is designed freely, labelled `derived:`, and
  raised with the designer — never quietly promoted to canon.
- **Brand anchors are hard constraints.** A supplied logo colour, font, or guideline is honored
  exactly, not "taken as inspiration".
- **A Figma design is the client's, not a starting point.** On `designSource: figma` you implement it
  and check fidelity; you never improve it, and you never invent a design because the file couldn't
  be read — that failure is reported, not papered over. Accessibility corrections are the one
  deviation made without asking, and they are always reported to the designer.
- **The jury never gates Figma-sourced UI** unless the project opted in with `ux.figma.jury: "gate"`.
  Offering it is right; imposing it isn't.
- The design system is the single source of truth; a raw hex/off-scale px literal in a component is
  a jury defect, not an accepted exception.
- The jury is never shown who made what or their reasoning — protect its independence.
- Respect `maxJuryRounds` absolutely. The bar is ≥ threshold *or* an honest, human-flagged handback.
- Checkpoint the run file around every dispatch; keep your own context lean (verdicts + pointers).
