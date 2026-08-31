# 📶 WifiLogger

> **⚠️ Important Context:** WifiLogger started as an **internal testing tool** for labeled Wi-Fi signal collection in a gym. It now also records a **purely raw, timestamped, manually labeled multi-sensor dataset** (accelerometer, gyroscope, barometer, Wi-Fi, and the existing motion state) for later research. It is not a polished consumer app. Take what's useful, ignore what's rough.

A React Native (Expo) app that records independent raw sensor observations while you walk a multi-floor space, then exports CSV/JSON for analysis **after** collection. This phase does **not** do sensor fusion, stair detection, ML, interpolation, or derived altitude.

Built with Expo SDK 57 · React Native 0.86 · TypeScript

---

## What It Does

Start a recording session, set the current **floor** and optional **activity** label by hand, then move. Every observation stored while a label is active carries that label. Sensors are **not** aligned onto a shared clock.

**Core capabilities:**

- **Raw IMU + pressure** — accelerometer (x/y/z), gyroscope (x/y/z), and barometer pressure when the device has one. Values are stored as the platform reported them
- **Independent rows** — one sensor event = one dataset row. Empty fields on that row are intentional (no forward-fill, no resampling)
- **Manual ground truth** — `GROUND_FLOOR` / `FLOOR_1` / `FLOOR_2` and `GOING_UPSTAIRS` / `COMING_DOWNSTAIRS`. The app never infers stairs or floor from sensors
- **Recording sessions** — each run gets a `sessionId` such as `SESSION_001` so gym experiments stay separable
- **Existing Wi‑Fi logging** — connected AP SSID, BSSID, RSSI, frequency; adaptive 3s / 30s interval from the motion detector. Recording can start **without** Wi-Fi
- **Existing motion detector** — `WALKING` / `STATIONARY` is copied onto each raw row as `motionState`. It does **not** replace raw accelerometer values
- **Background Wi‑Fi** — continues on location keep-alive (Android foreground service, iOS background location). IMU in the background is OS-dependent and never fabricated
- **SQLite persistence** — WAL + buffered writes; data survives app restarts
- **Export** — unified raw CSV, or JSON with `{ sessions, observations }`

The on-screen Wi-Fi panel still uses the existing iOS Kalman / band estimate for display. Those derived Wi-Fi fields stay in the legacy `measurements` table and are **not** added to the raw export.

---

## What This Dataset Is Not

The raw export must not contain (and the collector does not compute):

- filtered / smoothed IMU
- estimated altitude or floor height from pressure
- sensor fusion, Kalman on IMU, interpolation, resampling, or a synchronized snapshot of all sensors at one timestamp
- automatic activity or stair recognition

Analysis happens later from the exported file.

---

## Tech Stack

