import * as SQLite from "expo-sqlite";
import {
  flushNativeImuWrites,
  isNativeImuRecording,
  nativeRawObservationCount,
} from "../../modules/recording-keepalive";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { csvCell } from "./rawObservation";
import { RAW_CSV_COLUMNS, type Floor, type RawObservation, type RecordingSession } from "./rawTypes";

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

const LEGACY_STORAGE_KEY = "wifi-floor-logger.measurements.v1";
const DB_NAME = "wifilogger_v2.db";

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let nativeOwnsDatabase = false;
let writeBuffer: Measurement[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let activeFlushPromise: Promise<void> | null = null;
let rawWriteBuffer: RawObservation[] = [];
let rawFlushTimer: ReturnType<typeof setTimeout> | null = null;
let activeRawFlushPromise: Promise<void> | null = null;

export function setNativeOwnsDatabase(owns: boolean) {
  nativeOwnsDatabase = owns;
}

export function isNativeOwningDatabase(): boolean {
  return nativeOwnsDatabase;
}

export async function closeJsDatabase(): Promise<void> {
  await flushWriteBuffer();
  await flushRawWriteBuffer();
  const pending = dbPromise;
  dbPromise = null;
  if (!pending) {
    return;
  }
  try {
    const db = await pending;
    await db.closeAsync();
  } catch {
    // Already closed or never opened.
  }
}

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (nativeOwnsDatabase) {
    throw new Error("NATIVE_DB_OWNER");
  }
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS measurements (
          id TEXT PRIMARY KEY,
          timestamp TEXT NOT NULL,
          floor TEXT NOT NULL,
          ssid TEXT,
          bssid TEXT,
          signal_strength REAL,
          signal_strength_unit TEXT,
          frequency INTEGER,
          connection_type TEXT,
          platform TEXT,
          device_model TEXT,
          os_version TEXT,
          signal_strength_normalized REAL,
          signal_strength_estimated_dbm REAL,
          frequency_band TEXT,
          app_state TEXT,
          lock_screen TEXT,
          screen_on TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_timestamp ON measurements(timestamp);
        CREATE INDEX IF NOT EXISTS idx_floor ON measurements(floor);
        CREATE TABLE IF NOT EXISTS recording_sessions (
          id TEXT PRIMARY KEY,
          started_at TEXT NOT NULL,
          ended_at TEXT,
          accelerometer_available INTEGER NOT NULL,
          gyroscope_available INTEGER NOT NULL,
          barometer_available INTEGER NOT NULL,
          platform TEXT,
          device_model TEXT,
          os_version TEXT,
          notes TEXT
        );
        CREATE TABLE IF NOT EXISTS raw_observations (
          id TEXT PRIMARY KEY,
          session_id TEXT,
          timestamp TEXT NOT NULL,
          arrival_timestamp TEXT NOT NULL,
          sensor_timestamp REAL,
          timestamp_source TEXT NOT NULL,
          sensor_type TEXT NOT NULL,
          floor TEXT,
          activity TEXT,
          motion_state TEXT,
          accelerometer_x REAL,
          accelerometer_y REAL,
          accelerometer_z REAL,
          gyroscope_x REAL,
          gyroscope_y REAL,
          gyroscope_z REAL,
          barometer_pressure REAL,
          ssid TEXT,
          bssid TEXT,
          signal_strength REAL,
          signal_strength_unit TEXT,
          frequency INTEGER,
          connection_type TEXT,
          platform TEXT,
          device_model TEXT,
          os_version TEXT,
          app_state TEXT,
          lock_screen TEXT,
          screen_on TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_raw_timestamp ON raw_observations(timestamp);
        CREATE INDEX IF NOT EXISTS idx_raw_session ON raw_observations(session_id);
        CREATE INDEX IF NOT EXISTS idx_raw_sensor ON raw_observations(sensor_type);
      `);

      await migratePresenceColumns(db);
      await migrateLegacyWifiIntoRawObservations(db);

      // Attempt legacy migration from AsyncStorage
      try {
        const legacyData = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
        if (legacyData) {
          const items: Measurement[] = JSON.parse(legacyData);
          if (Array.isArray(items) && items.length > 0) {
            await insertBatch(db, items);
            await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
            await migrateLegacyWifiIntoRawObservations(db);
          }
        }
      } catch {
        // Ignore legacy migration errors
      }

      return db;
    })();
  }
  return dbPromise;
}

async function migratePresenceColumns(db: SQLite.SQLiteDatabase) {
  const statements = [
    "ALTER TABLE raw_observations ADD COLUMN app_state TEXT",
    "ALTER TABLE raw_observations ADD COLUMN lock_screen TEXT",
    "ALTER TABLE raw_observations ADD COLUMN screen_on TEXT",
    "ALTER TABLE measurements ADD COLUMN app_state TEXT",
    "ALTER TABLE measurements ADD COLUMN lock_screen TEXT",
    "ALTER TABLE measurements ADD COLUMN screen_on TEXT",
  ];
  for (const sql of statements) {
    try {
      await db.execAsync(sql);
    } catch {
      // Column already exists on upgraded databases.
    }
  }
}

async function migrateLegacyWifiIntoRawObservations(db: SQLite.SQLiteDatabase) {
  await db.runAsync(`
    INSERT OR IGNORE INTO raw_observations (
      id, session_id, timestamp, arrival_timestamp, sensor_timestamp, timestamp_source, sensor_type,
      floor, activity, motion_state,
      accelerometer_x, accelerometer_y, accelerometer_z,
      gyroscope_x, gyroscope_y, gyroscope_z, barometer_pressure,
      ssid, bssid, signal_strength, signal_strength_unit, frequency, connection_type,
      platform, device_model, os_version, app_state, lock_screen, screen_on
    )
    SELECT
      id, NULL, timestamp, timestamp, NULL, 'arrival', 'wifi',
      floor, NULL, NULL,
      NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      ssid, bssid, signal_strength, signal_strength_unit, frequency, connection_type,
      platform, device_model, os_version, NULL, NULL, NULL
    FROM measurements
  `);
}

async function insertBatch(db: SQLite.SQLiteDatabase, items: Measurement[]) {
  if (items.length === 0) return;

  await db.withTransactionAsync(async () => {
    for (const item of items) {
      await db.runAsync(
        `INSERT OR REPLACE INTO measurements (
          id, timestamp, floor, ssid, bssid, signal_strength, signal_strength_unit,
          frequency, connection_type, platform, device_model, os_version,
          signal_strength_normalized, signal_strength_estimated_dbm, frequency_band,
          app_state, lock_screen, screen_on
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          item.id,
          item.timestamp,
          item.floor,
          item.ssid,
          item.bssid,
          item.signalStrength,
          item.signalStrengthUnit,
          item.frequency,
          item.connectionType,
          item.platform,
          item.deviceModel,
          item.osVersion,
          item.signalStrengthNormalized ?? null,
          item.signalStrengthEstimatedDbm ?? null,
          item.frequencyBand ?? null,
          item.appState ?? null,
          item.lockScreen ?? null,
          item.screenOn ?? null,
        ]
      );
    }
  });
}

