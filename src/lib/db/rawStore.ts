import {
  flushNativeImuWrites,
  isNativeImuRecording,
  nativeRawObservationCount,
} from "../../../modules/recording-keepalive";
import type { RawObservation } from "../rawTypes";
import { getDatabase, isNativeOwningDatabase } from "./connection";
import { addCachedRawDbCount, getCachedRawDbCount, setCachedRawDbCount } from "./counts";
import { flushWriteBuffer } from "./measurementStore";
import { insertRawBatch, rowToObservation } from "./rawInsert";

const RAW_FLUSH_SIZE = 200;
const RAW_FLUSH_MS = 2000;

let rawWriteBuffer: RawObservation[] = [];
let rawFlushTimer: ReturnType<typeof setTimeout> | null = null;
let activeRawFlushPromise: Promise<void> | null = null;

export function resetRawBuffers() {
  rawWriteBuffer = [];
  if (rawFlushTimer) {
    clearTimeout(rawFlushTimer);
    rawFlushTimer = null;
  }
}

export async function flushRawWriteBuffer(): Promise<void> {
  if (isNativeOwningDatabase()) {
    return;
  }
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
      addCachedRawDbCount(itemsToFlush.length);
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
  if (isNativeOwningDatabase()) {
    return;
  }
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
  const rows = await db.getAllAsync<Parameters<typeof rowToObservation>[0]>(
    "SELECT * FROM raw_observations ORDER BY timestamp ASC, id ASC"
  );
  return rows.map(rowToObservation);
}

export async function getRawObservationCount(): Promise<number> {
  const nativeCount = nativeRawObservationCount();
  if (isNativeOwningDatabase() || isNativeImuRecording()) {
    if (nativeCount != null && nativeCount >= 0) {
      setCachedRawDbCount(Math.max(getCachedRawDbCount() ?? 0, nativeCount));
    }
    return (getCachedRawDbCount() ?? 0) + rawWriteBuffer.length;
  }
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM raw_observations"
  );
  const jsCount = row?.count ?? 0;
  setCachedRawDbCount(Math.max(jsCount, nativeCount ?? 0));
  return (getCachedRawDbCount() ?? 0) + rawWriteBuffer.length;
}
