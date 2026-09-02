import * as Device from "expo-device";
import { Platform } from "react-native";
import {
  isNativeImuAvailable,
  updateNativeImuLabels,
} from "../../../modules/recording-keepalive";
import type { DeviceMeta } from "../deviceMeta";
import { getCachedLabels } from "../recordingContext";

export function defaultDevice(): DeviceMeta {
  return {
    platform: Platform.OS,
    deviceModel: Device.modelName ?? null,
    osVersion: Platform.Version?.toString() ?? null,
  };
}

export function syncNativeRecordingLabels(deviceMeta?: DeviceMeta | null): void {
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
