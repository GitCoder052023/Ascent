import * as SQLite from "expo-sqlite";
import {
  BOOTSTRAP_SQL,
  DB_NAME,
  migrateLegacyWifiIntoRawObservations,
  migratePresenceColumns,
} from "./schema";
import { migrateLegacyAsyncStorage } from "./legacyMigration";

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let nativeOwnsDatabase = false;

export function setNativeOwnsDatabase(owns: boolean) {
  nativeOwnsDatabase = owns;
}

export function isNativeOwningDatabase(): boolean {
  return nativeOwnsDatabase;
}

export async function closeJsDatabaseHandle(): Promise<void> {
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
    dbPromise = openDatabase();
  }
  return dbPromise;
}

async function openDatabase(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  await db.execAsync(BOOTSTRAP_SQL);
  await migratePresenceColumns(db);
  await migrateLegacyWifiIntoRawObservations(db);
  await migrateLegacyAsyncStorage(db);
  return db;
}
