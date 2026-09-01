import { Accelerometer, Barometer, Gyroscope } from "expo-sensors";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import * as Device from "expo-device";
import { Platform } from "react-native";
import {
  acquireCpuWakeLock,
  isNativeImuAvailable,
  nativeImuLastSampleAgeMs,
  probeNativeAvailability,
  releaseCpuWakeLock,
  startNativeImuRecording,
  stopNativeImuRecording,
  subscribeNativeImuLatest,
  updateNativeImuLabels,
} from "../../modules/recording-keepalive";
import { flushRawWriteBuffer, saveRawObservationBuffered } from "./db";
import {
  createAccelerometerObservation,
  createBarometerObservation,
  createGyroscopeObservation,
  type DeviceMeta,
} from "./rawObservation";
import { getCachedLabels, setCachedMotionState } from "./recordingContext";
import type { SensorAvailability } from "./rawTypes";

export const ACCEL_REQUESTED_INTERVAL_MS = 20;
export const GYRO_REQUESTED_INTERVAL_MS = 20;
export const BARO_REQUESTED_INTERVAL_MS = 200;
export const MOTION_DETECTOR_INTERVAL_MS = 100;

export type LatestRaw = {
  accelerometer: string | null;
  gyroscope: string | null;
  barometer: string | null;
  wifi: string | null;
};

const emptyLatest: LatestRaw = {
  accelerometer: null,
  gyroscope: null,
  barometer: null,
  wifi: null,
};

let startChain: Promise<unknown> = Promise.resolve();
let running = false;
let usingNativeImu = false;
let nativeLatestUnsub: (() => void) | null = null;
let startGeneration = 0;
let deviceMeta: DeviceMeta | null = null;
let subscriptions: { remove: () => void }[] = [];
let latestLocal: LatestRaw = { ...emptyLatest };
let lastUi = 0;
let lastSampleAt = 0;
let gravityEstimate = 1;
let lastWalkAt = 0;
const latestListeners = new Set<(latest: LatestRaw) => void>();

export async function probeSensorAvailability(): Promise<SensorAvailability> {
  const native = probeNativeAvailability();
  if (native) {
    return native;
  }
  const [accelerometerAvailable, gyroscopeAvailable, barometerAvailable] =
    await Promise.all([
      Accelerometer.isAvailableAsync().catch(() => false),
      Gyroscope.isAvailableAsync().catch(() => false),
      Barometer.isAvailableAsync().catch(() => false),
    ]);

  return {
    accelerometerAvailable,
    gyroscopeAvailable,
    barometerAvailable,
  };
}

export async function requestMotionPermissions(): Promise<boolean> {
  try {
    const result = await Accelerometer.requestPermissionsAsync();
    return result.granted;
  } catch {
    return true;
  }
}

export function getLatestRaw(): LatestRaw {
  return { ...latestLocal };
}

export function subscribeLatestRaw(listener: (latest: LatestRaw) => void): () => void {
  latestListeners.add(listener);
  listener({ ...latestLocal });
  return () => {
    latestListeners.delete(listener);
  };
}

export function syncNativeRecordingLabels(): void {
  if (!isNativeImuAvailable()) {
    return;
  }
  const labels = getCachedLabels();
  const device = deviceMeta ?? defaultDevice();
  updateNativeImuLabels({
    sessionId: labels.sessionId,
    floor: labels.floor,
    activity: labels.activity,
    motionState: labels.motionState,
    deviceModel: device.deviceModel,
    osVersion: device.osVersion,
    lockedSsid: labels.lockedSsid,
  });
}

export function isUsingNativeImu(): boolean {
  return usingNativeImu;
}

function publishLatest(partial: Partial<LatestRaw>) {
  Object.assign(latestLocal, partial);
  const now = Date.now();
  if (now - lastUi < 750) {
    return;
  }
  lastUi = now;
  const snapshot = { ...latestLocal };
  for (const listener of latestListeners) {
    listener(snapshot);
  }
}

function attachSensor(
  available: boolean,
  start: () => { remove: () => void }
) {
  if (!available || !running) {
    return;
  }
  try {
    const subscription = start();
    if (!running) {
      subscription.remove();
      return;
    }
    subscriptions.push(subscription);
  } catch {
    // Leave this sensor off; others can continue.
  }
}

function clearSubscriptions() {
  for (const subscription of subscriptions) {
    try {
      subscription.remove();
    } catch {
      // Ignore.
    }
  }
  subscriptions = [];
}

function ensureNativeLatestSubscription() {
  if (nativeLatestUnsub) {
    return;
  }
  nativeLatestUnsub = subscribeNativeImuLatest((event) => {
    lastSampleAt = event.lastSampleAt || Date.now();
    if (event.motionState === "WALKING" || event.motionState === "STATIONARY") {
      setCachedMotionState(event.motionState);
    }
    publishLatest({
      accelerometer: event.accelerometer,
      gyroscope: event.gyroscope,
      barometer: event.barometer,
      wifi: event.wifiTimestamp ?? latestLocal.wifi,
    });
  });
}

/**
 * IMU collection is a process singleton so Activity pause/remount (the Android
 * "app closed" flash when the location FGS starts) does not tear down listeners.
 */
