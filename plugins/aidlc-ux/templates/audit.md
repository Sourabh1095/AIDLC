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
| Components | | | |

## Inconsistencies & debt

- {{same role → different values, off-scale spacing, hardcoded hex, duplicated components…}}

## Recommendation

`conform` (adopt current system as-is) · `elevate-in-place` (extend it) · `replace` (below bar).

**Rationale:** {{why}} — and, if `replace`, what the rest of the app will need to follow later.
