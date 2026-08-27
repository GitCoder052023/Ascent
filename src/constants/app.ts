import type { WifiSnapshot } from "../lib/wifi";

export const SAMPLE_MS = 25_000;

export const EMPTY_WIFI: WifiSnapshot = {
  connectionState: "UNKNOWN",
  ssid: null,
  bssid: null,
  signalStrength: null,
  signalStrengthUnit: null,
  frequency: null,
};
