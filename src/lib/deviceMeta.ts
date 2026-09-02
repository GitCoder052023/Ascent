import * as Device from "expo-device";
import { Platform } from "react-native";
import type { DeviceMeta } from "./rawObservation";

export function getDeviceMeta(): DeviceMeta {
  return {
    platform: Platform.OS,
    deviceModel: Device.modelName ?? null,
    osVersion: Platform.Version?.toString() ?? null,
  };
}
