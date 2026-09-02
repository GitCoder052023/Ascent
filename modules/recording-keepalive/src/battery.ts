import { isNativeImuAvailable, native } from "./native";

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
