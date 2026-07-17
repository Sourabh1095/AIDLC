# Design System — {{ID}} {{TITLE}}

> The uniformity anchor. Every color, size, space and font in the built UI MUST come from a
> token defined here — no ad-hoc hex codes or pixel values in components. Owned by
> `aidlc-design-system`. Tokens are emitted to code (CSS variables / Tailwind config / tokens.ts)
> as the single source of truth.

## Foundations traceability

Each choice below must name the narrative line or inspiration direction it satisfies.

## Color

| Token | Value | Role | Rationale |
|---|---|---|---|
| `--color-bg` | | page base | |
| `--color-surface` | | cards/panels | |
| `--color-fg` | | primary text | |
| `--color-muted` | | secondary text | |
| `--color-accent` | | primary action / brand | |
| `--color-accent-2` | | secondary / gradient stop | |
| `--color-border` | | hairlines | |

- **Gradients:** define named gradients (stops + angle) as tokens, not inline.
- **Contrast:** every text/background pair MUST meet WCAG AA (≥4.5:1 body, ≥3:1 large). Record ratios.

## Typography

- **Families:** display / body / mono — name each, with the `next/font` (or equivalent) load strategy.
- **Type scale** (name → size / line-height / weight / tracking): `display`, `h1`, `h2`, `h3`,
  `body`, `small`, `caption`. Use a consistent ratio (e.g. 1.25 major third).
- **Rules:** measure (line length) target, heading vs body pairing, when mono is used.

## Space & layout

- **Spacing scale:** an 8pt (or 4pt) system — `space-1..12`. No off-scale values in components.
- **Grid:** columns, gutter, max content width, section rhythm.
- **Radius / elevation:** `radius-*` and `shadow-*` tokens; keep the set small and intentional.
- **Whitespace intent:** where generous negative space is deliberate (per narrative).

## Component conventions

Buttons, inputs, cards, nav: default / hover / focus-visible / active / disabled — each state
references tokens. Focus states are mandatory and visible (accessibility, not optional).

## Token export

- File(s) written: {{path to tokens.css / tailwind.config / tokens.ts}}
- Rule enforced downstream: components import tokens; a raw hex or px literal in a component is a
  jury defect under **Consistency**.
