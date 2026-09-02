import type { RecordingSession } from "../rawTypes";
import { getDatabase } from "./connection";

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
