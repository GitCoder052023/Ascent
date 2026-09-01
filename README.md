# Ascent

> **Research Tool:** Designed for multi-floor indoor mapping and spatial positioning research (gym floors in the current labeling UI). Records timestamped, raw sensor and connected Wi-Fi datasets without on-device fusion, filtering, or auto-labeling.

Built with **Expo SDK 57** · **React Native 0.86** · **TypeScript 6.0**

---

## Key Features

* **Unfiltered Raw Sensors** — Direct recording of accelerometer ($x/y/z$), gyroscope ($x/y/z$), and barometric pressure from platform hardware APIs.
* **Independent Sparse Rows** — Event-driven storage: each sensor firing writes its own observation row so native sampling rates are preserved.
* **Manual Ground-Truth Labeling** — Real-time tags for spatial context (`FLOOR_1`, `FLOOR_2`) and transition activities (`GOING_UPSTAIRS`, `COMING_DOWNSTAIRS`).
* **Connected Wi-Fi Logging** — Records the associated AP only (SSID, BSSID, RSSI in dBm, frequency). No AP scan. On Android during a session this is polled every **2s** from `WifiInfo` in foreground, background, and on the lock screen.
* **Native Android Capture** — IMU and Wi-Fi rows are written by a `RecordingImuService` foreground service (`SENSOR_DELAY_FASTEST` for IMU) so JavaScript is not on the sample path. Unrestricted battery is required to start a session.
* **Device Presence** — Each raw row stores `appState` (`FOREGROUND` / `BACKGROUND`), `lockScreen`, and `screenOn`.
* **Local SQLite Persistence** — Buffered writes to `wifilogger_v2.db` (WAL mode) for long collection runs.
* **Flexible Data Export** — CSV of raw observations, or JSON with session metadata plus the full observation list.

---

## Tech Stack

| Layer | Technology |
| --- | --- |
| **Framework** | Expo SDK 57, React Native 0.86 |
| **Language** | TypeScript 6.0 |
| **Navigation** | Expo Router |
| **Sensors (JS fallback)** | `expo-sensors` (Accelerometer, Gyroscope, Barometer) |
| **Sensors (Android)** | Custom Expo module `recording-keepalive` (`RecordingImuService`) |
| **Networking** | `@react-native-community/netinfo`, `react-native-wifi-reborn` (connected AP only) |
| **Background** | Native health + location foreground service on Android; `expo-task-manager` / `expo-location` kept as a leftover location-task path that is **stopped** when a session starts |
| **Storage** | `expo-sqlite` (WAL mode) |
| **Export** | `expo-file-system`, `expo-sharing` |

---

## Architecture & Data Model

```
┌──────────────────────────────────────────────────┐
│                    UI Layer                       │
│                 src/app/index.tsx                 │
│   Session Control · Floor/Activity Labels · Export │
└────────────────────────┬─────────────────────────┘
                         │
              ┌──────────▼──────────┐
              │   useWifiLogger     │  Session, permissions, export
              │   imuCollector      │  Native service or JS sensors
              │   useMotionDetector │  Idle-time WALKING / STATIONARY
              └──────────┬──────────┘
                         │
     ┌─────────┬─────────┼─────────┬──────────────┐
     ▼         ▼         ▼         ▼              ▼
 lib/wifi   signal    rawObs     recording     db.ts
 NetInfo +  Android   builders   context       SQLite WAL
 WifiInfo   RSSI dBm  + types    labels        + native writer
                         │
              modules/recording-keepalive (Android)
              RecordingImuService · IMU + WifiInfo · SQLite
```

On Android, `startImuCollector` starts the native service. IMU samples and 2s Wi-Fi polls are written on a dedicated thread. JS is used for UI, labels, session lifecycle, and a JS `expo-sensors` fallback if the native module is unavailable.

### Observation Model (Sparse Rows)

Sensors record asynchronously. Empty fields are intentional (native ticks, not fused samples):

```text
timestamp                      sensorType       accelX   gyroX   pressure   RSSI   appState
2026-08-31T22:10:00.001Z       accelerometer    0.12     -       -          -      FOREGROUND
2026-08-31T22:10:00.018Z       gyroscope        -        0.01    -          -      FOREGROUND
2026-08-31T22:10:01.000Z       barometer        -        -       1008.42    -      BACKGROUND
2026-08-31T22:10:03.000Z       wifi             -        -       -          -57    BACKGROUND
```

### Timestamp Handling

* **`timestamp` / `arrivalTimestamp`**: ISO-8601 UTC (millisecond precision) of app receipt.
* **`sensorTimestamp`**: Native hardware clock in **seconds since boot** when the platform provides it. Not Unix time.
* **`timestampSource`**: Always `arrival`.

### Wi-Fi sampling (what the app actually does)

