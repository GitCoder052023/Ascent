import type * as SQLite from "expo-sqlite";

export const DB_NAME = "wifilogger_v2.db";
export const LEGACY_STORAGE_KEY = "wifi-floor-logger.measurements.v1";

export const BOOTSTRAP_SQL = `
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
`;

export async function migratePresenceColumns(db: SQLite.SQLiteDatabase) {
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

export async function migrateLegacyWifiIntoRawObservations(db: SQLite.SQLiteDatabase) {
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
