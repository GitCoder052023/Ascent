import type { WifiSnapshot } from "../../lib/wifi";
import { setCachedWifi } from "../../lib/recordingContext";

export const KEY_STARTED = "@wifi_logger_started";

export function cacheWifiFields(current: WifiSnapshot) {
  setCachedWifi({
    ssid: current.ssid,
    bssid: current.bssid,
    signalStrength: current.signalStrength,
    signalStrengthUnit: current.signalStrengthUnit,
    frequency: current.frequency,
  });
}
