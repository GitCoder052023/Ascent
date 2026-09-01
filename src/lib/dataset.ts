import * as Device from "expo-device";
import { Platform } from "react-native";
import { getDevicePresence } from "./devicePresence";
import type { WifiSnapshot } from "./wifi";
import type { ProcessedSignal } from "./signalEngine";
import {
  clearAllMeasurementsFromDb,
  exportDatasetFromDb,
  getAllMeasurements,
  saveMeasurementBuffered,
  saveRawObservationBuffered,
  type Floor,
  type Measurement,
} from "./db";
import { createWifiObservation, type DeviceMeta, type LabelContext } from "./rawObservation";
import { getCachedLabels } from "./recordingContext";
import type { ActivityLabel } from "./rawTypes";

export type { Floor, Measurement, ActivityLabel };

export const loadMeasurements = async (): Promise<Measurement[]> => {
  return await getAllMeasurements();
};

export const saveMeasurements = async (items: Measurement[]): Promise<void> => {
  if (items.length > 0) {
    const lastItem = items[items.length - 1];
    await persistWifiMeasurement(lastItem);
  }
};

export const clearMeasurements = async (): Promise<void> => {
  await clearAllMeasurementsFromDb();
};

export function createMeasurement(
  floor: Floor,
  wifi: WifiSnapshot,
  processedSignal?: ProcessedSignal
): Measurement {
  const item: Measurement = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    floor,
    ssid: wifi.ssid,
    bssid: wifi.bssid,
    signalStrength: wifi.signalStrength,
    signalStrengthUnit: wifi.signalStrengthUnit,
    frequency: wifi.frequency,
    connectionType: "wifi",
    platform: Platform.OS,
    deviceModel: Device.modelName ?? null,
    osVersion: Platform.Version?.toString() ?? null,
    signalStrengthNormalized: processedSignal?.normalizedScore ?? null,
    signalStrengthEstimatedDbm: processedSignal?.estimatedDbm ?? null,
    frequencyBand: processedSignal?.frequencyBand ?? null,
    ...getDevicePresence(),
  };
  return item;
}

export async function persistWifiMeasurement(
  item: Measurement,
  labelsOverride?: Partial<LabelContext>
): Promise<void> {
  const labels = { ...getCachedLabels(), ...labelsOverride };
  const device: DeviceMeta = {
    platform: item.platform,
    deviceModel: item.deviceModel,
    osVersion: item.osVersion,
  };
  const raw = createWifiObservation(
    Date.parse(item.timestamp) || Date.now(),
    {
      ssid: item.ssid,
      bssid: item.bssid,
      signalStrength: item.signalStrength,
      signalStrengthUnit: item.signalStrengthUnit,
      frequency: item.frequency,
    },
    {
      sessionId: labels.sessionId,
      floor: item.floor,
      activity: labels.activity,
      motionState: labels.motionState,
    },
    device,
    item.id
  );
  if (item.appState) {
    raw.appState = item.appState;
    raw.lockScreen = item.lockScreen ?? raw.lockScreen;
    raw.screenOn = item.screenOn ?? raw.screenOn;
  }
  await Promise.all([saveMeasurementBuffered(item), saveRawObservationBuffered(raw)]);
}

export async function exportDataset(
  items: Measurement[],
  format: "csv" | "json"
): Promise<void> {
  await exportDatasetFromDb(format);
}
