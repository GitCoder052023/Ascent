import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";

type EventSubscription = { remove: () => void };

export type NativeLatestEvent = {
  accelerometer: string | null;
  gyroscope: string | null;
  barometer: string | null;
  motionState: string;
  lastSampleAt: number;
  wifiConnectionState?: string | null;
  wifiSsid?: string | null;
  wifiBssid?: string | null;
  wifiRssi?: number | null;
  wifiFrequency?: number | null;
  wifiTimestamp?: string | null;
  wifiSsidMismatch?: boolean;
  appState?: string | null;
  lockScreen?: string | null;
  screenOn?: string | null;
};

export type NativeRecordingOptions = {
  sessionId?: string | null;
  floor?: string | null;
  activity?: string | null;
  motionState?: string | null;
  deviceModel?: string | null;
  osVersion?: string | null;
  lockedSsid?: string | null;
};

type RecordingKeepaliveNative = {
  acquire: () => boolean;
  release: () => boolean;
  isHeld: () => boolean;
  isRecording: () => boolean;
  lastSampleAgeMs: () => number;
  isIgnoringBatteryOptimizations: () => boolean;
  requestIgnoreBatteryOptimizations: () => Promise<boolean>;
  probeAvailability: () => {
    accelerometerAvailable: boolean;
    gyroscopeAvailable: boolean;
    barometerAvailable: boolean;
  };
  startRecording: (options: Record<string, string | null | undefined>) => Promise<boolean>;
  updateLabels: (options: Record<string, string | null | undefined>) => boolean;
  stopRecording: () => Promise<boolean>;
  rawCount: () => number;
  presence: () => {
    appState: string;
    lockScreen: string;
    screenOn: string;
  };
  flushWrites: () => Promise<boolean>;
  addListener: (
    event: "onLatest",
    listener: (event: NativeLatestEvent) => void
  ) => EventSubscription;
};

const native = requireOptionalNativeModule<RecordingKeepaliveNative>(
  "RecordingKeepalive"
);

function compactOptions(options: NativeRecordingOptions): Record<string, string | null | undefined> {
  return {
    sessionId: options.sessionId ?? "",
    floor: options.floor ?? "",
    activity: options.activity ?? "",
    motionState: options.motionState ?? "",
    deviceModel: options.deviceModel ?? "",
    osVersion: options.osVersion ?? "",
    lockedSsid: options.lockedSsid ?? "",
  };
}

export function isNativeImuAvailable(): boolean {
  return Platform.OS === "android" && native != null;
}

export function acquireCpuWakeLock(): boolean {
  if (!isNativeImuAvailable() || !native) {
    return false;
  }
  try {
    return native.acquire();
  } catch {
    return false;
  }
}

export function releaseCpuWakeLock(): boolean {
  if (!isNativeImuAvailable() || !native) {
    return false;
  }
  try {
    return native.release();
  } catch {
    return false;
  }
}

export function isCpuWakeLockHeld(): boolean {
  if (!isNativeImuAvailable() || !native) {
    return false;
  }
  try {
    return native.isHeld();
  } catch {
    return false;
  }
}

export function isNativeImuRecording(): boolean {
  if (!isNativeImuAvailable() || !native) {
    return false;
  }
  try {
    return native.isRecording();
  } catch {
    return false;
  }
}

export function nativeImuLastSampleAgeMs(): number {
  if (!isNativeImuAvailable() || !native) {
    return Number.POSITIVE_INFINITY;
  }
  try {
    return native.lastSampleAgeMs();
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function isIgnoringBatteryOptimizations(): boolean {
  if (!isNativeImuAvailable() || !native) {
    return true;
  }
  try {
    return native.isIgnoringBatteryOptimizations();
  } catch {
    return true;
  }
}

export async function requestIgnoreBatteryOptimizations(): Promise<boolean> {
  if (!isNativeImuAvailable() || !native) {
    return true;
  }
  try {
    return await native.requestIgnoreBatteryOptimizations();
  } catch {
    return false;
  }
}

export function probeNativeAvailability(): {
  accelerometerAvailable: boolean;
  gyroscopeAvailable: boolean;
  barometerAvailable: boolean;
} | null {
  if (!isNativeImuAvailable() || !native) {
    return null;
  }
  try {
    return native.probeAvailability();
  } catch {
    return null;
  }
}

export async function startNativeImuRecording(
  options: NativeRecordingOptions
): Promise<boolean> {
  if (!isNativeImuAvailable() || !native) {
    return false;
  }
  try {
    return await native.startRecording(compactOptions(options));
  } catch {
    return false;
  }
}

export function updateNativeImuLabels(options: NativeRecordingOptions): boolean {
  if (!isNativeImuAvailable() || !native) {
    return false;
  }
  try {
    return native.updateLabels(compactOptions(options));
  } catch {
    return false;
  }
}

export function nativeDevicePresence(): {
  appState: "FOREGROUND" | "BACKGROUND";
  lockScreen: "YES" | "NO" | "UNKNOWN";
  screenOn: "YES" | "NO" | "UNKNOWN";
} | null {
  if (!isNativeImuAvailable() || !native) {
    return null;
  }
  try {
    const value = native.presence();
    const appState = value.appState === "FOREGROUND" ? "FOREGROUND" : "BACKGROUND";
    const lockScreen =
      value.lockScreen === "YES" || value.lockScreen === "NO" || value.lockScreen === "UNKNOWN"
        ? value.lockScreen
        : "UNKNOWN";
    const screenOn =
      value.screenOn === "YES" || value.screenOn === "NO" || value.screenOn === "UNKNOWN"
        ? value.screenOn
        : "UNKNOWN";
    return { appState, lockScreen, screenOn };
  } catch {
    return null;
  }
}

export function nativeRawObservationCount(): number | null {
  if (!isNativeImuAvailable() || !native) {
    return null;
  }
  try {
    const count = native.rawCount();
    return typeof count === "number" && count >= 0 ? count : null;
  } catch {
    return null;
  }
}

export async function flushNativeImuWrites(): Promise<void> {
  if (!isNativeImuAvailable() || !native) {
    return;
  }
  try {
    await native.flushWrites();
  } catch {
    // JS can still attempt a read.
  }
}

export async function stopNativeImuRecording(): Promise<boolean> {
  if (!isNativeImuAvailable() || !native) {
    return false;
  }
  try {
    return await native.stopRecording();
  } catch {
    return false;
  }
}

export function subscribeNativeImuLatest(
  listener: (event: NativeLatestEvent) => void
): () => void {
  if (!isNativeImuAvailable() || !native) {
    return () => {};
  }
  try {
    const sub = native.addListener("onLatest", listener);
    return () => sub.remove();
  } catch {
    return () => {};
  }
}
