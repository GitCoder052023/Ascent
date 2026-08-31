import assert from "node:assert/strict";
import {
  createAccelerometerObservation,
  createBarometerObservation,
  createGyroscopeObservation,
  createWifiObservation,
  csvCell,
  formatIsoMillis,
} from "../src/lib/rawObservation.ts";
import { RAW_CSV_COLUMNS } from "../src/lib/rawTypes.ts";

const labels = {
  sessionId: "SESSION_001",
  floor: "FLOOR_1",
  activity: "GOING_UPSTAIRS",
  motionState: "WALKING",
};
const device = { platform: "ios", deviceModel: "iPhone", osVersion: "18.6" };

const accel = createAccelerometerObservation(1_725_140_077_123, 123.456, 0.12, 9.81, 0.31, labels, device);
assert.equal(accel.sensorType, "accelerometer");
assert.equal(accel.gyroscopeX, null);
assert.equal(accel.barometerPressure, null);
assert.equal(accel.ssid, null);
assert.equal(accel.activity, "GOING_UPSTAIRS");
assert.equal(accel.floor, "FLOOR_1");
assert.equal(accel.sessionId, "SESSION_001");
assert.equal(accel.accelerometerX, 0.12);
assert.equal(accel.timestampSource, "arrival");
assert.equal(accel.timestamp, formatIsoMillis(1_725_140_077_123));
assert.match(accel.timestamp, /\.\d{3}Z$/);

const gyro = createGyroscopeObservation(1_725_140_077_141, 123.474, 0.01, 0.03, 0.02, labels, device);
assert.equal(gyro.sensorType, "gyroscope");
assert.equal(gyro.accelerometerX, null);
assert.equal(gyro.gyroscopeY, 0.03);
assert.notEqual(gyro.timestamp, accel.timestamp);

const changed = { ...labels, activity: "COMING_DOWNSTAIRS" };
const later = createBarometerObservation(1_725_140_080_000, 126.1, 1008.42, changed, device);
assert.equal(later.activity, "COMING_DOWNSTAIRS");
assert.equal(later.barometerPressure, 1008.42);
assert.equal(later.accelerometerZ, null);

const wifi = createWifiObservation(
  1_725_140_083_000,
  {
    ssid: "GymWifi",
    bssid: "AA:BB:CC:DD:EE:FF",
    signalStrength: -57,
    signalStrengthUnit: "dBm",
    frequency: 5180,
  },
  labels,
  device,
  "wifi-1"
);
assert.equal(wifi.id, "wifi-1");
assert.equal(wifi.sensorType, "wifi");
assert.equal(wifi.sensorTimestamp, null);
assert.equal(wifi.signalStrength, -57);
assert.equal(wifi.accelerometerX, null);
assert.equal(wifi.gyroscopeX, null);
assert.equal(wifi.barometerPressure, null);

const csv = RAW_CSV_COLUMNS.map((key) => csvCell(accel[key])).join(",");
assert.equal(csv.includes("GOING_UPSTAIRS"), true);
assert.equal(csvCell(null), "");
assert.equal(csvCell(0.123456789), "0.123456789");

console.log("verify-raw-observation: all checks passed");
