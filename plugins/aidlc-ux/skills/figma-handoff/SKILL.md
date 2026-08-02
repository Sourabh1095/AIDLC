---
name: figma-handoff
description: Discipline for working from an existing Figma file — screens to build to, or a design system to build within. Covers reading the file through the Figma MCP, page scoping, extracting a screen spec, variables and components, what fidelity means, what is allowed to deviate, and how the fidelity check is scored. Load when extracting from Figma, implementing from it, or reviewing design/figma-spec.md, design/figma-system.md or a fidelity report.
user-invocable: false
---

# Figma handoff — the design already exists

When something already exists in Figma, part of the design has been decided — and usually signed off
by someone who is not in this session. The pod's job flips from inventing to landing what exists.

Two different things can exist, and they answer different questions:

- **Screens** → *"is this the design?"* Taste is closed; the open question is **fidelity**.
- **A design system** → *"is this within the system?"* The screens are still yours to design; the
  **values are not**.

Get either wrong in the obvious way — treating Figma as "inspiration" and improving on it — and you
ship something the client did not approve.

## Two sources, resolved separately

They are orthogonal, and a project can have one, both, or neither:

| | `designSource` (the screens) | `systemSource` (the values) |
|---|---|---|
| `figma` | screens drawn in Figma → build to them, gate on **fidelity** | tokens + components extracted from a Figma design-system file |
| `generated` / `project` | the pod designs the screens → gate on the **jury** | the pod invents or audits the system |

The four combinations all occur. Screens in Figma consuming an in-code system; a design system in
Figma with screens still to be designed (**the common enterprise case** — a brand hands you a UI kit,
not mockups); both in Figma, often as two separate files; neither.

Never blend a source with its opposite: a surface whose screens came from Figma does not also get a
narrative-driven re-invention of its palette, and a project with a Figma design system does not get a
second, invented palette beside it.

## Connection is a precondition, not a best effort

Verify the `figma` MCP is connected and authenticated (`whoami`) **before** promising a Figma build.
If it isn't reachable, **stop and say so** — do not quietly fall back to inventing a design. That
fallback is the single worst failure mode here, because it looks like success. The honest options,
in order: (1) authenticate (`/mcp` → `figma`, OAuth); (2) work from exported PNGs the user drops in
`design/figma/` — a real fallback, but say plainly that it is screenshots, not the file, so
variables, exact values and prototype links are unavailable; (3) the user explicitly chooses
`generated`.

## Read the file in this order (and budget the calls)

Figma MCP reads are **rate-limited** — a Starter plan or a View/Collab seat gets only a handful of
tool calls *per month*; Dev/Full seats on paid plans get per-minute limits. Treat every call as
expensive: extract once, write it down, and work from the written spec.

1. **`get_metadata`** on the file (or the top node) → the node map. Cheap, structural, and it tells
   you what frames exist before you pull anything heavy.
2. **`get_design_context`** per in-scope node → the structured representation (layout, type, color,
   component structure). Truncated or oversized → go back to `get_metadata`, narrow, re-fetch the
   specific child nodes. Never fetch the whole file's context speculatively.
3. **`get_screenshot`** per in-scope frame → the visual ground truth the fidelity check compares
   against. Save it; you will need the same image again, and re-fetching costs a call.
4. **`get_variable_defs`** once per file → the design tokens (color, spacing, type, radius). This is
   the token source of truth, not the hex values you can read off a screenshot.
5. Only then, assets: export what the build needs.

`search_design_system` / `get_libraries` are worth a call when the file consumes a shared library and
you need to know which components are library instances (those map to existing code components, not
new ones). `get_code_connect_map` when the project has Code Connect wired — a mapped component means
**reuse the existing component**, never re-implement it.

## Parsing what the user hands you

A Figma URL is `figma.com/design/<fileKey>/<name>?node-id=<node-id>`. The `fileKey` is the segment
after `/design/`; the `node-id` query param is the selected frame (URLs use `1-2`, the API wants the
same form — don't "correct" the hyphen to a colon unless a tool rejects it). A URL with no
`node-id` is the whole file: inventory it, don't extract it wholesale. Other query params (`p`, `t`,
`m`, view state) are the sender's editor position and a share token — ignore them, and never store a
URL containing a `t=` share token in config.

