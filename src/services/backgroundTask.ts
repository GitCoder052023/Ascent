import * as TaskManager from "expo-task-manager";
import * as Location from "expo-location";
import { getConnectedWifi } from "../lib/wifi";
import { globalSignalEngine } from "../lib/signalEngine";
import { saveMeasurementBuffered, flushWriteBuffer, Floor } from "../lib/db";
import { createMeasurement } from "../lib/dataset";

export const WIFI_LOGGER_BACKGROUND_TASK = "wifi-logger-background-task";

let activeFloor: Floor = "FLOOR_1";

export function setBackgroundFloor(floor: Floor) {
  activeFloor = floor;
}

TaskManager.defineTask(WIFI_LOGGER_BACKGROUND_TASK, async ({ error }) => {
  if (error) {
    console.error("Background task error:", error);
    return;
  }

  try {
    const wifi = await getConnectedWifi();
    if (wifi.connectionState !== "CONNECTED" || !wifi.ssid) {
      return;
    }

    const processed = globalSignalEngine.processSignal(
      wifi.signalStrength !== null ? wifi.signalStrength / 100 : null,
      wifi.frequency
    );

    const item = createMeasurement(activeFloor, wifi, processed);
    await saveMeasurementBuffered(item);
    await flushWriteBuffer();
  } catch (err) {
    console.error("Failed background sample tick:", err);
  }
});

export async function startBackgroundLoggingAsync(floor: Floor): Promise<boolean> {
  setBackgroundFloor(floor);

  try {
    const { status: foregroundStatus } =
      await Location.requestForegroundPermissionsAsync();
    if (foregroundStatus !== "granted") {
      return false;
    }

    const { status: backgroundStatus } =
      await Location.requestBackgroundPermissionsAsync();
    if (backgroundStatus !== "granted") {
      // Background location permission is required for continuous background tracking on both iOS & Android
      return false;
    }

    const isAlreadyRegistered =
      await TaskManager.isTaskRegisteredAsync(WIFI_LOGGER_BACKGROUND_TASK);
    if (!isAlreadyRegistered) {
      await Location.startLocationUpdatesAsync(WIFI_LOGGER_BACKGROUND_TASK, {
        accuracy: Location.Accuracy.Balanced,
        distanceInterval: 2, // 2 meters movement
        timeInterval: 5000,  // Or every 5 seconds
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: "Wi-Fi Logger Active",
          notificationBody: "Sampling connected Wi-Fi metrics in background...",
          notificationColor: "#208AEF",
        },
      });
    }

    return true;
  } catch (e) {
    console.error("Failed to start background location updates:", e);
    return false;
  }
}

export async function stopBackgroundLoggingAsync(): Promise<void> {
  try {
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

