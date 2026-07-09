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
