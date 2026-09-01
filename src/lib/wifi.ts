import NetInfo, { NetInfoStateType } from "@react-native-community/netinfo";
import WifiManager from "react-native-wifi-reborn";
import {
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
  let signalStrength: number | null = null;
  let frequency = details?.frequency ?? null;
  let bssid = normalise(details?.bssid);
  // Connected-network APIs only (WifiInfo.getRssi / getBSSID / getFrequency). No AP scan.
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

  return {
    connectionState: "CONNECTED",
    ssid: normalise(details?.ssid),
    bssid,
    signalStrength,
    signalStrengthUnit: isValidAndroidRssiDbm(signalStrength) ? "dBm" : null,
    frequency,
  };
}

/** Pass through Android WifiInfo dBm and derive a band-normalized score. */
export function processWifiSignal(wifi: WifiSnapshot): ProcessedSignal {
  return nativeAndroidSignal(wifi.signalStrength, wifi.frequency);
}
