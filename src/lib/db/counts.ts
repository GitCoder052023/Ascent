let cachedRawDbCount: number | null = null;
let cachedWifiDbCount: number | null = null;

export function resetCachedCounts() {
  cachedRawDbCount = 0;
  cachedWifiDbCount = 0;
}

export function getCachedRawDbCount() {
  return cachedRawDbCount;
}

export function setCachedRawDbCount(value: number | null) {
  cachedRawDbCount = value;
}

export function addCachedRawDbCount(delta: number) {
  if (cachedRawDbCount !== null) {
    cachedRawDbCount += delta;
  }
}

export function getCachedWifiDbCount() {
  return cachedWifiDbCount;
}

export function setCachedWifiDbCount(value: number | null) {
  cachedWifiDbCount = value;
}
