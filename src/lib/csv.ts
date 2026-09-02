export function csvCell(item: unknown): string {
  if (item === null || item === undefined) {
    return "";
  }
  if (typeof item === "number" && Number.isFinite(item)) {
    return String(item);
  }
  return `"${String(item).replaceAll('"', '""')}"`;
}
