import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";

type RecordingKeepaliveNative = {
  acquire: () => boolean;
  release: () => boolean;
  isHeld: () => boolean;
  isIgnoringBatteryOptimizations: () => boolean;
  requestIgnoreBatteryOptimizations: () => Promise<boolean>;
};

const native = requireOptionalNativeModule<RecordingKeepaliveNative>(
  "RecordingKeepalive"
);

export function acquireCpuWakeLock(): boolean {
  if (Platform.OS !== "android" || !native) {
    return false;
  }
  try {
    return native.acquire();
  } catch {
    return false;
  }
}

export function releaseCpuWakeLock(): boolean {
  if (Platform.OS !== "android" || !native) {
    return false;
  }
  try {
    return native.release();
  } catch {
    return false;
  }
}

export function isCpuWakeLockHeld(): boolean {
  if (Platform.OS !== "android" || !native) {
    return false;
  }
  try {
    return native.isHeld();
  } catch {
    return false;
  }
}

export function isIgnoringBatteryOptimizations(): boolean {
  if (Platform.OS !== "android" || !native) {
    return true;
  }
  try {
    return native.isIgnoringBatteryOptimizations();
  } catch {
    return true;
  }
}

export async function requestIgnoreBatteryOptimizations(): Promise<boolean> {
  if (Platform.OS !== "android" || !native) {
    return true;
  }
  try {
    return await native.requestIgnoreBatteryOptimizations();
  } catch {
    return false;
  }
}
