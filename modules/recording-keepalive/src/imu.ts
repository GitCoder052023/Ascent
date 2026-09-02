import type { NativeRecordingOptions } from "./types";
import { isNativeImuAvailable, native, withNative, withNativeAsync } from "./native";

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

export function acquireCpuWakeLock(): boolean {
  return withNative(false, (module) => module.acquire());
}

export function releaseCpuWakeLock(): boolean {
  return withNative(false, (module) => module.release());
}

export function isCpuWakeLockHeld(): boolean {
  return withNative(false, (module) => module.isHeld());
}

export function isNativeImuRecording(): boolean {
  return withNative(false, (module) => module.isRecording());
}

export function nativeImuLastSampleAgeMs(): number {
  return withNative(Number.POSITIVE_INFINITY, (module) => module.lastSampleAgeMs());
}

export function probeNativeAvailability(): {
  accelerometerAvailable: boolean;
  gyroscopeAvailable: boolean;
  barometerAvailable: boolean;
} | null {
  return withNative<{
    accelerometerAvailable: boolean;
    gyroscopeAvailable: boolean;
    barometerAvailable: boolean;
  } | null>(null, (module) => module.probeAvailability());
}

export async function startNativeImuRecording(
  options: NativeRecordingOptions
): Promise<boolean> {
  return withNativeAsync(false, (module) => module.startRecording(compactOptions(options)));
}

export function updateNativeImuLabels(options: NativeRecordingOptions): boolean {
  return withNative(false, (module) => module.updateLabels(compactOptions(options)));
}

export async function stopNativeImuRecording(): Promise<boolean> {
  return withNativeAsync(false, (module) => module.stopRecording());
}

export function subscribeNativeImuLatest(
  listener: Parameters<NonNullable<typeof native>["addListener"]>[1]
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
