import * as Device from "expo-device";
import { Platform } from "react-native";

export type DeviceMeta = {
  platform: string;
  deviceModel: string | null;
  osVersion: string | null;
};

export function getDeviceMeta(): DeviceMeta {
  return {
    platform: Platform.OS,
    deviceModel: Device.modelName ?? null,
    osVersion: Platform.Version?.toString() ?? null,
  };
}
