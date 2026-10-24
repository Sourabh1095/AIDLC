import { useMemo, useState } from "react";

/** Client-side pagination over any list: the current page, the page count and the visible slice. */
export function usePagination<T>(items: readonly T[], pageSize = 20) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(page, pageCount);
  const visible = useMemo(() => items.slice((current - 1) * pageSize, current * pageSize), [items, current, pageSize]);
  return { page: current, pageCount, visible, setPage };
}
