import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";
import type { RecordingKeepaliveNative } from "./types";

export const native = requireOptionalNativeModule<RecordingKeepaliveNative>(
  "RecordingKeepalive"
);

export function isNativeImuAvailable(): boolean {
  return Platform.OS === "android" && native != null;
}

export function withNative<T>(
  fallback: T,
  fn: (module: RecordingKeepaliveNative) => T
): T {
  if (!isNativeImuAvailable() || !native) {
    return fallback;
  }
  try {
    return fn(native);
  } catch {
    return fallback;
  }
}

export async function withNativeAsync<T>(
  fallback: T,
  fn: (module: RecordingKeepaliveNative) => Promise<T>
): Promise<T> {
  if (!isNativeImuAvailable() || !native) {
    return fallback;
  }
  try {
    return await fn(native);
  } catch {
    return fallback;
  }
}
