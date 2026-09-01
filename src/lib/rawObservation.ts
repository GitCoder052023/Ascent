import { getDevicePresence } from "./devicePresence";
import { getCachedWifi, type CachedWifi } from "./recordingContext";
import type {
  ActivityLabel,
  Floor,
  MotionState,
  RawObservation,
  SensorType,
} from "./rawTypes";

let observationSeq = 0;

export function formatIsoMillis(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

export function nextObservationId(epochMs: number, sensorType: SensorType): string {
  observationSeq += 1;
  return `${epochMs}-${sensorType}-${observationSeq}`;
}

export type DeviceMeta = {
  platform: string;
  deviceModel: string | null;
  osVersion: string | null;
};

export type LabelContext = {
  sessionId: string | null;
  floor: Floor | null;
  activity: ActivityLabel | null;
  motionState: MotionState | null;
};

const emptySensorFields = {
  accelerometerX: null,
  accelerometerY: null,
  accelerometerZ: null,
  gyroscopeX: null,
  gyroscopeY: null,
  gyroscopeZ: null,
  barometerPressure: null,
  ssid: null,
  bssid: null,
  signalStrength: null,
  signalStrengthUnit: null,
  frequency: null,
  connectionType: null,
} as const;

function baseObservation(
  sensorType: SensorType,
  arrivalMs: number,
  sensorTimestamp: number | null,
  labels: LabelContext,
  device: DeviceMeta,
  wifiOverride?: Partial<CachedWifi>
): RawObservation {
  const arrivalTimestamp = formatIsoMillis(arrivalMs);
  const wifi = { ...getCachedWifi(), ...wifiOverride };
  const hasWifi = Boolean(wifi.ssid || wifi.bssid || wifi.signalStrength !== null);
  return {
    id: nextObservationId(arrivalMs, sensorType),
    sessionId: labels.sessionId,
    timestamp: arrivalTimestamp,
    arrivalTimestamp,
    sensorTimestamp,
    timestampSource: "arrival",
    sensorType,
    floor: labels.floor,
    activity: labels.activity,
    motionState: labels.motionState,
    ...emptySensorFields,
    ssid: wifi.ssid,
    bssid: wifi.bssid,
    signalStrength: wifi.signalStrength,
    signalStrengthUnit:
      wifi.signalStrength !== null ? (wifi.signalStrengthUnit ?? "dBm") : null,
    frequency: wifi.frequency,
    connectionType: hasWifi || sensorType === "wifi" ? "wifi" : null,
    platform: device.platform,
    deviceModel: device.deviceModel,
    osVersion: device.osVersion,
    ...getDevicePresence(),
  };
}

export function createAccelerometerObservation(
  arrivalMs: number,
  sensorTimestamp: number | null,
  x: number,
  y: number,
  z: number,
  labels: LabelContext,
  device: DeviceMeta,
  wifi?: Partial<CachedWifi>
): RawObservation {
  return {
    ...baseObservation("accelerometer", arrivalMs, sensorTimestamp, labels, device, wifi),
    accelerometerX: x,
    accelerometerY: y,
    accelerometerZ: z,
  };
}

export function createGyroscopeObservation(
  arrivalMs: number,
  sensorTimestamp: number | null,
  x: number,
  y: number,
  z: number,
  labels: LabelContext,
  device: DeviceMeta,
  wifi?: Partial<CachedWifi>
): RawObservation {
  return {
    ...baseObservation("gyroscope", arrivalMs, sensorTimestamp, labels, device, wifi),
    gyroscopeX: x,
    gyroscopeY: y,
    gyroscopeZ: z,
  };
}

export function createBarometerObservation(
  arrivalMs: number,
  sensorTimestamp: number | null,
  pressure: number,
  labels: LabelContext,
  device: DeviceMeta,
  wifi?: Partial<CachedWifi>
): RawObservation {
  return {
    ...baseObservation("barometer", arrivalMs, sensorTimestamp, labels, device, wifi),
    barometerPressure: pressure,
  };
}

export function createWifiObservation(
  arrivalMs: number,
  wifi: {
    ssid: string | null;
    bssid: string | null;
    signalStrength: number | null;
    signalStrengthUnit: "dBm" | null;
    frequency: number | null;
  },
  labels: LabelContext,
  device: DeviceMeta,
  id?: string
): RawObservation {
  const row = {
    ...baseObservation("wifi", arrivalMs, null, labels, device, wifi),
    ssid: wifi.ssid,
    bssid: wifi.bssid,
    signalStrength: wifi.signalStrength,
    signalStrengthUnit: wifi.signalStrengthUnit,
    frequency: wifi.frequency,
    connectionType: "wifi" as const,
  };
  if (id) {
    row.id = id;
  }
  return row;
}

export function csvCell(item: unknown): string {
  if (item === null || item === undefined) {
    return "";
  }
  if (typeof item === "number" && Number.isFinite(item)) {
    return String(item);
  }
  return `"${String(item).replaceAll('"', '""')}"`;
}
