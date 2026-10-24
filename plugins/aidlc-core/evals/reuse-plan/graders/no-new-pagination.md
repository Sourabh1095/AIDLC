---
type: llm
criteria: The plan reuses what the codebase already has instead of writing new pagination code.
---
The repository already contains `usePagination` (src/hooks/use-pagination.ts, which returns the page,
page count and visible slice) and a `Pagination` control (src/components/ui/pagination.tsx).

PASS only if the plan in PLAN.md has BOTH screens use the existing `usePagination` hook AND the existing
`Pagination` component, and NO task creates a new pagination hook, helper, utility or control (or
re-implements page/slice arithmetic inside a screen).

FAIL if any task writes new pagination logic or a new pagination component, or if either screen is
planned to paginate by hand.
