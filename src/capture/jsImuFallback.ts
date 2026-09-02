import { Accelerometer, Barometer, Gyroscope } from "expo-sensors";
import {
  ACCEL_REQUESTED_INTERVAL_MS,
  BARO_REQUESTED_INTERVAL_MS,
  GYRO_REQUESTED_INTERVAL_MS,
  type LatestRaw,
} from "./imuTypes";
import {
  createAccelerometerObservation,
  createBarometerObservation,
  createGyroscopeObservation,
  type DeviceMeta,
} from "../lib/rawObservation";
import { getCachedLabels, setCachedMotionState } from "../lib/recordingContext";
import type { SensorAvailability } from "../lib/rawTypes";
import { saveRawObservationBuffered } from "../lib/db";

type JsImuHost = {
  isRunning: () => boolean;
  getDevice: () => DeviceMeta | null;
  publishLatest: (partial: Partial<LatestRaw>) => void;
  markSample: (arrivalMs: number) => void;
};

/**
 * Foreground JS sensors for platforms without RecordingKeepalive.
 * Android recording must not use this path.
 */
export function attachJsImuSensors(
  available: SensorAvailability,
  host: JsImuHost
): { remove: () => void }[] {
  const subscriptions: { remove: () => void }[] = [];
  let gravityEstimate = 1;
  let lastWalkAt = 0;

  function attach(sensorAvailable: boolean, start: () => { remove: () => void }) {
    if (!sensorAvailable || !host.isRunning()) {
      return;
    }
    try {
      const subscription = start();
      if (!host.isRunning()) {
        subscription.remove();
        return;
      }
      subscriptions.push(subscription);
    } catch {
      // Leave this sensor off; others can continue.
    }
  }

  attach(available.accelerometerAvailable, () => {
    Accelerometer.setUpdateInterval(ACCEL_REQUESTED_INTERVAL_MS);
    return Accelerometer.addListener(({ x, y, z, timestamp }) => {
      const deviceMeta = host.getDevice();
      if (!host.isRunning() || !deviceMeta) return;
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
          deviceMeta
        );
        void saveRawObservationBuffered(row).catch(() => {});
        host.markSample(arrivalMs);
        gravityEstimate = 0.85 * gravityEstimate + 0.15 * Math.sqrt(x * x + y * y + z * z);
        const linear = Math.abs(Math.sqrt(x * x + y * y + z * z) - gravityEstimate);
        if (linear > 0.045) {
          lastWalkAt = arrivalMs;
        }
        setCachedMotionState(arrivalMs - lastWalkAt < 6000 ? "WALKING" : "STATIONARY");
        host.publishLatest({ accelerometer: row.timestamp });
      } catch {
        // Continue other sensors.
      }
    });
  });

  attach(available.gyroscopeAvailable, () => {
    Gyroscope.setUpdateInterval(GYRO_REQUESTED_INTERVAL_MS);
    return Gyroscope.addListener(({ x, y, z, timestamp }) => {
      const deviceMeta = host.getDevice();
      if (!host.isRunning() || !deviceMeta) return;
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
          deviceMeta
        );
        void saveRawObservationBuffered(row).catch(() => {});
        host.markSample(arrivalMs);
        host.publishLatest({ gyroscope: row.timestamp });
      } catch {
        // Continue other sensors.
      }
    });
  });

  attach(available.barometerAvailable, () => {
    Barometer.setUpdateInterval(BARO_REQUESTED_INTERVAL_MS);
    return Barometer.addListener((reading) => {
      const deviceMeta = host.getDevice();
      if (!host.isRunning() || !deviceMeta) return;
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
          deviceMeta
        );
        void saveRawObservationBuffered(row).catch(() => {});
        host.markSample(arrivalMs);
        host.publishLatest({ barometer: row.timestamp });
      } catch {
        // Continue other sensors.
      }
    });
  });

  return subscriptions;
}
