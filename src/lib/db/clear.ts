import { getDatabase } from "./connection";
import { resetCachedCounts } from "./counts";
import { resetMeasurementBuffers } from "./measurementStore";
import { resetRawBuffers } from "./rawStore";

export async function clearAllMeasurementsFromDb(): Promise<void> {
  resetMeasurementBuffers();
  resetRawBuffers();
  resetCachedCounts();
  const db = await getDatabase();
  await db.runAsync("DELETE FROM measurements");
  await db.runAsync("DELETE FROM raw_observations");
  await db.runAsync("DELETE FROM recording_sessions");
}
