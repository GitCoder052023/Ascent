import * as TaskManager from "expo-task-manager";
import * as Location from "expo-location";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getConnectedWifi, processWifiSignal } from "../lib/wifi";
import { flushRawWriteBuffer, flushWriteBuffer, Floor } from "../lib/db";
import { createMeasurement, persistWifiMeasurement } from "../lib/dataset";
import { KEY_LAST_MOTION } from "../hooks/useMotionDetector";
import { ensureImuCollectorAlive } from "../lib/imuCollector";
import {
  hydrateLabelsFromStorage,
  KEY_ACTIVE_FLOOR,
  setCachedFloor,
} from "../lib/recordingContext";

export const WIFI_LOGGER_BACKGROUND_TASK = "wifi-logger-background-task";
export { KEY_ACTIVE_FLOOR };

const MIN_BACKGROUND_SAMPLE_MS = 3000;
const SAMPLE_IN_FLIGHT_TIMEOUT_MS = 30000;

let activeFloor: Floor = "FLOOR_1";
let lastBackgroundSampleAt = 0;
let sampleInFlight = false;
let sampleInFlightStartedAt = 0;

export function setBackgroundFloor(floor: Floor) {
  activeFloor = floor;
  setCachedFloor(floor);
}

TaskManager.defineTask(WIFI_LOGGER_BACKGROUND_TASK, async ({ data, error }) => {
  if (error) {
    console.error("Background task error:", error);
    return;
  }

  const now = Date.now();
  if (sampleInFlight && now - sampleInFlightStartedAt > SAMPLE_IN_FLIGHT_TIMEOUT_MS) {
    sampleInFlight = false;
  }

  if (sampleInFlight || now - lastBackgroundSampleAt < MIN_BACKGROUND_SAMPLE_MS) {
    return;
  }

  sampleInFlight = true;
  sampleInFlightStartedAt = now;
  lastBackgroundSampleAt = now;

  try {
    const labels = await hydrateLabelsFromStorage();
    await ensureImuCollectorAlive().catch(() => {});

    const wifi = await getConnectedWifi();
    if (wifi.connectionState !== "CONNECTED" || !wifi.ssid) {
      return;
    }

    let isMoving = false;

    if (data && typeof data === "object" && "locations" in data && Array.isArray((data as any).locations)) {
      const locations = (data as any).locations as Location.LocationObject[];
      for (const loc of locations) {
        if (loc.coords && typeof loc.coords.speed === "number" && loc.coords.speed > 0.2) {
          isMoving = true;
          break;
        }
      }
    }

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

    const currentFloor =
      labels.floor === "GROUND_FLOOR" || labels.floor === "FLOOR_1" || labels.floor === "FLOOR_2"
        ? labels.floor
        : activeFloor;

    const processed = processWifiSignal(wifi, isMoving);
    const item = createMeasurement(currentFloor, wifi, processed);
    await persistWifiMeasurement(item, {
      sessionId: labels.sessionId,
      activity: labels.activity,
      motionState: isMoving ? "WALKING" : labels.motionState,
    });
    await flushWriteBuffer();
    await flushRawWriteBuffer();
  } catch (err) {
    console.error("Failed background sample tick:", err);
  } finally {
    sampleInFlight = false;
  }
});

export async function startBackgroundLoggingAsync(floor: Floor): Promise<boolean> {
  setBackgroundFloor(floor);

  if (Platform.OS === "android") {
    return false;
  }

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
      return false;
    }

    const alreadyRunning = await TaskManager.isTaskRegisteredAsync(
      WIFI_LOGGER_BACKGROUND_TASK
    );
    if (!alreadyRunning) {
      await Location.startLocationUpdatesAsync(WIFI_LOGGER_BACKGROUND_TASK, {
        accuracy: Location.Accuracy.Balanced,
        distanceInterval: 10,
        timeInterval: 15000,
        deferredUpdatesInterval: 15000,
        deferredUpdatesDistance: 25,
        pausesUpdatesAutomatically: false,
        showsBackgroundLocationIndicator: true,
        activityType: Location.ActivityType.Fitness,
        mayShowUserSettingsDialog: false,
        foregroundService: {
          notificationTitle: "Ascent is recording",
          notificationBody: "Keep this notification visible. IMU and Wi-Fi rows are being written.",
          killServiceOnDestroy: false,
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