| Layer | Tech |
|---|---|
| Framework | [Expo](https://expo.dev) SDK 57, React Native 0.86 |
| Language | TypeScript 6.0 |
| Navigation | Expo Router |
| Wi-Fi APIs | `@react-native-community/netinfo`, `react-native-wifi-reborn` |
| Background | `expo-task-manager`, `expo-location` (foreground service / background location) |
| Storage | `expo-sqlite` (WAL mode, buffered writes) |
| Sensors | `expo-sensors` (Accelerometer, Gyroscope, Barometer) |
| Export | `expo-file-system`, `expo-sharing` |

---

## Architecture Overview

```
┌──────────────────────────────────────────────────┐
│                    UI Layer                       │
│                 src/app/index.tsx                 │
│  Session · floor/activity labels · sensors · export │
└────────────────────────┬─────────────────────────┘
                         │
              ┌──────────▼──────────┐
              │   useWifiLogger     │  Orchestrator
              │   useMotionDetector │  Accel → WALKING/STATIONARY
              │   useRawSensorCollector │ Independent IMU/baro rows
              └──────────┬──────────┘
                         │
     ┌─────────┬─────────┼─────────┬─────────┐
     ▼         ▼         ▼         ▼         ▼
 lib/wifi   signal    rawObs    recording   db.ts
 NetInfo +  Engine    builders  context    measurements +
 WifiMgr    (UI/iOS   + types   labels     raw_observations +
            only)                          recording_sessions
                         │
                         ▼
                services/backgroundTask.ts
                Wi-Fi sample on location wakeup
```

**Flow:** phone sensor/Wi-Fi event → receipt timestamp + optional native `sensorTimestamp` → current manual labels → SQLite → CSV/JSON.

### One observation = one row

Different sensors fire at different times. A stretch of CSV looks like:

```text
timestamp                      sensorType       accelX   gyroX   pressure   RSSI
2026-08-31T22:10:00.001Z       accelerometer    0.12     (empty) (empty)    (empty)
2026-08-31T22:10:00.018Z       gyroscope        (empty)  0.01    (empty)    (empty)
2026-08-31T22:10:01.000Z       barometer        (empty)  (empty) 1008.42    (empty)
2026-08-31T22:10:03.000Z       wifi             (empty)  (empty) (empty)    -57
```

NULLs are the raw representation. They are not filled from the previous sample.

### Timestamps

| Field | Meaning |
|---|---|
| `timestamp` / `arrivalTimestamp` | ISO-8601 UTC with milliseconds — when **this app** received the event |
| `sensorTimestamp` | Expo/native `measurement.timestamp` in **seconds** when the API provides it (typically time since boot). **Not** Unix time and never rewritten as ISO |
| `timestampSource` | Always `arrival` for the ISO fields. The dataset does not pretend a receipt time is a hardware clock |

Wi-Fi rows have no native IMU-style sensor clock; `sensorTimestamp` is empty.

### Manual labels

While `GOING_UPSTAIRS` (or a floor) is selected, **every** subsequent row — accel, gyro, baro, Wi-Fi — repeats that label until you change or clear it. Sensors never override the label.

### Android vs. iOS RSSI (legacy Wi-Fi path)

Wi-Fi collection is unchanged in role: another raw observation source. Platform differences:

| Platform | What the OS gives us | How we use it |
|---|---|---|
| Android | Native connected-AP RSSI in dBm via `WifiManager.getCurrentSignalStrength()` and frequency | Stored as `signalStrength` on the **wifi** row |
| iOS | No continuous raw dBm stream like Android; scores are coarse | Best available value on the wifi row; the Kalman `SignalEstimationEngine` still runs for **on-screen** estimates only |

The iOS engine still: (1) normalizes the score, (2) applies a 1D Kalman filter with motion-aware process noise (`Q=0.30` walking, `Q=0.01` stationary), (3) maps to band-calibrated dBm. Those reconstructed columns are **not** in the unified raw CSV.

### Motion detection

`useMotionDetector` still runs the accelerometer at 10 Hz (20 Hz requested while a raw session is active, because `setUpdateInterval` is shared). It high-pass filters gravity, then uses a dual threshold (step peak > 0.045 G **or** window variance > 0.005) with a 6-second hangover. Output is `WALKING` / `STATIONARY` and still drives Wi-Fi 3s / 30s polling. Raw accel rows store **unfiltered** x/y/z from a separate listener.

### Foreground vs background

| | Foreground | Background |
|---|---|---|
| **IMU / barometer** | `expo-sensors` listeners. Requested intervals are hints (20 ms accel/gyro, 200 ms barometer), not a common sample rate | **Android:** the location foreground service *may* keep JS alive so listeners continue; not guaranteed. **iOS:** the process is usually suspended; continuous IMU/baro is not provided by Expo and is not faked |
| **Wi-Fi** | Adaptive interval while the screen is active | Location task wakeups; rows get the labels last stored in AsyncStorage |

Gaps are valid data. Missing barometer hardware → no pressure rows; other sensors continue.

---

## Getting Started

### Prerequisites

- Node.js ≥ 18
- [Expo CLI](https://docs.expo.dev/get-started/installation/)
- For device builds: [EAS CLI](https://docs.expo.dev/eas/) (`npm install -g eas-cli`)
- A **physical device** (Wi-Fi and motion APIs are not useful on simulators)

### Install & Run

```bash
git clone https://github.com/your-username/WifiLogger.git
cd WifiLogger

npm install

npx expo start
```

After changing the `expo-sensors` config plugin (motion usage string), make a **new native build**.

### Building for Device

This app needs a **development build** (not Expo Go) because of native modules (`react-native-wifi-reborn`, `expo-task-manager`, sensors, etc.).

```bash
eas build --profile development --platform android
eas build --profile development --platform ios

eas build --profile preview --platform android
```

### Gym recording

1. Start recording (creates `SESSION_00N`). Wi-Fi is optional.
2. Set the floor label; tap an activity label when you actually go up/down stairs; tap again to clear.
3. Stop, then **Export CSV** (or JSON).

Builder checks for row shape / NULLs / labels:

```bash
node --experimental-strip-types --no-warnings scripts/verify-raw-observation.mjs
```

---

## Permissions

| Permission | Why |
|---|---|
| `ACCESS_FINE_LOCATION` | Android: read Wi-Fi SSID / BSSID |
| `ACCESS_BACKGROUND_LOCATION` | Background Wi-Fi sampling |
| `FOREGROUND_SERVICE` | Android foreground service |
| `POST_NOTIFICATIONS` | Android 13+ FGS notification |
| `WAKE_LOCK` | Reduce CPU sleep during background sampling |
| iOS Location (Always) | Location wakeups used as keep-alive for Wi-Fi |
| iOS motion (`NSMotionUsageDescription`) | Accelerometer, gyroscope, barometer via `expo-sensors` |

---

## Exported Data Schema

**CSV** is one table of `raw_observations` (legacy Wi-Fi rows are migrated in as `sensorType=wifi`). **JSON** is:

```json
{ "sessions": [ /* capability metadata */ ], "observations": [ /* same fields as CSV */ ] }
```

### Observation columns

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique observation ID |
| `sessionId` | string | e.g. `SESSION_001` |
| `timestamp` | ISO 8601 UTC (ms) | App receipt time |
| `arrivalTimestamp` | ISO 8601 UTC (ms) | Same as `timestamp` |
| `sensorTimestamp` | number or empty | Native Expo timestamp in seconds, if any |
| `timestampSource` | `arrival` | Documents that ISO times are receipt times |
| `sensorType` | `accelerometer` \| `gyroscope` \| `barometer` \| `wifi` | Which stream produced the row |
| `floor` | `GROUND_FLOOR` \| `FLOOR_1` \| `FLOOR_2` | Manual floor label |
| `activity` | `GOING_UPSTAIRS` \| `COMING_DOWNSTAIRS` or empty | Manual activity label |
| `accelerometerX/Y/Z` | number or empty | Raw g's; filled only on accelerometer rows |
| `gyroscopeX/Y/Z` | number or empty | Raw rad/s; gyroscope rows only |
| `barometerPressure` | number or empty | Raw pressure (hPa as reported); barometer rows only |
| `motionState` | `WALKING` \| `STATIONARY` | Existing detector at receipt time |
| `ssid` / `bssid` / `signalStrength` / `signalStrengthUnit` / `frequency` / `connectionType` | Wi-Fi fields or empty | Filled only on wifi rows |
| `platform` / `deviceModel` / `osVersion` | string | Device metadata |

Numeric values are written with JS `String(n)` (no extra rounding).

### Session metadata (JSON `sessions`)

| Field | Description |
|---|---|
| `id` | Session identifier |
| `startedAt` / `endedAt` | ISO timestamps |
| `accelerometerAvailable` / `gyroscopeAvailable` / `barometerAvailable` | Probed at session start |
| `platform` / `deviceModel` / `osVersion` | Device |
| `notes` | Written platform limitations (foreground vs background, timestamp meaning) |

The SQLite `measurements` table still holds the older Wi-Fi-only schema including `signalStrengthNormalized`, `signalStrengthEstimatedDbm`, and `frequencyBand` for the in-app Wi-Fi UI. Those columns are **not** in the unified raw export.

---

## Project Structure

```
src/
├── app/
│   ├── _layout.tsx                 # Root layout
│   └── index.tsx                   # Session, labels, sensors, export
├── components/
│   ├── InfoRow.tsx
│   ├── Metric.tsx
│   └── Section.tsx
├── constants/
│   └── app.ts
├── hooks/
│   ├── useMotionDetector.ts        # Accel → walking/stationary
│   ├── useRawSensorCollector.ts    # Raw accel/gyro/baro listeners
│   └── useWifiLogger.ts            # Orchestrator
├── lib/
│   ├── dataset.ts                  # Wi-Fi measurement + dual-write to raw
│   ├── db.ts                       # SQLite: measurements, raw_observations, sessions
│   ├── rawObservation.ts           # Row builders (one sensor per row)
│   ├── rawTypes.ts                 # Schema, labels, CSV columns
│   ├── recordingContext.ts         # Active session/floor/activity/motion
│   ├── signalEngine.ts             # Kalman + band calibration (Wi-Fi UI / iOS)
│   └── wifi.ts                     # NetInfo + WifiManager
├── services/
│   └── backgroundTask.ts           # Background Wi-Fi samples
├── styles/
│   └── appStyles.ts
└── utils/
    └── format.ts
scripts/
└── verify-raw-observation.mjs      # Row-shape / NULL / label checks
```

---

## Known Limitations

Internal gym tool — treat it accordingly:

- **Labels are gym-specific** — floors (`GROUND_FLOOR`, `FLOOR_1` / Strength, `FLOOR_2` / Cardio) and stair activities are hardcoded.
- **Background IMU is not guaranteed** — especially on iOS. Wi-Fi background logging still uses location wakeups.
- **Barometer is optional** — if `isAvailableAsync()` is false, there are no pressure rows.
- **iOS Wi-Fi dBm is still approximate** on the live UI — not a substitute for Android native RSSI; reconstructed fields are omitted from the raw CSV.
- **No nearby-network scan** — only the connected AP. Avoids `WifiManager.loadWifiList()` for background constraints.
- **No remote sync** — export via the share sheet.
- **Receipt vs sensor clock** — ISO timestamps are app arrival time; do not treat `sensorTimestamp` as Unix.

---

## License

[MIT](LICENSE) — Copyright 2026 Hamdan Khubaib
