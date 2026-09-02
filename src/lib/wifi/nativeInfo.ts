import WifiManager from "react-native-wifi-reborn";
import { isValidAndroidRssiDbm } from "../signalEngine";

export async function readNativeWifiInfo(): Promise<{
  bssid: string | null;
  rssi: number | null;
  frequency: number | null;
}> {
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

  return {
    bssid:
      nativeBssid.status === "fulfilled" && nativeBssid.value ? nativeBssid.value : null,
    rssi:
      nativeRssi.status === "fulfilled" && nativeRssi.value !== null
        ? nativeRssi.value
        : null,
    frequency:
      nativeFrequency.status === "fulfilled" && nativeFrequency.value !== null
        ? nativeFrequency.value
        : null,
  };
}
