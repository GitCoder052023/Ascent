import * as TaskManager from "expo-task-manager";
import * as Location from "expo-location";
import { Platform } from "react-native";
import { getConnectedWifi } from "../lib/wifi";
import { globalSignalEngine } from "../lib/signalEngine";
import { saveMeasurementBuffered, Floor } from "../lib/db";
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
  } catch (err) {
    console.error("Failed background sample tick:", err);
  }
});

export async function startBackgroundLoggingAsync(floor: Floor): Promise<boolean> {
  setBackgroundFloor(floor);

  const { status: foregroundStatus } =
    await Location.requestForegroundPermissionsAsync();
  if (foregroundStatus !== "granted") {
    return false;
  }

  const { status: backgroundStatus } =
    await Location.requestBackgroundPermissionsAsync();
  if (backgroundStatus !== "granted") {
    // On iOS, background location permission is needed for background location updates
    if (Platform.OS === "ios") {
      return false;
    }
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
}

export async function stopBackgroundLoggingAsync(): Promise<void> {
  const isRegistered =
    await TaskManager.isTaskRegisteredAsync(WIFI_LOGGER_BACKGROUND_TASK);
  if (isRegistered) {
    await Location.stopLocationUpdatesAsync(WIFI_LOGGER_BACKGROUND_TASK);
  }
}

export async function isBackgroundLoggingActiveAsync(): Promise<boolean> {
  return await TaskManager.isTaskRegisteredAsync(WIFI_LOGGER_BACKGROUND_TASK);
}
