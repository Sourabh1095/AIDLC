---
name: figma-handoff
description: Discipline for building from an existing Figma design — reading the file through the Figma MCP, extracting a screen spec and variables, what fidelity means, what is allowed to deviate, and how the fidelity check is scored. Load when extracting a Figma design, implementing from one, or reviewing design/figma-spec.md or a fidelity report.
user-invocable: false
---

# Figma handoff — the design already exists

When screens exist in Figma, the design decisions have already been made and — usually — signed off
by someone who is not in this session. The pod's job flips: **not to invent a design, but to land
the one that exists**. Taste questions are closed. The open question is fidelity.

That single flip is what this discipline governs. Get it wrong in the obvious way — treating Figma
as "inspiration" and improving on it — and you ship something the client did not approve.

## The design source is a hard fork in the pipeline

| | `generated` (no Figma) | `figma` |
|---|---|---|
| Where the design comes from | narrative → inspiration → design system | the Figma file |
| Tokens | invented, traced to the narrative | **extracted** from Figma variables/styles |
| Quality bar | jury composite ≥ threshold | **fidelity**: zero blocking deviations |
| Jury | mandatory gate | **optional**, advisory by default |
| Creative licence | wide | none, except where Figma is silent |

Never mix them: a surface whose design came from Figma does not also get a narrative-driven
re-invention of its palette.

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
`node-id` is the whole file: inventory it, don't extract it wholesale.

## The spec is the artifact — not the tool output

Write `design/figma-spec.md` (template: `${CLAUDE_PLUGIN_ROOT}/templates/figma-spec.md`) and keep
reference shots in `design/figma/`. Everything downstream — the implementer, the token work, the
fidelity check, the next session — reads the spec, not the MCP. Record for each screen: node id,
route it maps to, layout structure, the variables it uses, its states, its assets, and the
screenshot path. A spec that sends the reader back to Figma for basics has failed.

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

## Fidelity — what counts as a defect

The check compares the **rendered build** against the **Figma reference**, at the design's own
viewport. Classify every difference:

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
- Every extracted value traces to a node id or a variable name. "About 24px" is not a spec.
- Accessibility corrections are the one deviation you make without asking — and you always report
  them.
- Re-extract when the file changes; never trust a stale spec against a moved design (`/aidlc-ux:figma
  sync` exists for exactly this).
