import NetInfo, { NetInfoStateType } from "@react-native-community/netinfo";
import {
  isValidAndroidRssiDbm,
  nativeAndroidSignal,
  type ProcessedSignal,
} from "../signalEngine";
import { normaliseWifiIdentity } from "./identity";
import { readNativeWifiInfo } from "./nativeInfo";

export type WifiSnapshot = {
  connectionState: "CONNECTED" | "DISCONNECTED" | "UNKNOWN";
  ssid: string | null;
  bssid: string | null;
  signalStrength: number | null;
  signalStrengthUnit: "dBm" | null;
  frequency: number | null;
};

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
  let signalStrength: number | null = null;
  let frequency = details?.frequency ?? null;
  let bssid = normaliseWifiIdentity(details?.bssid);
  try {
    const native = await readNativeWifiInfo();
    if (native.bssid) {
      bssid = normaliseWifiIdentity(native.bssid) ?? bssid;
    }
    if (native.rssi !== null) {
      signalStrength = native.rssi;
    }
    if (native.frequency !== null) {
      frequency = native.frequency;
    }
  } catch (e) {
    console.warn("WifiManager query bypassed or failed in background context:", e);
  }

  return {
    connectionState: "CONNECTED",
    ssid: normaliseWifiIdentity(details?.ssid),
    bssid,
    signalStrength,
    signalStrengthUnit: isValidAndroidRssiDbm(signalStrength) ? "dBm" : null,
    frequency,
  };
}

export function processWifiSignal(wifi: WifiSnapshot): ProcessedSignal {
  return nativeAndroidSignal(wifi.signalStrength, wifi.frequency);
}
