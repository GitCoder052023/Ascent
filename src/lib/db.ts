import * as SQLite from "expo-sqlite";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

export type Floor = "FLOOR_1" | "FLOOR_2";

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
};

const LEGACY_STORAGE_KEY = "wifi-floor-logger.measurements.v1";
const DB_NAME = "wifilogger_v2.db";

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let writeBuffer: Measurement[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let activeFlushPromise: Promise<void> | null = null;

async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
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
          frequency_band TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_timestamp ON measurements(timestamp);
        CREATE INDEX IF NOT EXISTS idx_floor ON measurements(floor);
      `);

      // Attempt legacy migration from AsyncStorage
      try {
        const legacyData = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
        if (legacyData) {
          const items: Measurement[] = JSON.parse(legacyData);
          if (Array.isArray(items) && items.length > 0) {
            await insertBatch(db, items);
            await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
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

async function insertBatch(db: SQLite.SQLiteDatabase, items: Measurement[]) {
  if (items.length === 0) return;

  await db.withTransactionAsync(async () => {
    for (const item of items) {
      await db.runAsync(
        `INSERT OR REPLACE INTO measurements (
          id, timestamp, floor, ssid, bssid, signal_strength, signal_strength_unit,
          frequency, connection_type, platform, device_model, os_version,
          signal_strength_normalized, signal_strength_estimated_dbm, frequency_band
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
};

export async function getAllMeasurements(): Promise<Measurement[]> {
  await flushWriteBuffer();
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
  }));
}

export async function clearAllMeasurementsFromDb(): Promise<void> {
  writeBuffer = [];
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const db = await getDatabase();
  await db.runAsync("DELETE FROM measurements");
}

const columns: (keyof Measurement)[] = [
  "id",
  "timestamp",
  "floor",
  "ssid",
  "bssid",
  "signalStrength",
  "signalStrengthUnit",
  "frequency",
  "connectionType",
  "platform",
  "deviceModel",
  "osVersion",
  "signalStrengthNormalized",
  "signalStrengthEstimatedDbm",
  "frequencyBand",
];

const csvCell = (item: unknown) => `"${String(item ?? "").replaceAll('"', '""')}"`;

export async function exportDatasetFromDb(format: "csv" | "json"): Promise<void> {
  const items = await getAllMeasurements();
  const filename = `wifi-floor-dataset-${new Date().toISOString().replaceAll(":", "-")}.${format}`;
  const file = new File(Paths.cache, filename);

  const contents =
    format === "json"
      ? JSON.stringify(items, null, 2)
      : [
          columns.join(","),
          ...items.map((item) =>
            columns.map((key) => csvCell(item[key])).join(",")
          ),
        ].join("\n");

  file.write(contents);

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("Sharing is unavailable on this device.");
  }

  await Sharing.shareAsync(file.uri, {
    mimeType: format === "csv" ? "text/csv" : "application/json",
    dialogTitle: "Export Wi-Fi floor dataset",
  });
}
