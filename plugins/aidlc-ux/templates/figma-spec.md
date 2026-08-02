# Figma Spec — {{ID}} {{TITLE}}

> The design as it exists in Figma, written down so the build never needs to reopen the file.
> Owned by `aidlc-figma`. Source of truth for the implementer, the token mapping, and the fidelity
> check. **This records the design; it does not improve it.**

## Source

File: `{{FILE_NAME}}` · key `{{FILE_KEY}}` · {{URL}}
Extracted {{UTC}} · library/design-system in use: {{name or none}} · Code Connect: {{wired? / no}}
Extraction basis: `figma-mcp` (full context + variables) | `screenshots-only` ({{why}})

## Screens

### {{ROUTE}} ← node `{{NODE_ID}}` · {{FRAME_NAME}}

Reference shot: `design/figma/{{slug}}.png` · drawn at {{W}}px

**Structure** — regions top to bottom, each with its layout (stack/grid, direction, gap, padding),
sizing rules and alignment. Name the component for anything that is a component.

**Values** — every one traced to a variable or a node:

| Element | Property | Value | Variable / token |
|---|---|---|---|
| | | | |

**Components** — library instances and their existing code counterparts (reuse, don't rebuild):

| Frame component | Library | Code Connect mapping | Action |
|---|---|---|---|
| | | | reuse / build new |

**States in the design:** {{default / hover / focus / disabled / empty / loading / error — which exist}}
**Assets:** {{exported paths}}
**Prototype / interactions:** {{transitions, Smart Animate, triggers — or "none in file"}}

*(repeat per screen)*

## Variables → project tokens

| Figma variable | Value | Project token | Status |
|---|---|---|---|
| | | | mapped / new / conflict |

Conflicts (a Figma variable that disagrees with an existing project token) are listed here and
settled by the design-system owner — never by silently picking one.

## Derived — where Figma is silent

Each item: what's missing, what was derived, and the reasoning. **These need designer confirmation.**

- `derived:` {{focus-visible ring / disabled state / breakpoint behavior / dark mode / …}}

## Required adaptations

Deviations the build must make anyway — accessibility corrections first, each with the source value,
the problem, and the shipped value.

- `[a11y]` {{pair}} — {{ratio}} vs AA {{required}} → shipping {{value}}. Designer should confirm.

## Open questions for the designer

Numbered, specific, answerable. An empty list is a valid answer.
