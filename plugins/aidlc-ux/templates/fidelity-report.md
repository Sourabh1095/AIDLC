# Fidelity Report — {{ID}} {{TITLE}} — Round {{ROUND}}

> Does the build match the design? Owned by `aidlc-fidelity`, which compares the **rendered** screen
> against the **Figma reference** and the spec. It judges the build, not the design — taste is the
> (optional) jury's job. Gate: **zero `[BLOCKING]`**. Fidelity is never scored as a percentage.

## Evidence

Rendered at `{{URL}}` · captured {{UTC}} · spec `design/figma-spec.md`
Reference shots: `design/figma/` · rendered shots: {{paths}}

## Per screen

### {{ROUTE}} — `PASS` | `ITERATE` | `BLOCKED`

Rendered {{path}} at {{W}}px vs reference {{path}} (node `{{NODE_ID}}`, drawn at {{W}}px).

| # | Class | What differs | Rendered | Design says | Owner |
|---|---|---|---|---|---|
| 1 | BLOCKING / MINOR / ADAPTATION | | | spec line / variable / node | implementer / design-system / motion |

*(repeat per screen)*

## Verdict

`PASS` (zero BLOCKING) or `ITERATE ({{n}} blocking)`.

## Required fixes (only if ITERATE)

Ordered and exact — the rendered value, the spec value, the node id, the owner. Vague notes waste a
round: *"gap between cards renders 16px, spec `space-6` = 24px (node 12-408)"*, not *"spacing looks
off"*.

1. …

## Adaptations shipped (designer should know)

Accessibility corrections, real-content differences, undrawn responsive behavior, platform
conventions. Each with why.

## Not judged here

Whether the design itself is good. If you want that, run the jury — advisory on Figma-sourced UI
(`ux.figma.jury`).
