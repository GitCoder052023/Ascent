import type { NativeLatestEvent } from "../../modules/recording-keepalive";
import type { DevicePresence } from "../lib/devicePresence";
import { nativeAndroidSignal, type ProcessedSignal } from "../lib/signalEngine";
import type { WifiSnapshot } from "../lib/wifi";

export function presenceFromNativeLatest(
  event: NativeLatestEvent
): DevicePresence | null {
  if (!event.appState && !event.lockScreen && !event.screenOn) {
    return null;
  }
  return {
    appState: event.appState === "FOREGROUND" ? "FOREGROUND" : "BACKGROUND",
    lockScreen:
      event.lockScreen === "YES" || event.lockScreen === "NO"
        ? event.lockScreen
        : "UNKNOWN",
    screenOn:
      event.screenOn === "YES" || event.screenOn === "NO" ? event.screenOn : "UNKNOWN",
  };
}

export function wifiFromNativeLatest(event: NativeLatestEvent): {
  snapshot: WifiSnapshot;
  processed: ProcessedSignal;
} | null {
  if (!event.wifiConnectionState) {
    return null;
  }
  const connected = event.wifiConnectionState === "CONNECTED";
  const snapshot: WifiSnapshot = {
    connectionState: connected ? "CONNECTED" : "DISCONNECTED",
    ssid: event.wifiSsid ?? null,
    bssid: event.wifiBssid ?? null,
    signalStrength: event.wifiRssi ?? null,
    signalStrengthUnit: event.wifiRssi != null ? "dBm" : null,
    frequency: event.wifiFrequency ?? null,
  };
  return {
    snapshot,
    processed: nativeAndroidSignal(event.wifiRssi ?? null, event.wifiFrequency ?? null),
  };
}
