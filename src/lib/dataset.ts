import AsyncStorage from "@react-native-async-storage/async-storage";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as Device from "expo-device";
import { Platform } from "react-native";
import type { WifiSnapshot } from "./wifi";

const STORAGE_KEY = "wifi-floor-logger.measurements.v1";
export type Floor = "FLOOR_1" | "FLOOR_2";
export type Measurement = { id: string; timestamp: string; floor: Floor; ssid: string | null; bssid: string | null; signalStrength: number | null; signalStrengthUnit: "dBm" | null; frequency: number | null; connectionType: "wifi"; platform: string; deviceModel: string | null; osVersion: string | null };
export const loadMeasurements = async (): Promise<Measurement[]> => { const raw = await AsyncStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) as Measurement[] : []; };
export const saveMeasurements = (items: Measurement[]) => AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
export const clearMeasurements = () => AsyncStorage.removeItem(STORAGE_KEY);
export function createMeasurement(floor: Floor, wifi: WifiSnapshot): Measurement { return { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, timestamp: new Date().toISOString(), floor, ssid: wifi.ssid, bssid: wifi.bssid, signalStrength: wifi.signalStrength, signalStrengthUnit: wifi.signalStrengthUnit, frequency: wifi.frequency, connectionType: "wifi", platform: Platform.OS, deviceModel: Device.modelName ?? null, osVersion: Platform.Version?.toString() ?? null }; }
const columns: (keyof Measurement)[] = ["id", "timestamp", "floor", "ssid", "bssid", "signalStrength", "signalStrengthUnit", "frequency", "connectionType", "platform", "deviceModel", "osVersion"];
const csvCell = (item: unknown) => `"${String(item ?? "").replaceAll('"', '""')}"`;
export async function exportDataset(items: Measurement[], format: "csv" | "json") { const file = new File(Paths.cache, `wifi-floor-dataset-${new Date().toISOString().replaceAll(":", "-")}.${format}`); const contents = format === "json" ? JSON.stringify(items, null, 2) : [columns.join(","), ...items.map((item) => columns.map((key) => csvCell(item[key])).join(","))].join("\n"); file.write(contents); if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing is unavailable on this device."); await Sharing.shareAsync(file.uri, { mimeType: format === "csv" ? "text/csv" : "application/json", dialogTitle: "Export Wi-Fi floor dataset" }); }
