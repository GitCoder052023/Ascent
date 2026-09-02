export const ACCEL_REQUESTED_INTERVAL_MS = 20;
export const GYRO_REQUESTED_INTERVAL_MS = 20;
export const BARO_REQUESTED_INTERVAL_MS = 200;
export const MOTION_DETECTOR_INTERVAL_MS = 100;

export type LatestRaw = {
  accelerometer: string | null;
  gyroscope: string | null;
  barometer: string | null;
  wifi: string | null;
};

export const EMPTY_LATEST_RAW: LatestRaw = {
  accelerometer: null,
  gyroscope: null,
  barometer: null,
  wifi: null,
};
