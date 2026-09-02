import type { Floor } from "../rawTypes";

export type { Floor };

export type Measurement = {
  id: string;
  timestamp: string;
  floor: Floor;
  ssid: string | null;
  bssid: string | null;
  signalStrength: number | null;
  signalStrengthUnit: "dBm" | null;
  frequency: number | null;
  connectionType: "wifi";
  platform: string;
  deviceModel: string | null;
  osVersion: string | null;
  signalStrengthNormalized?: number | null;
  signalStrengthEstimatedDbm?: number | null;
  frequencyBand?: string | null;
  appState?: "FOREGROUND" | "BACKGROUND" | null;
  lockScreen?: "YES" | "NO" | "UNKNOWN" | null;
  screenOn?: "YES" | "NO" | "UNKNOWN" | null;
};

export type MeasurementRow = {
  id: string;
  timestamp: string;
  floor: Floor;
  ssid: string | null;
  bssid: string | null;
  signal_strength: number | null;
  signal_strength_unit: "dBm" | null;
  frequency: number | null;
  connection_type: "wifi";
  platform: string;
  device_model: string | null;
  os_version: string | null;
  signal_strength_normalized: number | null;
  signal_strength_estimated_dbm: number | null;
  frequency_band: string | null;
  app_state: "FOREGROUND" | "BACKGROUND" | null;
  lock_screen: "YES" | "NO" | "UNKNOWN" | null;
  screen_on: "YES" | "NO" | "UNKNOWN" | null;
};
