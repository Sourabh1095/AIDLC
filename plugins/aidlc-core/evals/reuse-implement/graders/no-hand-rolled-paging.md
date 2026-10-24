---
type: llm
criteria: The orders screen is paginated with the project's existing hook and control, not by hand.
---
The repository already contains `usePagination(items, pageSize)` (src/hooks/use-pagination.ts) and a
`Pagination` component (src/components/ui/pagination.tsx).

PASS only if src/screens/orders.tsx calls the existing `usePagination` hook and renders the existing
`Pagination` component, and the change does not hand-roll page state, page-count arithmetic or slicing,
and defines no new pagination helper anywhere.

FAIL otherwise.
