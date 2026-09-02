import AsyncStorage from "@react-native-async-storage/async-storage";
import type * as SQLite from "expo-sqlite";
import { insertMeasurementBatch } from "./measurementInsert";
import { migrateLegacyWifiIntoRawObservations, LEGACY_STORAGE_KEY } from "./schema";
import type { Measurement } from "./types";

export async function migrateLegacyAsyncStorage(db: SQLite.SQLiteDatabase) {
  try {
    const legacyData = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacyData) {
      const items: Measurement[] = JSON.parse(legacyData);
      if (Array.isArray(items) && items.length > 0) {
        await insertMeasurementBatch(db, items);
        await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
        await migrateLegacyWifiIntoRawObservations(db);
      }
    }
  } catch {
    // Ignore legacy migration errors
  }
}
