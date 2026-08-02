# Figma Design System — {{FILE_NAME}}

> The brand's design system as it exists in Figma, extracted once. Owned by `aidlc-figma` (library
> mode). This is the **extraction record**; `design/design-system.md` is the project's canonical
> system doc and is written from this. **This records the system; it does not improve it.**

## Source

File: `{{FILE_NAME}}` · key `{{FILE_KEY}}` · {{URL}}
Extracted {{UTC}} · published library: {{yes/no}} · Code Connect: {{wired? / no}}
Applies to: {{workspace-wide | repo/package}} — {{which frontends derive from this}}

## Pages in scope

| Page | Node | In scope | Why |
|---|---|---|---|
| | | yes / **no** | canonical / cover+brand / WIP / deprecated / exploration |

Pages are excluded deliberately, and the exclusions matter as much as the inclusions — a component
found on an out-of-scope page **does not exist**. Widening this list is a human decision.

## Foundations — variables

Every value the system defines, and where it lands in this project. One row per variable; no
"roughly" values.

| Figma variable | Value | Modes | Project token | Status |
|---|---|---|---|---|
| | | light/dark/… | | mapped / new / **conflict** |

**Conflicts** (a system variable disagreeing with an existing project token) are listed, not
resolved — a human settles them. Record the worst text/background contrast ratio measured, and any
pair that fails WCAG AA.

### Type scale

| Token | Family | Size / line-height / weight / tracking | Used for |
|---|---|---|---|

### Spacing, radius, elevation

| Scale | Steps | Notes |
|---|---|---|

## Component inventory

Everything the system offers — **including components not yet detailed**, because a component that
exists in the system and gets re-invented in code is the failure this file exists to prevent.

| Component | Node | Variants / states | Detailed? | Code counterpart |
|---|---|---|---|---|
| | | | yes / on demand | package export / Code Connect / none yet |

### Detailed components

Pulled on first use and cached here — anatomy, the tokens each part consumes, variant axes, states,
and the shot path.

#### {{COMPONENT}} — node `{{NODE_ID}}`

Shot: `design/figma/system/{{slug}}.png`
Anatomy · variants · states · tokens consumed · usage rules the file states · do / don't.

## Usage rules the system states

Rules the file itself documents (when to use which variant, density, layout grid, iconography,
tone). Cite where each came from. Rules you inferred belong under *Derived*, not here.

## Derived — where the system is silent

Each item: what's missing, what was derived, the reasoning. **Needs designer confirmation.**

- `derived:` {{focus-visible ring / disabled state / breakpoints / dark mode / a missing component}}

## Gaps to raise with the designer

Components the product needs that the system doesn't define, and any accessibility problem inherited
from the system (with the ratio and the accessible value recommended). Numbered and answerable.