export async function flushWriteBuffer(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  if (activeFlushPromise) {
    try {
      await activeFlushPromise;
    } catch {
      // Ignore previous flush error, proceed to try flushing current buffer
    }
  }

  if (writeBuffer.length === 0) return;

  activeFlushPromise = (async () => {
    const itemsToFlush = [...writeBuffer];
    writeBuffer = [];

    try {
      const db = await getDatabase();
      await insertBatch(db, itemsToFlush);
    } catch (error) {
      // Put items back into writeBuffer if insert failed
      writeBuffer = [...itemsToFlush, ...writeBuffer];
      console.error("Failed to flush measurements buffer to SQLite:", error);
    }
  })();

  try {
    await activeFlushPromise;
  } finally {
    activeFlushPromise = null;
  }
}

export async function saveMeasurementBuffered(item: Measurement): Promise<void> {
  writeBuffer.push(item);

  if (writeBuffer.length >= 10) {
    await flushWriteBuffer();
  } else if (!flushTimer) {
    flushTimer = setTimeout(() => void flushWriteBuffer(), 5000);
  }
}

type DbRow = {
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

export async function getAllMeasurements(): Promise<Measurement[]> {
  await flushWriteBuffer();
  await flushNativeImuWrites();
  const db = await getDatabase();
  const rows = await db.getAllAsync<DbRow>("SELECT * FROM measurements ORDER BY timestamp ASC");

  return rows.map((r: DbRow) => ({
    id: r.id,
    timestamp: r.timestamp,
    floor: r.floor,
    ssid: r.ssid,
    bssid: r.bssid,
    signalStrength: r.signal_strength,
    signalStrengthUnit: r.signal_strength_unit,
    frequency: r.frequency,
    connectionType: r.connection_type,
    platform: r.platform,
    deviceModel: r.device_model,
    osVersion: r.os_version,
    signalStrengthNormalized: r.signal_strength_normalized,
    signalStrengthEstimatedDbm: r.signal_strength_estimated_dbm,
    frequencyBand: r.frequency_band,
    appState: r.app_state,
    lockScreen: r.lock_screen,
    screenOn: r.screen_on,
  }));
}

export async function clearAllMeasurementsFromDb(): Promise<void> {
  writeBuffer = [];
  rawWriteBuffer = [];
  cachedRawDbCount = 0;
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (rawFlushTimer) {
    clearTimeout(rawFlushTimer);
    rawFlushTimer = null;
  }
  const db = await getDatabase();
  await db.runAsync("DELETE FROM measurements");
  await db.runAsync("DELETE FROM raw_observations");
  await db.runAsync("DELETE FROM recording_sessions");
}

const RAW_FLUSH_SIZE = 200;
const RAW_FLUSH_MS = 2000;
let cachedRawDbCount: number | null = null;

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

function rowToObservation(r: RawDbRow): RawObservation {
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

async function insertRawBatch(db: SQLite.SQLiteDatabase, items: RawObservation[]) {
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

export async function flushRawWriteBuffer(): Promise<void> {
  if (rawFlushTimer) {
    clearTimeout(rawFlushTimer);
    rawFlushTimer = null;
  }

  if (activeRawFlushPromise) {
    try {
      await activeRawFlushPromise;
    } catch {
      // Ignore previous flush error, proceed to try flushing current buffer
    }
  }

  if (rawWriteBuffer.length === 0) return;

  activeRawFlushPromise = (async () => {
    const itemsToFlush = [...rawWriteBuffer];
    rawWriteBuffer = [];

    try {
      const db = await getDatabase();
      await insertRawBatch(db, itemsToFlush);
      if (cachedRawDbCount !== null) {
        cachedRawDbCount += itemsToFlush.length;
      }
    } catch (error) {
      rawWriteBuffer = [...itemsToFlush, ...rawWriteBuffer];
      console.error("Failed to flush raw observations buffer to SQLite:", error);
    }
  })();

  try {
    await activeRawFlushPromise;
  } finally {
    activeRawFlushPromise = null;
  }
}

export async function saveRawObservationBuffered(item: RawObservation): Promise<void> {
  rawWriteBuffer.push(item);

  if (rawWriteBuffer.length >= RAW_FLUSH_SIZE) {
    await flushRawWriteBuffer();
  } else if (!rawFlushTimer) {
    rawFlushTimer = setTimeout(() => void flushRawWriteBuffer(), RAW_FLUSH_MS);
  }
}

export async function getAllRawObservations(): Promise<RawObservation[]> {
  await flushWriteBuffer();
  await flushRawWriteBuffer();
  await flushNativeImuWrites();
  const db = await getDatabase();
  const rows = await db.getAllAsync<RawDbRow>(
    "SELECT * FROM raw_observations ORDER BY timestamp ASC, id ASC"
  );
  return rows.map(rowToObservation);
}

export async function getRawObservationCount(): Promise<number> {
  const nativeCount = nativeRawObservationCount();
  if (nativeOwnsDatabase || isNativeImuRecording()) {
    if (nativeCount != null && nativeCount >= 0) {
      cachedRawDbCount = Math.max(cachedRawDbCount ?? 0, nativeCount);
      return nativeCount + rawWriteBuffer.length;
    }
    return (cachedRawDbCount ?? 0) + rawWriteBuffer.length;
  }
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM raw_observations"
  );
  const jsCount = row?.count ?? 0;
  cachedRawDbCount = Math.max(jsCount, nativeCount ?? 0);
  return cachedRawDbCount + rawWriteBuffer.length;
}

export async function nextSessionId(): Promise<string> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM recording_sessions"
  );
  const n = (row?.count ?? 0) + 1;
  return `SESSION_${String(n).padStart(3, "0")}`;
}