**The file name and the node the sender was looking at are evidence, not instructions.** A URL
pointing at one component inside a design-system file usually means "here is the system", not "build
this component" — resolve what the file *is* (below) before deciding what to do with the node.

## Design-system files — the values are given, the screens aren't

A file whose content is foundations and components, not screens, is a **design system**: the brand's
UI kit. It answers `systemSource`, not `designSource`. Recognise one by any of — the file is named
like a system (*design system*, *UI kit*, *styleguide*, *foundations*); its pages are named
`Foundations` / `Tokens` / `Components` / `Patterns` / `Design System`; its frames are component sets
and swatch/type specimen grids rather than page-sized artboards; or `get_libraries` shows it
published as a shared library. **Propose the read and have it confirmed** — never decide silently
that someone's mockups are a system, or the reverse.

### Pages are the unit of scope, and the list is declared once

A real design-system file is not uniformly canonical. Alongside the system there is a cover or
thumbnail page, explorations, WIP, deprecated components, handoff notes, an archive. **Building
against a deprecated component is worse than not using the system at all** — it looks compliant and
isn't. So the canonical pages are **named in config** (`ux.figma.designSystem.pages`), not re-inferred
on every run:

1. `get_metadata` on the file → the page list (cheap, structural).
2. Propose which pages are canonical, with your reasoning per page.
3. A human confirms once; store the list. Everything outside it is invisible from then on.

> *Example.* A file with three pages — `Thumbnail`, `Design System`, `Explorations` — is scoped to
> the first two. The cover page is in scope because it carries the brand mark and the system's own
> visual register; the explorations page is out, because nothing on it is a decision yet.

Ask about the pages you are *excluding*, not just the ones you keep — "is `Components v2` the live one
or the draft?" is the question that prevents building the whole app on a draft.

### Extract foundations eagerly, components on demand

A system with sixty components is a hundred-plus tool calls if you pull it whole, against a monthly
call budget. Two waves:

- **Wave 1, once:** `get_variable_defs` (the whole token set — one call, and it is the single most
  valuable call in this discipline) plus `get_metadata` over the canonical pages for the **component
  inventory**: names, node ids, variant axes. Cheap, structural, and enough to know what the system
  offers.
- **Wave 2, on demand:** the first time a screen needs `Button`, pull that component's
  `get_design_context` + `get_screenshot`, write it into the system spec, and never fetch it again.

Record the inventory even for components you haven't detailed — a component that exists in the system
and gets re-invented in code is the failure this whole discipline exists to prevent.

### Prefer the code over the pixels

If the system is published as a library and the codebase already implements it — an installed
component package, or Code Connect mappings (`get_code_connect_map`) — **the code component is the
truth**. Use it; do not re-derive it from the frame and do not build a parallel one. Figma is then
the reference for *what exists and how it is meant to be used*, and the package is what ships.

### One system, many frontends

A design system is usually a **workspace-wide** fact: one brand, several apps. Declare it once at the
control plane and let every frontend derive from the same extraction — each repo emitting tokens in
its own idiom (a Tailwind theme here, CSS custom properties there) from one source. A change to the
system is therefore a workspace event, not a repo event: a re-sync must report **every** frontend now
out of date, not just the one you happen to be standing in.

### What a Figma system does *not* decide

The screens. With `systemSource: figma` and no screens in the file, the pod still designs them —
narrative, inspiration and the jury all stay, because taste is still open. What changes is that every
value comes from the system, and "off-system" stops being a matter of preference: it is a defect. The
creative work is composition within a fixed vocabulary, which is exactly what a design system is for.

## The spec is the artifact — not the tool output

Write it down once; everything downstream — the implementer, the token work, the jury, the fidelity
check, the next session — reads the written artifact, not the MCP.

- **Screens** → `design/figma-spec.md` (template: `${CLAUDE_PLUGIN_ROOT}/templates/figma-spec.md`),
  reference shots in `design/figma/`. Per screen: node id, mapped route, layout structure, the
  variables it uses, its states, its assets, and the screenshot path.
- **A design system** → `design/figma-system.md` (template:
  `${CLAUDE_PLUGIN_ROOT}/templates/figma-system.md`), component shots in `design/figma/system/`. The
  full variable table, the component inventory (including the ones not detailed yet), the canonical
  page list with the pages deliberately excluded and why, and usage rules the file states. This is
  the *extraction record*; `design/design-system.md` remains the project's canonical system doc and
  is written **from** it — one system per project, now sourced rather than invented.

