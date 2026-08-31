import { useEffect, useState } from "react";
import {
  getLatestRaw,
  probeSensorAvailability,
  requestMotionPermissions,
  subscribeLatestRaw,
  type LatestRaw,
} from "../lib/imuCollector";
import type { SensorAvailability } from "../lib/rawTypes";

export {
  probeSensorAvailability,
  requestMotionPermissions,
} from "../lib/imuCollector";

export function useRawSensorCollector() {
  const [availability, setAvailability] = useState<SensorAvailability>({
    accelerometerAvailable: false,
    gyroscopeAvailable: false,
    barometerAvailable: false,
  });
  const [latest, setLatest] = useState<LatestRaw>(getLatestRaw);

  useEffect(() => {
    void probeSensorAvailability().then(setAvailability);
    return subscribeLatestRaw(setLatest);
  }, []);

  return { availability, latest };
}
