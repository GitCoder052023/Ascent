import { EMPTY_WIFI } from "../../constants/app";
import type { Floor, Measurement } from "../../lib/dataset";
import { createMeasurement, persistWifiMeasurement } from "../../lib/dataset";
import { isNativeImuAvailable } from "../../../modules/recording-keepalive";
import { getConnectedWifi, processWifiSignal, type WifiSnapshot } from "../../lib/wifi";
import { cacheWifiFields } from "./cacheWifi";

export async function refreshWifi(setters: {
  setWifi: (wifi: WifiSnapshot) => void;
  setLastProcessed: (value: ReturnType<typeof processWifiSignal>) => void;
}): Promise<void> {
  try {
    const current = await getConnectedWifi();
    setters.setWifi(current);
    cacheWifiFields(current);
    setters.setLastProcessed(processWifiSignal(current));
  } catch {
    setters.setWifi(EMPTY_WIFI);
  }
}

export async function sampleWifiJs(options: {
  nativeCapture: boolean;
  floor: Floor;
  network: string | null;
  lastSampleKey: { current: string | null };
  setWifi: (wifi: WifiSnapshot) => void;
  setPaused: (paused: boolean) => void;
  setNotice: (notice: string | null) => void;
  setLastProcessed: (value: ReturnType<typeof processWifiSignal>) => void;
  setItems: (updater: (old: Measurement[]) => Measurement[]) => void;
}): Promise<void> {
  if (isNativeImuAvailable() || options.nativeCapture) {
    return;
  }
  try {
    const current = await getConnectedWifi();
    options.setWifi(current);
    cacheWifiFields(current);

    if (options.network && current.ssid && current.ssid !== options.network) {
      options.setPaused(true);
      options.setNotice(
        `WARNING: Connected Wi-Fi changed. Previous: ${options.network}. Current: ${current.ssid}. IMU and Wi-Fi rows still record.`
      );
    }

    const processed = processWifiSignal(current);
    options.setLastProcessed(processed);

    const item = createMeasurement(options.floor, current, processed);
    const key = `${item.timestamp.slice(0, 19)}-${item.ssid}-${item.bssid}-${item.signalStrength}-${item.floor}`;

    if (key === options.lastSampleKey.current) {
      return;
    }

    options.lastSampleKey.current = key;
    await persistWifiMeasurement(item);
    options.setItems((old) => [...old, item]);
  } catch {
    options.setNotice(
      "A Wi-Fi reading failed. IMU recording continues; Wi-Fi will retry at the next interval."
    );
  }
}