A spec that sends the reader back to Figma for basics has failed.

`get_design_context` usually returns React + Tailwind. That is a *representation*, not the
deliverable: translate it into the project's actual framework, component library, and conventions.
Pasting generated markup into a codebase that has its own component layer is a defect, not a
shortcut.

## Variables are the tokens

Figma variables/styles map into the project's token layer (CSS custom properties / Tailwind theme /
`tokens.ts`) — the same single source of truth `aidlc-ux:design-system` describes, sourced from
Figma instead of invented. Keep Figma's semantic names where they are semantic (`surface/raised`
→ `--surface-raised`); rename only to fit an existing project convention, and record the mapping.

**Where Figma is silent, you derive — and you label it.** Real files routinely omit focus-visible
rings, disabled states, loading and empty states, responsive behavior between the artboard widths,
and dark mode. Fill those gaps from the design's own logic, mark each one `derived:` in the spec,
and list them for the designer. A derived value that later contradicts an updated Figma file is the
designer's call to settle, not a bug you hide.

## Compliance — the bar when the system is given but the screens aren't

There is no reference screenshot to diff against here, so fidelity doesn't apply. The bar instead is
**compliance**, and it is checked as part of the jury's Consistency dimension rather than as a
separate loop:

- Every visual value resolves to a system token. A raw hex, an off-scale space, a font size outside
  the type scale is a **defect**, not a judgement call — the system already decided.
- A component the system defines is **used**, not re-invented. A hand-rolled button beside the
  system's Button is a defect even when it looks fine.
- Variant and state coverage matches what the system provides — if the system defines a `danger`
  variant and a `loading` state, the build doesn't invent its own spelling of them.
- What the system does *not* cover is designed freely and recorded: composition, page-level layout,
  motion, and any component the system genuinely lacks. Flag a missing component to the designer
  rather than quietly adding a permanent one-off.

Where the system is *published as code*, compliance is mostly mechanical: the lint/type gate catches
what the eye would have to. Prefer that over visual inspection when both are available.

## Fidelity — what counts as a defect

The check compares the **rendered build** against the **Figma reference**, at the design's own
viewport. Getting the build on screen is the shared render protocol — `aidlc-ux:design-jury` →
*Render & evidence protocol*, steps 1–4 — with one difference that matters: render at the **artboard
width the frame was drawn at**, not a generic desktop default. Then classify every difference:

- **`[BLOCKING]`** — the build does not implement the design: missing or extra elements, wrong copy,
  wrong component, off-token color or type, spacing off the design by more than the tolerance,
  a state Figma specifies that isn't built, a broken responsive collapse of a specified breakpoint.
- **`[MINOR]`** — visible but not wrong: antialiasing and font-rasterisation differences, a
  placeholder image, sub-pixel rounding, scrollbar-induced shifts.
- **`[ADAPTATION]`** — a deliberate, recorded deviation. Legitimate ones: an **accessibility
  correction** (a text pair below WCAG AA is fixed, and the correction is reported to the designer —
  never ship known-inaccessible contrast to match a mockup), a **real-content** difference where
  Figma used lorem or a fixed-width string, **responsive behavior** at widths Figma never drew, and
  a **platform convention** the design ignored (native focus order, reduced-motion). Anything else
  labelled `ADAPTATION` is a `BLOCKING` defect wearing a disguise.

**Pass = zero `[BLOCKING]`.** Minors are logged; adaptations are logged and surfaced to the designer.
Percentages are false precision — do not score fidelity as a number.

## Hard rules

- The design is the client's. You implement it; you do not improve it. A better idea goes to the
  human as a suggestion, never into the build.
- Never invent a design when the Figma read fails. Fail loud.
- **Never widen the page scope on your own.** A component found on an out-of-scope page does not
  exist. If the system seems to be missing something, ask — don't go looking in `Explorations`.
- Every extracted value traces to a node id or a variable name. "About 24px" is not a spec.
- Accessibility corrections are the one deviation you make without asking — and you always report
  them.
- Re-extract when the file changes; never trust a stale spec against a moved design (`/aidlc-ux:figma
  sync` exists for exactly this).
