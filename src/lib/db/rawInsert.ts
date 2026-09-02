import type * as SQLite from "expo-sqlite";
import type { Floor, RawObservation } from "../rawTypes";

type RawDbRow = {
  id: string;
  session_id: string | null;
  timestamp: string;
  arrival_timestamp: string;
  sensor_timestamp: number | null;
  timestamp_source: "arrival";
  sensor_type: RawObservation["sensorType"];
  floor: Floor | null;
  activity: RawObservation["activity"];
  motion_state: RawObservation["motionState"];
  accelerometer_x: number | null;
  accelerometer_y: number | null;
  accelerometer_z: number | null;
  gyroscope_x: number | null;
  gyroscope_y: number | null;
  gyroscope_z: number | null;
  barometer_pressure: number | null;
  ssid: string | null;
  bssid: string | null;
  signal_strength: number | null;
  signal_strength_unit: "dBm" | null;
  frequency: number | null;
  connection_type: "wifi" | null;
  platform: string;
  device_model: string | null;
  os_version: string | null;
  app_state: RawObservation["appState"] | null;
  lock_screen: RawObservation["lockScreen"] | null;
  screen_on: RawObservation["screenOn"] | null;
};

export function rowToObservation(r: RawDbRow): RawObservation {
  return {
    id: r.id,
    sessionId: r.session_id,
    timestamp: r.timestamp,
    arrivalTimestamp: r.arrival_timestamp,
    sensorTimestamp: r.sensor_timestamp,
    timestampSource: r.timestamp_source,
    sensorType: r.sensor_type,
    floor: r.floor,
    activity: r.activity,
    motionState: r.motion_state,
    accelerometerX: r.accelerometer_x,
    accelerometerY: r.accelerometer_y,
    accelerometerZ: r.accelerometer_z,
    gyroscopeX: r.gyroscope_x,
    gyroscopeY: r.gyroscope_y,
    gyroscopeZ: r.gyroscope_z,
    barometerPressure: r.barometer_pressure,
    ssid: r.ssid,
    bssid: r.bssid,
    signalStrength: r.signal_strength,
    signalStrengthUnit: r.signal_strength_unit,
    frequency: r.frequency,
    connectionType: r.connection_type,
    platform: r.platform,
    deviceModel: r.device_model,
    osVersion: r.os_version,
    appState: r.app_state ?? "BACKGROUND",
    lockScreen: r.lock_screen ?? "UNKNOWN",
    screenOn: r.screen_on ?? "UNKNOWN",
  };
}

export async function insertRawBatch(
  db: SQLite.SQLiteDatabase,
  items: RawObservation[]
) {
  if (items.length === 0) return;

  await db.withTransactionAsync(async () => {
    const statement = await db.prepareAsync(
      `INSERT OR REPLACE INTO raw_observations (
        id, session_id, timestamp, arrival_timestamp, sensor_timestamp, timestamp_source, sensor_type,
        floor, activity, motion_state,
        accelerometer_x, accelerometer_y, accelerometer_z,
        gyroscope_x, gyroscope_y, gyroscope_z, barometer_pressure,
        ssid, bssid, signal_strength, signal_strength_unit, frequency, connection_type,
        platform, device_model, os_version, app_state, lock_screen, screen_on
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    try {
      for (const item of items) {
        await statement.executeAsync([
          item.id,
          item.sessionId,
          item.timestamp,
          item.arrivalTimestamp,
          item.sensorTimestamp,
          item.timestampSource,
          item.sensorType,
          item.floor,
          item.activity,
          item.motionState,
          item.accelerometerX,
          item.accelerometerY,
          item.accelerometerZ,
          item.gyroscopeX,
          item.gyroscopeY,
          item.gyroscopeZ,
          item.barometerPressure,
          item.ssid,
          item.bssid,
          item.signalStrength,
          item.signalStrengthUnit,
          item.frequency,
          item.connectionType,
          item.platform,
          item.deviceModel,
          item.osVersion,
          item.appState,
          item.lockScreen,
          item.screenOn,
        ]);
      }
    } finally {
      await statement.finalizeAsync();
    }
  });
}
