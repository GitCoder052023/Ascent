export type { NativeLatestEvent, NativeRecordingOptions } from "./src/types";
export { isNativeImuAvailable } from "./src/native";
export {
  acquireCpuWakeLock,
  isCpuWakeLockHeld,
  isNativeImuRecording,
  nativeImuLastSampleAgeMs,
  probeNativeAvailability,
  releaseCpuWakeLock,
  startNativeImuRecording,
  stopNativeImuRecording,
  subscribeNativeImuLatest,
  updateNativeImuLabels,
} from "./src/imu";
export {
  isIgnoringBatteryOptimizations,
  requestIgnoreBatteryOptimizations,
} from "./src/battery";
export { nativeDevicePresence } from "./src/presence";
export {
  flushNativeImuWrites,
  nativeRawObservationCount,
  nativeWifiObservationCount,
} from "./src/counts";
