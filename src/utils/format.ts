export function formatDuration(seconds: number) {
  return [
    Math.floor(seconds / 3600),
    Math.floor((seconds % 3600) / 60),
    seconds % 60,
  ]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

export function formatUnavailable(value: string | number | null) {
  return value === null ? "Not available" : String(value);
}
