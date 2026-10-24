/** Formats a timestamp for display in tables: "24 Oct 2026". */
export function formatDate(value: string | number | Date): string {
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
