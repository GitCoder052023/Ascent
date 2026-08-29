import * as TaskManager from "expo-task-manager";
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getConnectedWifi, normalizeRssiToScore } from "../lib/wifi";
import { globalSignalEngine } from "../lib/signalEngine";
import { saveMeasurementBuffered, flushWriteBuffer, Floor } from "../lib/db";
import { createMeasurement } from "../lib/dataset";

import { KEY_LAST_MOTION } from "../hooks/useMotionDetector";

export const WIFI_LOGGER_BACKGROUND_TASK = "wifi-logger-background-task";
export const KEY_ACTIVE_FLOOR = "@wifi_logger_active_floor";

let activeFloor: Floor = "FLOOR_1";

export function setBackgroundFloor(floor: Floor) {
  activeFloor = floor;
  void AsyncStorage.setItem(KEY_ACTIVE_FLOOR, floor).catch(() => {});
}

TaskManager.defineTask(WIFI_LOGGER_BACKGROUND_TASK, async ({ data, error }) => {
  if (error) {
    console.error("Background task error:", error);
    return;
  }

  try {
    const wifi = await getConnectedWifi();
    if (wifi.connectionState !== "CONNECTED" || !wifi.ssid) {
      return;
    }

    let isMoving = false;
    const now = Date.now();

    // 1. Evaluate movement/speed from background location updates
    if (data && typeof data === "object" && "locations" in data && Array.isArray((data as any).locations)) {
      const locations = (data as any).locations as Location.LocationObject[];
      for (const loc of locations) {
        if (loc.coords && typeof loc.coords.speed === "number" && loc.coords.speed > 0.2) {
          isMoving = true;
          break;
        }
      }
    }

    // 2. Evaluate recent accelerometer motion timestamp
    if (!isMoving) {
      try {
        const storedLastMotion = await AsyncStorage.getItem(KEY_LAST_MOTION);
        if (storedLastMotion) {
          const timestamp = parseInt(storedLastMotion, 10);
          if (!isNaN(timestamp) && now - timestamp < 8000) {
            isMoving = true;
          }
        }
      } catch {
        // Ignore read errors
      }
    }

    const storedFloor = (await AsyncStorage.getItem(KEY_ACTIVE_FLOOR)) as Floor | null;
    const currentFloor = storedFloor === "FLOOR_1" || storedFloor === "FLOOR_2" ? storedFloor : activeFloor;

    const rawScore = normalizeRssiToScore(wifi.signalStrength);
    const processed = globalSignalEngine.processSignal(
      rawScore,
      wifi.frequency,
      isMoving
    );

    const item = createMeasurement(currentFloor, wifi, processed);
    await saveMeasurementBuffered(item);
    await flushWriteBuffer();
  } catch (err) {
    console.error("Failed background sample tick:", err);
  }
});

export async function startBackgroundLoggingAsync(floor: Floor): Promise<boolean> {
  setBackgroundFloor(floor);

  try {
    let fgStatus = (await Location.getForegroundPermissionsAsync()).status;
    if (fgStatus !== "granted") {
      fgStatus = (await Location.requestForegroundPermissionsAsync()).status;
    }
    if (fgStatus !== "granted") {
      return false;
    }

    let bgStatus = (await Location.getBackgroundPermissionsAsync()).status;
    if (bgStatus !== "granted") {
      bgStatus = (await Location.requestBackgroundPermissionsAsync()).status;
    }
    if (bgStatus !== "granted") {
      // Background location permission is required for continuous background tracking on both iOS & Android
      return false;
    }

    const isAlreadyRegistered =
      await TaskManager.isTaskRegisteredAsync(WIFI_LOGGER_BACKGROUND_TASK);
    if (!isAlreadyRegistered) {
      await Location.startLocationUpdatesAsync(WIFI_LOGGER_BACKGROUND_TASK, {
        accuracy: Location.Accuracy.High,
        distanceInterval: 1, // 1 meter movement trigger
        timeInterval: 3000,  // Every 3 seconds in background
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: "Wi-Fi Logger Active",
          notificationBody: "Sampling connected Wi-Fi & motion metrics in background...",
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

