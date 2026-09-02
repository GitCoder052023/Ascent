import { EMPTY_LATEST_RAW, type LatestRaw } from "../../capture/imuTypes";

let latestLocal: LatestRaw = { ...EMPTY_LATEST_RAW };
let lastUi = 0;
const latestListeners = new Set<(latest: LatestRaw) => void>();

export function resetLatestRaw() {
  latestLocal = { ...EMPTY_LATEST_RAW };
  lastUi = 0;
}

export function getLatestRaw(): LatestRaw {
  return { ...latestLocal };
}

export function subscribeLatestRaw(listener: (latest: LatestRaw) => void): () => void {
  latestListeners.add(listener);
  listener({ ...latestLocal });
  return () => {
    latestListeners.delete(listener);
  };
}

export function publishLatest(partial: Partial<LatestRaw>) {
  Object.assign(latestLocal, partial);
  const now = Date.now();
  if (now - lastUi < 750) {
    return;
  }
  lastUi = now;
  const snapshot = { ...latestLocal };
  for (const listener of latestListeners) {
    listener(snapshot);
  }
}

export function currentLatestRaw(): LatestRaw {
  return latestLocal;
}