export async function insertRecordingSession(session: RecordingSession): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT OR REPLACE INTO recording_sessions (
      id, started_at, ended_at, accelerometer_available, gyroscope_available, barometer_available,
      platform, device_model, os_version, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      session.id,
      session.startedAt,
      session.endedAt,
      session.accelerometerAvailable ? 1 : 0,
      session.gyroscopeAvailable ? 1 : 0,
      session.barometerAvailable ? 1 : 0,
      session.platform,
      session.deviceModel,
      session.osVersion,
      session.notes,
    ]
  );
}

export async function endRecordingSession(sessionId: string, endedAt: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync("UPDATE recording_sessions SET ended_at = ? WHERE id = ?", [
    endedAt,
    sessionId,
  ]);
}

export async function getAllRecordingSessions(): Promise<RecordingSession[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{
    id: string;
    started_at: string;
    ended_at: string | null;
    accelerometer_available: number;
    gyroscope_available: number;
    barometer_available: number;
    platform: string;
    device_model: string | null;
    os_version: string | null;
    notes: string | null;
  }>("SELECT * FROM recording_sessions ORDER BY started_at ASC");

  return rows.map((r) => ({
    id: r.id,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    accelerometerAvailable: Boolean(r.accelerometer_available),
    gyroscopeAvailable: Boolean(r.gyroscope_available),
    barometerAvailable: Boolean(r.barometer_available),
    platform: r.platform,
    deviceModel: r.device_model,
    osVersion: r.os_version,
    notes: r.notes ?? "",
  }));
}

export async function exportDatasetFromDb(format: "csv" | "json"): Promise<void> {
  const [items, sessions] = await Promise.all([
    getAllRawObservations(),
    getAllRecordingSessions(),
  ]);
  const filename = `raw-sensor-dataset-${new Date().toISOString().replaceAll(":", "-")}.${format}`;
  const file = new File(Paths.cache, filename);

  const contents =
    format === "json"
      ? JSON.stringify(
          {
            sessions,
            observations: items,
          },
          null,
          2
        )
      : [
          RAW_CSV_COLUMNS.join(","),
          ...items.map((item) =>
            RAW_CSV_COLUMNS.map((key) => csvCell(item[key])).join(",")
          ),
        ].join("\n");

  file.write(contents);

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("Sharing is unavailable on this device.");
  }

  await Sharing.shareAsync(file.uri, {
    mimeType: format === "csv" ? "text/csv" : "application/json",
    dialogTitle: "Export raw sensor dataset",
  });
}
