import { Accelerometer, Barometer, Gyroscope } from "expo-sensors";
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
import { attachJsImuSensors } from "../capture/jsImuFallback";
import {
  EMPTY_LATEST_RAW,
  MOTION_DETECTOR_INTERVAL_MS,
  type LatestRaw,
} from "../capture/imuTypes";
import {
  closeJsDatabase,
  flushRawWriteBuffer,
  setNativeOwnsDatabase,
} from "./db";
import type { DeviceMeta } from "./rawObservation";
import { getCachedLabels, setCachedMotionState } from "./recordingContext";
import type { SensorAvailability } from "./rawTypes";

export {
  ACCEL_REQUESTED_INTERVAL_MS,
  BARO_REQUESTED_INTERVAL_MS,
  GYRO_REQUESTED_INTERVAL_MS,
  MOTION_DETECTOR_INTERVAL_MS,
  type LatestRaw,
} from "../capture/imuTypes";

let startChain: Promise<unknown> = Promise.resolve();
let running = false;
let usingNativeImu = false;
let nativeLatestUnsub: (() => void) | null = null;
let startGeneration = 0;
let deviceMeta: DeviceMeta | null = null;
let subscriptions: { remove: () => void }[] = [];
let latestLocal: LatestRaw = { ...EMPTY_LATEST_RAW };
let lastUi = 0;
let lastSampleAt = 0;
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
 * IMU collection is a process singleton so Activity pause/remount does not
 * tear down listeners. On Android, RecordingImuService is the only capture
 * engine. JS sensors are used only when the native module is absent.
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

  latestLocal = { ...EMPTY_LATEST_RAW };
  lastUi = 0;
  lastSampleAt = Date.now();

  if (isNativeImuAvailable()) {
    const labels = getCachedLabels();
    await closeJsDatabase();
    setNativeOwnsDatabase(true);
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
    await stopNativeImuRecording().catch(() => {});
    setNativeOwnsDatabase(false);
    running = false;
    usingNativeImu = false;
    throw new Error("NATIVE_IMU_START_FAILED");
  }

  usingNativeImu = false;
  acquireCpuWakeLock();
  clearSubscriptions();
  subscriptions = attachJsImuSensors(available, {
    isRunning: () => running && generation === startGeneration,
    getDevice: () => deviceMeta,
    publishLatest,
    markSample: (arrivalMs) => {
      lastSampleAt = arrivalMs;
    },
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
  if (isNativeImuAvailable()) {
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
  setNativeOwnsDatabase(false);
  try {
    releaseCpuWakeLock();
  } catch {
    // Ignore.
  }
  await flushRawWriteBuffer();
}

export function isImuCollectorRunning(): boolean {
  return running;
}
