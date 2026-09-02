import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { DeviceMeta } from "../../lib/deviceMeta";
import {
  isImuCollectorRunning,
  isUsingNativeImu,
  startImuCollector,
} from "../../lib/imuCollector";
import { isNativeImuRecording } from "../../../modules/recording-keepalive";
import { KEY_LOCKED_SSID, setCachedLockedSsid, setCachedRecording } from "../../lib/recordingContext";
import {
  isBackgroundLoggingActiveAsync,
  stopBackgroundLoggingAsync,
} from "../../services/backgroundTask";
import { KEY_STARTED } from "./cacheWifi";

export type RestoreRecordingSetters = {
  setStarted: (value: number) => void;
  setNetwork: (value: string | null) => void;
  setRecording: (value: boolean) => void;
  setNativeCapture: (value: boolean) => void;
};

export async function restoreRecordingIfNeeded(
  deviceMeta: DeviceMeta,
  setters: RestoreRecordingSetters
): Promise<void> {
  try {
    if (Platform.OS === "android") {
      if (await isBackgroundLoggingActiveAsync()) {
        await stopBackgroundLoggingAsync().catch(() => {});
      }
    }

    const storedStarted = await AsyncStorage.getItem(KEY_STARTED);
    const nativeOn = isNativeImuRecording();
    if (!storedStarted && !nativeOn) {
      return;
    }

    const storedNetwork = await AsyncStorage.getItem(KEY_LOCKED_SSID);
    if (storedStarted) {
      const parsed = parseInt(storedStarted, 10);
      if (!isNaN(parsed)) {
        setters.setStarted(parsed);
      }
    } else {
      const now = Date.now();
      setters.setStarted(now);
      await AsyncStorage.setItem(KEY_STARTED, String(now)).catch(() => {});
    }
    if (storedNetwork) {
      setters.setNetwork(storedNetwork);
      setCachedLockedSsid(storedNetwork);
    }
    if (!isImuCollectorRunning()) {
      await startImuCollector(deviceMeta);
    }
    if (!isImuCollectorRunning() && !isNativeImuRecording()) {
      return;
    }
    setters.setRecording(true);
    setCachedRecording(true);
    setters.setNativeCapture(isUsingNativeImu() || isNativeImuRecording());
  } catch {
    // Ignore restore errors; the user can start a new session.
  }
}