export async function startImuCollector(device: DeviceMeta): Promise<SensorAvailability> {
  const run = startChain.then(
    () => startImuCollectorUnlocked(device),
    () => startImuCollectorUnlocked(device)
  );
  startChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

async function startImuCollectorUnlocked(device: DeviceMeta): Promise<SensorAvailability> {
  deviceMeta = device;
  const generation = ++startGeneration;
  running = true;

  const available = await probeSensorAvailability();
  if (!running || generation !== startGeneration) {
    return available;
  }

  latestLocal = { ...emptyLatest };
  lastUi = 0;
  lastSampleAt = Date.now();

  if (isNativeImuAvailable()) {
    const labels = getCachedLabels();
    const started = await startNativeImuRecording({
      sessionId: labels.sessionId,
      floor: labels.floor,
      activity: labels.activity,
      motionState: labels.motionState,
      deviceModel: device.deviceModel,
      osVersion: device.osVersion,
      lockedSsid: labels.lockedSsid,
    });
    if (started) {
      usingNativeImu = true;
      clearSubscriptions();
      ensureNativeLatestSubscription();
      return available;
    }
  }

  usingNativeImu = false;

  if (Platform.OS === "android") {
    acquireCpuWakeLock();
  } else {
    try {
      await activateKeepAwakeAsync("raw-sensor-collector");
    } catch {
      // Keep-awake is optional.
    }
  }

  clearSubscriptions();

  attachSensor(available.accelerometerAvailable, () => {
    Accelerometer.setUpdateInterval(ACCEL_REQUESTED_INTERVAL_MS);
    return Accelerometer.addListener(({ x, y, z, timestamp }) => {
      if (!running || !deviceMeta) return;
      try {
        const labels = getCachedLabels();
        const arrivalMs = Date.now();
        const row = createAccelerometerObservation(
          arrivalMs,
          typeof timestamp === "number" ? timestamp : null,
          x,
          y,
          z,
          labels,
          deviceMeta
        );
        void saveRawObservationBuffered(row).catch(() => {});
        lastSampleAt = arrivalMs;
        gravityEstimate = 0.85 * gravityEstimate + 0.15 * Math.sqrt(x * x + y * y + z * z);
        const linear = Math.abs(Math.sqrt(x * x + y * y + z * z) - gravityEstimate);
        if (linear > 0.045) {
          lastWalkAt = arrivalMs;
        }
        setCachedMotionState(arrivalMs - lastWalkAt < 6000 ? "WALKING" : "STATIONARY");
        publishLatest({ accelerometer: row.timestamp });
      } catch {
        // Continue other sensors.
      }
    });
  });

  attachSensor(available.gyroscopeAvailable, () => {
    Gyroscope.setUpdateInterval(GYRO_REQUESTED_INTERVAL_MS);
    return Gyroscope.addListener(({ x, y, z, timestamp }) => {
      if (!running || !deviceMeta) return;
      try {
        const labels = getCachedLabels();
        const arrivalMs = Date.now();
        const row = createGyroscopeObservation(
          arrivalMs,
          typeof timestamp === "number" ? timestamp : null,
          x,
          y,
          z,
          labels,
          deviceMeta
        );
        void saveRawObservationBuffered(row).catch(() => {});
        lastSampleAt = arrivalMs;
        publishLatest({ gyroscope: row.timestamp });
      } catch {
        // Continue other sensors.
      }
    });
  });

  attachSensor(available.barometerAvailable, () => {
    Barometer.setUpdateInterval(BARO_REQUESTED_INTERVAL_MS);
    return Barometer.addListener((reading) => {
      if (!running || !deviceMeta) return;
      try {
        const pressure = reading.pressure;
        if (typeof pressure !== "number" || !Number.isFinite(pressure)) {
          return;
        }
        const labels = getCachedLabels();
        const arrivalMs = Date.now();
        const timestamp =
          "timestamp" in reading && typeof reading.timestamp === "number"
            ? reading.timestamp
            : null;
        const row = createBarometerObservation(
          arrivalMs,
          timestamp,
          pressure,
          labels,
          deviceMeta
        );
        void saveRawObservationBuffered(row).catch(() => {});
        lastSampleAt = arrivalMs;
        publishLatest({ barometer: row.timestamp });
      } catch {
        // Continue other sensors.
      }
    });
  });

  return available;
}

function defaultDevice(): DeviceMeta {
  return {
    platform: Platform.OS,
    deviceModel: Device.modelName ?? null,
    osVersion: Platform.Version?.toString() ?? null,
  };
}

export async function ensureImuCollectorAlive(): Promise<void> {
  const labels = getCachedLabels();
  const shouldRun = running || Boolean(labels.sessionId) || labels.recording;
  if (!shouldRun) {
    return;
  }

  const device = deviceMeta ?? defaultDevice();
  if (usingNativeImu || isNativeImuAvailable()) {
    if (nativeImuLastSampleAgeMs() > 1500) {
      await startImuCollector(device);
    } else {
      syncNativeRecordingLabels();
    }
    return;
  }

  if (!running) {
    await startImuCollector(device);
    return;
  }
  if (Date.now() - lastSampleAt < 1500) {
    return;
  }
  await startImuCollector(device);
}

export async function stopImuCollector(): Promise<void> {
  running = false;
  usingNativeImu = false;
  startGeneration += 1;
  clearSubscriptions();
  nativeLatestUnsub?.();
  nativeLatestUnsub = null;
  try {
    Accelerometer.setUpdateInterval(MOTION_DETECTOR_INTERVAL_MS);
  } catch {
    // Ignore.
  }
  try {
    await stopNativeImuRecording();
  } catch {
    // Ignore.
  }
  try {
    releaseCpuWakeLock();
  } catch {
    // Ignore.
  }
  try {
    await deactivateKeepAwake("raw-sensor-collector");
  } catch {
    // Ignore.
  }
  await flushRawWriteBuffer();
}

export function isImuCollectorRunning(): boolean {
  return running;
}
