import NetInfo, { NetInfoStateType } from "@react-native-community/netinfo";
import { Platform } from "react-native";
import WifiManager from "react-native-wifi-reborn";
import {
  globalSignalEngine,
  isValidAndroidRssiDbm,
  nativeAndroidSignal,
  type ProcessedSignal,
} from "./signalEngine";

export type WifiSnapshot = {
  connectionState: "CONNECTED" | "DISCONNECTED" | "UNKNOWN";
  ssid: string | null;
  bssid: string | null;
  signalStrength: number | null;
  signalStrengthUnit: "dBm" | null;
  frequency: number | null;
};

const normalise = (value: string | null | undefined) =>
  !value ||
  value === "<unknown ssid>" ||
  value === "00:00:00:00:00:00" ||
  value === "02:00:00:00:00:00"
    ? null
    : value.replace(/^"|"$/g, "");

export function normalizeRssiToScore(
  signalStrength: number | null
): number | null {
  if (signalStrength === null || isNaN(signalStrength)) return null;

  if (signalStrength <= 0) {
    // Native RSSI in dBm (typically -100 to -30 dBm)
    const minDbm = -100;
    const maxDbm = -30;
    const score = (signalStrength - minDbm) / (maxDbm - minDbm);
    return Math.max(0, Math.min(1, score));
  } else {
    // Signal strength as percentage (0 - 100)
    const score = signalStrength / 100;
    return Math.max(0, Math.min(1, score));
  }
}

let wifiQueryChain: Promise<unknown> = Promise.resolve();

export async function getConnectedWifi(): Promise<WifiSnapshot> {
  const run = wifiQueryChain.then(() => getConnectedWifiUnlocked(), () => getConnectedWifiUnlocked());
  wifiQueryChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

async function getConnectedWifiUnlocked(): Promise<WifiSnapshot> {
  const state = await NetInfo.fetch();
  if (state.type !== NetInfoStateType.wifi || !state.isConnected) {
    return {
      connectionState: "DISCONNECTED",
      ssid: null,
      bssid: null,
      signalStrength: null,
      signalStrengthUnit: null,
      frequency: null,
    };
  }
  const details = state.details;
  // NetInfo `strength` is 0–100 on Android (calculateSignalLevel), not dBm. Never use it as RSSI.
  let signalStrength: number | null =
    Platform.OS === "android" ? null : (details?.strength ?? null);
  let frequency = details?.frequency ?? null;
  let bssid = normalise(details?.bssid);
  // Connected-network APIs only (WifiInfo.getRssi / getBSSID / getFrequency). No AP scan.
  if (Platform.OS === "android") {
    try {
      const getSafeBssid = async (): Promise<string | null> => {
        try {
          const val = await WifiManager.getBSSID();
          return typeof val === "string" && val ? val : null;
        } catch {
          return null;
        }
      };

      const getSafeRssi = async (): Promise<number | null> => {
        try {
          const val = await WifiManager.getCurrentSignalStrength();
          return isValidAndroidRssiDbm(val) ? val : null;
        } catch {
          return null;
        }
      };

      const getSafeFreq = async (): Promise<number | null> => {
        try {
          const val = await WifiManager.getFrequency();
          return typeof val === "number" && !isNaN(val) ? val : null;
        } catch {
          return null;
        }
      };

      const [nativeBssid, nativeRssi, nativeFrequency] = await Promise.allSettled([
        getSafeBssid(),
        getSafeRssi(),
        getSafeFreq(),
      ]);

      if (nativeBssid.status === "fulfilled" && nativeBssid.value) {
        bssid = normalise(nativeBssid.value) ?? bssid;
      }
      if (nativeRssi.status === "fulfilled" && nativeRssi.value !== null) {
        signalStrength = nativeRssi.value;
      }
      if (nativeFrequency.status === "fulfilled" && nativeFrequency.value !== null) {
        frequency = nativeFrequency.value;
      }
    } catch (e) {
      console.warn("WifiManager query bypassed or failed in background context:", e);
    }
  }

  const hasDbm =
    Platform.OS === "android"
      ? isValidAndroidRssiDbm(signalStrength)
      : signalStrength !== null;

  return {
    connectionState: "CONNECTED",
    ssid: normalise(details?.ssid),
    bssid,
    signalStrength,
    signalStrengthUnit: hasDbm ? "dBm" : null,
    frequency,
  };
}

/** Android: pass through WifiInfo dBm. iOS: Kalman + band calibration. */
export function processWifiSignal(
  wifi: WifiSnapshot,
  isMoving: boolean
): ProcessedSignal {
  if (Platform.OS === "android") {
    return nativeAndroidSignal(wifi.signalStrength, wifi.frequency);
  }
  return globalSignalEngine.processSignal(
    normalizeRssiToScore(wifi.signalStrength),
    wifi.frequency,
    isMoving
  );
}


