import * as Device from "expo-device";
import { Platform } from "react-native";
import type { WifiSnapshot } from "./wifi";
import type { ProcessedSignal } from "./signalEngine";
import {
  clearAllMeasurementsFromDb,
  exportDatasetFromDb,
  getAllMeasurements,
  saveMeasurementBuffered,
  type Floor,
  type Measurement,
} from "./db";

export type { Floor, Measurement };

export const loadMeasurements = async (): Promise<Measurement[]> => {
  return await getAllMeasurements();
};

export const saveMeasurements = async (items: Measurement[]): Promise<void> => {
  if (items.length > 0) {
    const lastItem = items[items.length - 1];
    await saveMeasurementBuffered(lastItem);
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
  return {
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
  };
}

export async function exportDataset(
  items: Measurement[],
  format: "csv" | "json"
): Promise<void> {
  await exportDatasetFromDb(format);
}
