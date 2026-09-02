import type * as SQLite from "expo-sqlite";
import type { Measurement } from "./types";

export async function insertMeasurementBatch(
  db: SQLite.SQLiteDatabase,
  items: Measurement[]
) {
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
