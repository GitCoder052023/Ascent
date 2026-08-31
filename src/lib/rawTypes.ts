export type Floor = "GROUND_FLOOR" | "FLOOR_1" | "FLOOR_2";

export type ActivityLabel = "GOING_UPSTAIRS" | "COMING_DOWNSTAIRS";

export type MotionState = "WALKING" | "STATIONARY";

export type SensorType = "accelerometer" | "gyroscope" | "barometer" | "wifi";

/**
 * Wall-clock ISO fields (`timestamp`, `arrivalTimestamp`) are always the
 * application receipt time. Expo/native `measurement.timestamp` is a sensor
 * clock in seconds (typically time since boot), not Unix time, so it is stored
 * separately and never rewritten as ISO-8601.
 */
export type TimestampSource = "arrival";

export type SensorAvailability = {
  accelerometerAvailable: boolean;
  gyroscopeAvailable: boolean;
  barometerAvailable: boolean;
};

export type RecordingSession = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  accelerometerAvailable: boolean;
  gyroscopeAvailable: boolean;
  barometerAvailable: boolean;
  platform: string;
  deviceModel: string | null;
  osVersion: string | null;
  notes: string;
};

export type RawObservation = {
  id: string;
  sessionId: string | null;
  timestamp: string;
  arrivalTimestamp: string;
  sensorTimestamp: number | null;
  timestampSource: TimestampSource;
  sensorType: SensorType;
  floor: Floor | null;
  activity: ActivityLabel | null;
  motionState: MotionState | null;
  accelerometerX: number | null;
  accelerometerY: number | null;
  accelerometerZ: number | null;
  gyroscopeX: number | null;
  gyroscopeY: number | null;
  gyroscopeZ: number | null;
  barometerPressure: number | null;
  ssid: string | null;
  bssid: string | null;
  signalStrength: number | null;
  signalStrengthUnit: "dBm" | null;
  frequency: number | null;
  connectionType: "wifi" | null;
  platform: string;
  deviceModel: string | null;
  osVersion: string | null;
};

export const RAW_CSV_COLUMNS: (keyof RawObservation)[] = [
  "id",
  "sessionId",
  "timestamp",
  "arrivalTimestamp",
  "sensorTimestamp",
  "timestampSource",
  "sensorType",
  "floor",
  "activity",
  "accelerometerX",
  "accelerometerY",
  "accelerometerZ",
  "gyroscopeX",
  "gyroscopeY",
  "gyroscopeZ",
  "barometerPressure",
  "motionState",
  "ssid",
  "bssid",
  "signalStrength",
  "signalStrengthUnit",
  "frequency",
  "connectionType",
  "platform",
  "deviceModel",
  "osVersion",
];

export const FLOOR_OPTIONS: Floor[] = ["GROUND_FLOOR", "FLOOR_1", "FLOOR_2"];

export const ACTIVITY_OPTIONS: ActivityLabel[] = [
  "GOING_UPSTAIRS",
  "COMING_DOWNSTAIRS",
];

export const PLATFORM_SENSOR_NOTES = [
  "Foreground: accelerometer, gyroscope, and barometer are collected via expo-sensors listeners at the OS-delivered rate (requested interval is a hint, not a resample).",
  "Android background: the existing location foreground service may keep the JS runtime alive, so IMU listeners can continue, but this is not guaranteed and readings are never fabricated if they stop.",
  "iOS background: the process is typically suspended except for location wakeups used by the existing Wi-Fi logger. Continuous IMU/barometer in the background is not provided by expo-sensors and is not faked.",
  "Barometer is optional hardware. If isAvailableAsync() is false, no pressure rows are written.",
  "timestamp / arrivalTimestamp are ISO-8601 UTC (milliseconds) of app receipt. sensorTimestamp is the native Expo measurement.timestamp in seconds when the API provides it; it is not Unix time.",
].join(" ");
