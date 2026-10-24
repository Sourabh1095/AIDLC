# UI Audit — {{ID}} {{TITLE}}

> The current design language of an existing surface, before any redesign. Owned by
> `aidlc-design-system` (audit mode). No code changes are made producing this — it's a read.

## Scope audited

Target: {{page/screen/app}} · rendered at {{url}} · shots in `design/audit/`.
Sibling screens reviewed (for "consistent with the rest"): {{list}}

## Current system (as actually used)

| Foundation | Values found | Where defined | Consistent? |
|---|---|---|---|
| Color | | Tailwind config / CSS vars / inline hex | |
| Typography | | | |
| Spacing | | | |
| Radius / elevation | | | |

## Components already in the code

<!-- From `aidlc:reuse` → catalog.mjs (components, ui, hooks, icons). This is the vocabulary every
     later phase builds screens from: a screen uses these, extended with a prop or variant when needed,
     and never a fresh copy. -->

| Component | Path | For | Variants / props | Keep? |
|---|---|---|---|---|

## Inconsistencies & debt

- {{same role → different values, off-scale spacing, hardcoded hex, the same component built twice under
  different names (name both — merging them is debt worth an item)…}}

## Recommendation

`conform` (adopt current system as-is) · `elevate-in-place` (extend it) · `replace` (below bar).

**Rationale:** {{why}} — and, if `replace`, what the rest of the app will need to follow later.
