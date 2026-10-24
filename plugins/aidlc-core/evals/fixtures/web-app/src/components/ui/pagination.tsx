import { Button } from "./button";

/** Previous / next controls and "page n of m" for any paginated list. Pair it with usePagination. */
export function Pagination({ page, pageCount, onPageChange }: { page: number; pageCount: number; onPageChange: (page: number) => void }) {
  return (
    <nav aria-label="Pagination" className="pagination">
      <Button variant="secondary" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
        Previous
      </Button>
      <span>
        Page {page} of {pageCount}
      </span>
      <Button variant="secondary" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
        Next
      </Button>
    </nav>
  );
}
