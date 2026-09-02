import type { WifiSnapshot } from "../lib/wifi";

export const WIFI_SAMPLE_INTERVAL_MS = 2000;

export const EMPTY_WIFI: WifiSnapshot = {
  connectionState: "UNKNOWN",
  ssid: null,
  bssid: null,
  signalStrength: null,
  signalStrengthUnit: null,
  frequency: null,
};
