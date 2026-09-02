export function normaliseWifiIdentity(value: string | null | undefined) {
  return !value ||
    value === "<unknown ssid>" ||
    value === "00:00:00:00:00:00" ||
    value === "02:00:00:00:00:00"
    ? null
    : value.replace(/^"|"$/g, "");
}
