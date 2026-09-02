import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Floor, Measurement } from "../../lib/dataset";
import { loadMeasurements } from "../../lib/dataset";
import {
  endRecordingSession,
  flushRawWriteBuffer,
  flushWriteBuffer,
  getRawObservationCount,
  getWifiMeasurementCount,
  insertRecordingSession,
  nextSessionId,
} from "../../lib/db";
import type { DeviceMeta } from "../../lib/deviceMeta";
import {
  isImuCollectorRunning,
  isUsingNativeImu,
  startImuCollector,
  stopImuCollector,
} from "../../lib/imuCollector";
import { formatIsoMillis } from "../../lib/rawObservation";
import { PLATFORM_SENSOR_NOTES, type ActivityLabel } from "../../lib/rawTypes";
import {
  setCachedActivity,
  setCachedFloor,
  setCachedLockedSsid,
  setCachedRecording,
  setCachedSessionId,
} from "../../lib/recordingContext";
import { isNativeImuRecording } from "../../../modules/recording-keepalive";
import { probeSensorAvailability } from "../useRawSensorCollector";
import {
  ensureUnrestrictedBattery,
  requestRecordingPermissions,
} from "../../permissions/recordingPermissions";
import { getConnectedWifi, type WifiSnapshot } from "../../lib/wifi";
import { stopBackgroundLoggingAsync } from "../../services/backgroundTask";
import { KEY_STARTED } from "./cacheWifi";
import { joinNotices } from "./notices";

type SessionSetters = {
  setWifi: (wifi: WifiSnapshot) => void;
  setSessionId: (value: string | null) => void;
  setStarted: (value: number | null) => void;
  setSeconds: (value: number) => void;
  setPaused: (value: boolean) => void;
  setNetwork: (value: string | null) => void;
  setNativeCapture: (value: boolean) => void;
  setRecording: (value: boolean) => void;
  setNotice: (value: string | null) => void;
};

export async function abortFailedStart(setters: SessionSetters): Promise<void> {
  setters.setRecording(false);
  setters.setPaused(false);
  setCachedRecording(false);
  setters.setNativeCapture(false);
  await stopImuCollector().catch(() => {});
  await AsyncStorage.removeItem(KEY_STARTED).catch(() => {});
  setCachedLockedSsid(null);
  setters.setNetwork(null);
  setCachedSessionId(null);
  setters.setSessionId(null);
  setters.setStarted(null);
  setters.setSeconds(0);
}

export async function startRecordingSession(
  options: SessionSetters & {
    recording: boolean;
    startingRef: { current: boolean };
    floor: Floor;
    activity: ActivityLabel | null;
    deviceMeta: DeviceMeta;
    sample: () => Promise<void>;
  }
): Promise<void> {
  if (options.recording || options.startingRef.current) {
    return;
  }
  options.startingRef.current = true;
  try {
    if (isNativeImuRecording() || isImuCollectorRunning()) {
      await stopImuCollector().catch(() => {});
    }
    if (!(await requestRecordingPermissions(options.setNotice))) {
      return;
    }
    if (!(await ensureUnrestrictedBattery())) {
      options.setNotice(
        "Recording did not start. Allow unrestricted battery, then tap Start Recording again."
      );
      return;
    }

    const current = await getConnectedWifi();
    options.setWifi(current);

    const now = Date.now();
    const availability = await probeSensorAvailability();
    const newSessionId = await nextSessionId();
    await insertRecordingSession({
      id: newSessionId,
      startedAt: formatIsoMillis(now),
      endedAt: null,
      accelerometerAvailable: availability.accelerometerAvailable,
      gyroscopeAvailable: availability.gyroscopeAvailable,
      barometerAvailable: availability.barometerAvailable,
      platform: options.deviceMeta.platform,
      deviceModel: options.deviceMeta.deviceModel,
      osVersion: options.deviceMeta.osVersion,
      notes: PLATFORM_SENSOR_NOTES,
    });

    setCachedSessionId(newSessionId);
    setCachedFloor(options.floor);
    setCachedActivity(options.activity);
    setCachedRecording(true);
    options.setSessionId(newSessionId);
    options.setStarted(now);
    options.setSeconds(0);
    options.setPaused(false);

    await AsyncStorage.setItem(KEY_STARTED, String(now));
    if (current.connectionState === "CONNECTED" && current.ssid) {
      setCachedLockedSsid(current.ssid);
      options.setNetwork(current.ssid);
    } else {
      setCachedLockedSsid(null);
      options.setNetwork(null);
    }

    await startImuCollector(options.deviceMeta);
    options.setNativeCapture(isUsingNativeImu());
    options.setRecording(true);

    if (Platform.OS === "android") {
      await stopBackgroundLoggingAsync().catch(() => {});
    }

    options.setNotice(
      joinNotices(
        Platform.OS === "android" && isUsingNativeImu()
          ? "Keep the IMU notification visible and lock Ascent in Recents."
          : null,
        !availability.barometerAvailable
          ? "No barometer on this device. Pressure rows will not be written."
          : null,
        current.connectionState !== "CONNECTED" || !current.ssid
          ? "No Wi-Fi connection. Recording IMU/barometer only; Wi-Fi rows will appear if you connect later."
          : null
      )
    );

    if (!isUsingNativeImu()) {
      await options.sample();
    }
  } catch (e) {
    console.warn("Could not start recording:", e);
    await abortFailedStart(options);
    options.setNotice("Recording could not start. Try again.");
  } finally {
    options.startingRef.current = false;
  }
}

export async function stopRecordingSession(options: SessionSetters & {
  sessionId: string | null;
  rawCount: number;
  itemsLength: number;
  setItems: (items: Measurement[]) => void;
  setRawCount: (value: number) => void;
  setWifiCount: (value: number) => void;
}): Promise<void> {
  options.setRecording(false);
  options.setPaused(false);
  setCachedRecording(false);
  options.setNativeCapture(false);
  await stopImuCollector();
  await AsyncStorage.removeItem(KEY_STARTED);
  setCachedLockedSsid(null);
  options.setNetwork(null);
  try {
    await stopBackgroundLoggingAsync();
  } catch (e) {
    console.warn("Could not stop background task:", e);
  }
  await flushWriteBuffer();
  await flushRawWriteBuffer();
  if (options.sessionId) {
    await endRecordingSession(options.sessionId, formatIsoMillis(Date.now()));
  }
  setCachedSessionId(null);
  options.setSessionId(null);
  try {
    const measurements = await loadMeasurements();
    options.setItems(measurements);
  } catch {
    // Keep the in-memory list if the reload fails.
  }
  const count = await getRawObservationCount().catch(() => options.rawCount);
  options.setRawCount(count);
  const wCount = await getWifiMeasurementCount().catch(() => options.itemsLength);
  options.setWifiCount(wCount);
  options.setNotice("Recording stopped. Your dataset remains stored on this device.");
}
