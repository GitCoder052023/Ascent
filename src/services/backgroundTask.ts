import * as TaskManager from "expo-task-manager";
import * as Location from "expo-location";
import { flushRawWriteBuffer, flushWriteBuffer, type Floor } from "../lib/db";
import { ensureImuCollectorAlive } from "../lib/imuCollector";
import {
  hydrateLabelsFromStorage,
  KEY_ACTIVE_FLOOR,
  setCachedFloor,
} from "../lib/recordingContext";

export const WIFI_LOGGER_BACKGROUND_TASK = "wifi-logger-background-task";
export { KEY_ACTIVE_FLOOR };

let activeFloor: Floor = "FLOOR_1";

export function setBackgroundFloor(floor: Floor) {
  activeFloor = floor;
  setCachedFloor(floor);
}

/**
 * Older builds registered a location FGS that sampled Wi-Fi from JS.
 * Capture now lives in RecordingImuService. This task only revives native
 * IMU if an old registration is still alive, and never writes rows from JS.
 */
TaskManager.defineTask(WIFI_LOGGER_BACKGROUND_TASK, async () => {
  try {
    const labels = await hydrateLabelsFromStorage();
    const floor =
      labels.floor === "FLOOR_1" || labels.floor === "FLOOR_2"
        ? labels.floor
        : activeFloor;
    setCachedFloor(floor);
    if (labels.recording || labels.sessionId) {
      await ensureImuCollectorAlive().catch(() => {});
    }
  } catch (err) {
    console.error("Failed background keep-alive tick:", err);
  }
});

export async function stopBackgroundLoggingAsync(): Promise<void> {
  try {
    await flushWriteBuffer();
    await flushRawWriteBuffer();
    const isRegistered =
      await TaskManager.isTaskRegisteredAsync(WIFI_LOGGER_BACKGROUND_TASK);
    if (isRegistered) {
      await Location.stopLocationUpdatesAsync(WIFI_LOGGER_BACKGROUND_TASK);
    }
  } catch (e) {
    console.error("Failed to stop background location updates:", e);
  }
}

export async function isBackgroundLoggingActiveAsync(): Promise<boolean> {
  try {
    return await TaskManager.isTaskRegisteredAsync(WIFI_LOGGER_BACKGROUND_TASK);
  } catch (e) {
    console.error("Failed checking background logging active status:", e);
    return false;
  }
}