* **During recording (Android native):** connected AP every **2s**, independent of walking vs stationary.
* **UI “WIFI INTERVAL” while idle:** motion heuristic still reports 3s (walking) / 30s (stationary); that interval is **not** used for the native recording path.
* RSSI is Android `WifiInfo` dBm only. NetInfo’s 0–100 `strength` is never stored as RSSI.

---

## Getting Started

### Prerequisites

* Node.js ≥ 18
* EAS CLI (`npm install -g eas-cli`)
* Physical **Android** device (native IMU/Wi-Fi capture is Android-only; sensors and Wi-Fi are mocked or limited in emulators)

### Installation

```bash
git clone https://github.com/GitCoder052023/Ascent.git
cd Ascent
npm install
```

### Device Development Builds

Custom native code (`recording-keepalive`, `react-native-wifi-reborn`, foreground services) requires a **development build**, not Expo Go:

```bash
eas build --platform android --profile preview
```

Lock Ascent in Recents, grant **unrestricted battery**, and choose **Allow all the time** for location so SSID/RSSI stay readable with the screen off. OEM process killers can still create gaps.

---

## Permissions Required

| Permission | Purpose |
| --- | --- |
| `ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION` | Required on Android to read SSID/BSSID |
| `ACCESS_BACKGROUND_LOCATION` | Keep SSID/RSSI readable with the screen off |
| `NEARBY_WIFI_DEVICES` | Android 13+ Wi-Fi identity access |
| `FOREGROUND_SERVICE` / `FOREGROUND_SERVICE_HEALTH` / `FOREGROUND_SERVICE_LOCATION` | Native IMU + Wi-Fi recording service |
| `HIGH_SAMPLING_RATE_SENSORS` | Fast IMU (`SENSOR_DELAY_FASTEST`) |
| `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` | Session will not start until unrestricted battery is allowed |
| `ACTIVITY_RECOGNITION` | Motion-related permission on Android 10+ |
| `POST_NOTIFICATIONS` | Persistent recording notification |
| `WAKE_LOCK` | CPU wake lock on the JS fallback path |

iOS background location is **disabled** in `app.json`. The native keepalive module is Android-only.

---

## Data Schema Reference

### Core Observation Columns (CSV / JSON)

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Unique record UUID |
| `sessionId` | string | Session identifier (e.g. `SESSION_001`) |
| `timestamp` | string | ISO 8601 UTC receipt time |
| `arrivalTimestamp` | string | Same receipt clock (ISO 8601 UTC) |
| `sensorTimestamp` | number \| null | Platform sensor clock (seconds, not Unix) |
| `timestampSource` | string | `arrival` |
| `sensorType` | string | `accelerometer` \| `gyroscope` \| `barometer` \| `wifi` |
| `floor` | string \| null | `FLOOR_1`, `FLOOR_2` |
| `activity` | string \| null | `GOING_UPSTAIRS`, `COMING_DOWNSTAIRS` |
| `motionState` | string \| null | Heuristic `WALKING` \| `STATIONARY` |
| `accelerometerX/Y/Z` | number \| null | Raw acceleration ($g$) |
| `gyroscopeX/Y/Z` | number \| null | Raw rotational velocity ($\text{rad/s}$) |
| `barometerPressure` | number \| null | Atmospheric pressure ($\text{hPa}$); omitted if hardware is missing |
| `ssid` / `bssid` / `signalStrength` | string / number \| null | Connected AP; RSSI is dBm |
| `signalStrengthUnit` | string \| null | `dBm` on valid Wi-Fi rows |
| `frequency` | number \| null | Channel frequency (MHz) |
| `connectionType` | string \| null | `wifi` on Wi-Fi rows |
| `platform` / `deviceModel` / `osVersion` | string \| null | Device metadata |
| `appState` | string | `FOREGROUND` \| `BACKGROUND` |
| `lockScreen` | string | `YES` \| `NO` \| `UNKNOWN` |
| `screenOn` | string | `YES` \| `NO` \| `UNKNOWN` |

JSON export wraps `{ sessions, observations }`. Session rows include sensor availability flags and collection notes.

---

## Project Structure

```
src/
├── app/                  # Main screen and layout
├── components/           # Metrics, sections, info rows
├── constants/            # Wi-Fi sample interval (2s while recording)
├── hooks/                # Session orchestration, motion detector, latest-row UI
├── lib/                  # SQLite, row builders, Wi-Fi, IMU collector, presence
├── services/             # Legacy location-task helpers (stopped at session start)
├── styles/               # Screen styles
└── utils/                # Duration formatting
modules/
└── recording-keepalive/  # Android native IMU + WifiInfo + SQLite writer
plugins/
└── keep-android-imu-in-background.js
scripts/
└── verify-raw-observation.mjs
```

---

## License

[MIT](LICENSE) — Copyright 2026 Hamdan Khubaib
