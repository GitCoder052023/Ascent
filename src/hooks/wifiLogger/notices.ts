export function joinNotices(...parts: (string | null | undefined)[]): string | null {
  const joined = parts.filter(Boolean).join(" ");
  return joined.length > 0 ? joined : null;
}
