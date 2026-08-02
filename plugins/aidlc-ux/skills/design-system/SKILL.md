---
name: design-system
description: Discipline for building a tokenized design system as the single source of truth — color, typography, spacing/grid, radius, elevation — that makes a UI feel uniform. Load when defining or reviewing design tokens and design/design-system.md.
user-invocable: false
---

# Design system — the uniformity contract

A UI reads as "one system" only when every visual value comes from a shared token. The design
system is a contract the rest of the build is held to: after it exists, an ad-hoc hex or off-scale
pixel in a component is a defect, not a shortcut.

## One system per project (adopt before invent)

- **Greenfield** (no system yet): establish it, and leave `design/design-system.md` + token files
  at the project root as the standard every future UI item adopts.
- **Existing project**: a system already exists in code even if undocumented — audit it first (see
  below), then **conform** (retrofit a page/screen to it), **elevate-in-place** (extend it), or
  **replace** it (redesign). Never create a second, divergent system beside the current one.

## When the system is given, not invented (sourced from Figma)

Two different things can hand you the values, and both mean **you map, you don't invent** — no palette
derived from screenshots, no scale of your own design. `aidlc-ux:figma-handoff` covers reading the file;
this is what landing it in code requires:

- **Emit the full token layer from the variable table**, not just the values the first screen needs.
  A half-mapped system means the next screen invents the rest.
- **Keep semantic names semantic** (`surface/raised` → `--surface-raised`). Rename only to fit an
  existing project convention, and record the mapping **both ways** in `design/design-system.md`.
- **Multi-mode variables** (light/dark, density, brand) map to the project's theming mechanism — never
  to duplicated token sets.
- **Conflicts with tokens already in code are listed for a human.** Never silently pick a winner, and
  never let both survive: two spellings of the brand blue is exactly the drift a system prevents.
- **The component inventory is the contract.** Where a code counterpart exists (a published package, a
  Code Connect mapping), wire the project to *use* it. Where one doesn't, say what must be built as a
  system component — implemented once, in the component layer, never inline in a screen.
- **Gaps stay gaps.** What the file doesn't define — focus rings, some states, breakpoints, dark mode,
  a missing component — you derive from the system's own logic, label `derived:`, and list for the
  designer. A derived value is provisional; it is never promoted to canon quietly.
- **Workspace scope.** When the system is workspace-wide, every frontend derives from the same
  extraction, each emitting tokens in its own idiom. Say which repos you emitted for and which are
  still on their old values.
- **Accessibility is still yours.** Verify AA across the system's own pairs. A failing pair *inherited*
  from the design or system is corrected, recorded with both ratios, and reported upstream — it is a
  system bug, and reporting it is worth more than the local fix. You never ship known-inaccessible
  contrast to match a mockup, and you never fix it quietly either.

Greenfield → the mapped variables become the project standard. Existing project → map onto the
established tokens and surface every conflict rather than forking a second system beside the current one.

## Auditing an existing UI

Given rendered screenshots + the code: catalog the colors, type families/scale, spacing, radius and
shadows actually in use and where they live (Tailwind config / CSS vars / inline literals). Flag
inconsistencies (same role → different values, off-scale spacing, hardcoded hex). Output the current
system + a conform/elevate/replace recommendation before touching anything.

## Brand anchors are hard constraints

When a logo, brand colors, fonts or guidelines are supplied, build the token system *around* them —
they are not "inspiration":
- **Logo** → extract dominant + accent colors into the palette; if the exact brand hex fails AA on
  text, keep it for surfaces/accents and derive an accessible on-brand text shade (record why).
- **Font reference** (name or screenshot) → identify or best-effort match the closest web-available
  font; flag an ambiguous screenshot match for user confirmation rather than guessing silently.
- **Supplied hex / guidelines** → honored exactly.

## Foundations (define all, tokenize all)

- **Color by role, not by hue.** `bg / surface / fg / muted / accent / accent-2 / border` (+ states).
  Name gradients as tokens (stops + angle). Verify **WCAG AA** for every text/background pair
  (≥4.5:1 body, ≥3:1 large text) and record the ratios — failing contrast is not shippable.
- **Typographic scale.** Display / body / mono families with an explicit load strategy (`next/font`
  or project equivalent). A named scale on a consistent ratio (e.g. 1.25) — `display, h1, h2, h3,
  body, small, caption` — each with size/line-height/weight/tracking. Mind measure (line length).
- **Spacing on a system.** An 8pt (or 4pt) scale, `space-1..N`. Components use scale steps only.
- **Grid & rhythm.** Columns, gutter, max content width, vertical section rhythm.
- **Radius & elevation.** Small, intentional sets (`radius-*`, `shadow-*`) — not one-off values.
- **Component states.** default / hover / focus-visible / active / disabled defined in tokens.
  Visible focus-visible states are mandatory (keyboard accessibility).

## Emit to code — the single source of truth

Match the project's setup (inspect first): CSS custom properties, the Tailwind theme config, and/or
a `tokens.ts`. Components reference tokens; they never hardcode. Use Context7 for current
Tailwind / `next/font` APIs instead of relying on memory.

## Traceability

Every token choice names the narrative line or inspiration direction it satisfies. A palette or
scale with no rationale is guesswork.

## Output

`design/design-system.md` (spec + rationale + contrast ratios) and the token file(s) in code.
