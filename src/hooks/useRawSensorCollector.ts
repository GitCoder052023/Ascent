import { useEffect, useState } from "react";
import { Accelerometer, Barometer, Gyroscope } from "expo-sensors";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { saveRawObservationBuffered, flushRawWriteBuffer } from "../lib/db";
import {
  createAccelerometerObservation,
  createBarometerObservation,
  createGyroscopeObservation,
} from "../lib/rawObservation";
import { getCachedLabels } from "../lib/recordingContext";
import type { DeviceMeta } from "../lib/rawObservation";
import type { SensorAvailability } from "../lib/rawTypes";

const ACCEL_REQUESTED_INTERVAL_MS = 20;
const GYRO_REQUESTED_INTERVAL_MS = 20;
const BARO_REQUESTED_INTERVAL_MS = 200;
const MOTION_DETECTOR_INTERVAL_MS = 100;

export async function probeSensorAvailability(): Promise<SensorAvailability> {
  const [accelerometerAvailable, gyroscopeAvailable, barometerAvailable] =
    await Promise.all([
      Accelerometer.isAvailableAsync().catch(() => false),
      Gyroscope.isAvailableAsync().catch(() => false),
      Barometer.isAvailableAsync().catch(() => false),
    ]);

  return {
    accelerometerAvailable,
    gyroscopeAvailable,
    barometerAvailable,
  };
}

export async function requestMotionPermissions(): Promise<boolean> {
  try {
    const result = await Accelerometer.requestPermissionsAsync();
    return result.granted;
  } catch {
    return true;
  }
}

type LatestRaw = {
  accelerometer: string | null;
  gyroscope: string | null;
  barometer: string | null;
};

export function useRawSensorCollector({
  enabled,
  device,
}: {
  enabled: boolean;
  device: DeviceMeta;
}) {
  const [availability, setAvailability] = useState<SensorAvailability>({
    accelerometerAvailable: false,
    gyroscopeAvailable: false,
    barometerAvailable: false,
  });
  const [latest, setLatest] = useState<LatestRaw>({
    accelerometer: null,
    gyroscope: null,
    barometer: null,
  });

  useEffect(() => {
    void probeSensorAvailability().then(setAvailability);
  }, []);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;
    const subscriptions: { remove: () => void }[] = [];
    const latestLocal: LatestRaw = {
      accelerometer: null,
      gyroscope: null,
      barometer: null,
    };
    let lastUi = 0;

    const maybePublishLatest = (partial: Partial<LatestRaw>) => {
      Object.assign(latestLocal, partial);
      const now = Date.now();
      if (now - lastUi < 750) {
        return;
      }
      lastUi = now;
      setLatest({ ...latestLocal });
    };

    void (async () => {
      try {
        await activateKeepAwakeAsync("raw-sensor-collector");
      } catch {
        // Keep-awake is optional.
      }

      const available = await probeSensorAvailability();
      if (cancelled) return;
      setAvailability(available);

      const listen = (
        availableFlag: boolean,
        start: () => { remove: () => void },
        onFail: () => void
      ) => {
        if (!availableFlag || cancelled) return;
        try {
          const subscription = start();
          if (cancelled) {
            subscription.remove();
            return;
          }
          subscriptions.push(subscription);
        } catch {
          onFail();
        }
      };

      listen(
        available.accelerometerAvailable,
        () => {
          Accelerometer.setUpdateInterval(ACCEL_REQUESTED_INTERVAL_MS);
          return Accelerometer.addListener(({ x, y, z, timestamp }) => {
            try {
              const labels = getCachedLabels();
              const arrivalMs = Date.now();
              const row = createAccelerometerObservation(
                arrivalMs,
                typeof timestamp === "number" ? timestamp : null,
                x,
                y,
                z,
                labels,
                device
              );
              void saveRawObservationBuffered(row).catch(() => {});
              maybePublishLatest({ accelerometer: row.timestamp });
            } catch {
              // Continue other sensors.
            }
          });
        },
        () => setAvailability((prev) => ({ ...prev, accelerometerAvailable: false }))
      );

      listen(
        available.gyroscopeAvailable,
        () => {
          Gyroscope.setUpdateInterval(GYRO_REQUESTED_INTERVAL_MS);
          return Gyroscope.addListener(({ x, y, z, timestamp }) => {
            try {
              const labels = getCachedLabels();
              const arrivalMs = Date.now();
              const row = createGyroscopeObservation(
                arrivalMs,
                typeof timestamp === "number" ? timestamp : null,
                x,
                y,
                z,
                labels,
                device
              );
              void saveRawObservationBuffered(row).catch(() => {});
              maybePublishLatest({ gyroscope: row.timestamp });
            } catch {
              // Continue other sensors.
            }
          });
        },
        () => setAvailability((prev) => ({ ...prev, gyroscopeAvailable: false }))
      );

      listen(
        available.barometerAvailable,
        () => {
          Barometer.setUpdateInterval(BARO_REQUESTED_INTERVAL_MS);
          return Barometer.addListener((reading) => {
            try {
              const pressure = reading.pressure;
              if (typeof pressure !== "number" || !Number.isFinite(pressure)) {
                return;
              }
              const labels = getCachedLabels();
              const arrivalMs = Date.now();
              const timestamp =
                "timestamp" in reading && typeof reading.timestamp === "number"
                  ? reading.timestamp
                  : null;
              const row = createBarometerObservation(
                arrivalMs,
                timestamp,
                pressure,
                labels,
                device
              );
              void saveRawObservationBuffered(row).catch(() => {});
              maybePublishLatest({ barometer: row.timestamp });
            } catch {
              // Continue other sensors.
            }
          });
        },
        () => setAvailability((prev) => ({ ...prev, barometerAvailable: false }))
      );
    })();

    return () => {
      cancelled = true;
      for (const subscription of subscriptions) {
        try {
          subscription.remove();
        } catch {
          // Ignore.
        }
      }
      try {
        Accelerometer.setUpdateInterval(MOTION_DETECTOR_INTERVAL_MS);
      } catch {
        // Ignore.
      }
      void deactivateKeepAwake("raw-sensor-collector");
      void flushRawWriteBuffer();
    };
  }, [enabled, device]);

  return { availability, latest };
}
