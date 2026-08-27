import NetInfo, { NetInfoStateType } from "@react-native-community/netinfo";
import { Platform } from "react-native";
import WifiManager from "react-native-wifi-reborn";

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
  value === "00:00:00:00:00:00"
    ? null
    : value.replace(/^"|"$/g, "");

export async function getConnectedWifi(): Promise<WifiSnapshot> {
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
  let signalStrength = details?.strength ?? null;
  let frequency = details?.frequency ?? null;
  let bssid = normalise(details?.bssid);
  // These calls inspect only the active Android connection; they never scan nearby access points.
  if (Platform.OS === "android") {
    const [nativeBssid, nativeRssi, nativeFrequency] = await Promise.allSettled([WifiManager.getBSSID(), WifiManager.getCurrentSignalStrength(), WifiManager.getFrequency()]);
    if (nativeBssid.status === "fulfilled") bssid = normalise(nativeBssid.value);
    if (nativeRssi.status === "fulfilled") signalStrength = nativeRssi.value;
    if (nativeFrequency.status === "fulfilled") frequency = nativeFrequency.value;
  }
  return {
    connectionState: "CONNECTED",
    ssid: normalise(details?.ssid),
    bssid,
    signalStrength,
    signalStrengthUnit: signalStrength === null ? null : "dBm",
    frequency,
  };
}
