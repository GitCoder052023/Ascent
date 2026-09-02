import { Accelerometer } from "expo-sensors";
import {
  acquireCpuWakeLock,
  isNativeImuAvailable,
  nativeImuLastSampleAgeMs,
  releaseCpuWakeLock,
  startNativeImuRecording,
  stopNativeImuRecording,
  subscribeNativeImuLatest,
} from "../../../modules/recording-keepalive";
import { attachJsImuSensors } from "../../capture/jsImuFallback";
import { MOTION_DETECTOR_INTERVAL_MS } from "../../capture/imuTypes";
import {
  closeJsDatabase,
  flushRawWriteBuffer,
  setNativeOwnsDatabase,
} from "../db";
import type { DeviceMeta } from "../deviceMeta";
import { getCachedLabels, setCachedMotionState } from "../recordingContext";
import type { SensorAvailability } from "../rawTypes";
import { probeSensorAvailability } from "./availability";
import { currentLatestRaw, publishLatest, resetLatestRaw } from "./latestBus";
import { defaultDevice, syncNativeRecordingLabels } from "./nativeLabels";

let startChain: Promise<unknown> = Promise.resolve();
let running = false;
let usingNativeImu = false;
let nativeLatestUnsub: (() => void) | null = null;
let startGeneration = 0;
let deviceMeta: DeviceMeta | null = null;
let subscriptions: { remove: () => void }[] = [];
let lastSampleAt = 0;

export function isUsingNativeImu(): boolean {
  return usingNativeImu;
}

export function isImuCollectorRunning(): boolean {
  return running;
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
      wifi: event.wifiTimestamp ?? currentLatestRaw().wifi,
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

  resetLatestRaw();
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
      syncNativeRecordingLabels(deviceMeta);
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

export function syncCollectorNativeLabels(): void {
  syncNativeRecordingLabels(deviceMeta);
}
