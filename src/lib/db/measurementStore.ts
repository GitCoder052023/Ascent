import {
  flushNativeImuWrites,
  isNativeImuRecording,
  nativeWifiObservationCount,
} from "../../../modules/recording-keepalive";
import { getDatabase, isNativeOwningDatabase } from "./connection";
import { getCachedWifiDbCount, setCachedWifiDbCount } from "./counts";
import { insertMeasurementBatch } from "./measurementInsert";
import type { Measurement, MeasurementRow } from "./types";

let writeBuffer: Measurement[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let activeFlushPromise: Promise<void> | null = null;

export function pendingMeasurementWrites() {
  return writeBuffer.length;
}

export function resetMeasurementBuffers() {
  writeBuffer = [];
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}

export async function flushWriteBuffer(): Promise<void> {
  if (isNativeOwningDatabase()) {
    return;
  }
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
      await insertMeasurementBatch(db, itemsToFlush);
    } catch (error) {
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
  if (isNativeOwningDatabase()) {
    return;
  }
  writeBuffer.push(item);

  if (writeBuffer.length >= 10) {
    await flushWriteBuffer();
  } else if (!flushTimer) {
    flushTimer = setTimeout(() => void flushWriteBuffer(), 5000);
  }
}

export async function getAllMeasurements(): Promise<Measurement[]> {
  await flushWriteBuffer();
  await flushNativeImuWrites();
  const db = await getDatabase();
  const rows = await db.getAllAsync<MeasurementRow>(
    "SELECT * FROM measurements ORDER BY timestamp ASC"
  );

  return rows.map((r) => ({
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

export async function getWifiMeasurementCount(): Promise<number> {
  const nativeCount = nativeWifiObservationCount();
  if (isNativeOwningDatabase() || isNativeImuRecording()) {
    if (nativeCount != null && nativeCount >= 0) {
      setCachedWifiDbCount(Math.max(getCachedWifiDbCount() ?? 0, nativeCount));
    }
    return (getCachedWifiDbCount() ?? 0) + writeBuffer.length;
  }
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM measurements"
  );
  const jsCount = row?.count ?? 0;
  setCachedWifiDbCount(Math.max(jsCount, nativeCount ?? 0));
  return (getCachedWifiDbCount() ?? 0) + writeBuffer.length;
}
