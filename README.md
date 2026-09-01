# Ascent

> **Research Tool:** Designed for multi-floor indoor mapping and spatial positioning research. Records timestamped, raw sensor and Wi-Fi signal datasets without on-device manipulation or filtering.

Built with **Expo SDK 57** · **React Native 0.86** · **TypeScript 6.0**

---

## Key Features

* **Unfiltered Raw Sensors** — Direct recording of Accelerometer ($x/y/z$), Gyroscope ($x/y/z$), and Barometric pressure data directly from platform hardware APIs.
* **Independent Sparse Rows** — Implements an event-driven storage model where each sensor firing creates its own independent observation row to preserve true native sampling rates.
* **Manual Ground-Truth Labeling** — Real-time manual tagging for spatial context (e.g., `GROUND_FLOOR`, `FLOOR_1`) and transition activities (e.g., `GOING_UPSTAIRS`).
* **Wi-Fi Signal Logging** — Tracks connected AP attributes (SSID, BSSID, RSSI, Frequency) with dynamic sampling intervals based on motion states.
* **Local SQLite Persistence** — Data is buffered and persisted via SQLite (WAL mode) to guarantee reliability during long collection runs.
* **Flexible Data Export** — Unified CSV export or structured JSON payloads (containing session metadata and full raw observations) ready for offline analysis, ML pipelines, and sensor fusion models.

---

## Tech Stack

| Layer | Technology |
| --- | --- |
| **Framework** | Expo SDK 57, React Native 0.86 |
| **Language** | TypeScript 6.0 |
| **Navigation** | Expo Router |
| **Sensors** | `expo-sensors` (Accelerometer, Gyroscope, Barometer) |
| **Networking** | `@react-native-community/netinfo`, `react-native-wifi-reborn` |
| **Background** | `expo-task-manager`, `expo-location` (Foreground Service / Background Location) |
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
              │   useWifiLogger     │  Orchestration
              │   useMotionDetector │  Accel → Motion State
              │   useRawCollector   │  Independent Sensor Rows
              └──────────┬──────────┘
                         │
     ┌─────────┬─────────┼─────────┬─────────┐
     ▼         ▼         ▼         ▼         ▼
 lib/wifi   signal    rawObs    recording   db.ts
 NetInfo +  Android   builders  context    SQLite Engine
 WifiMgr    RSSI      + types   labels     (WAL Mode)

```

### Observation Model (Sparse Rows)

Sensors record asynchronously to maintain raw event fidelity. NULL/empty fields are intentional and represent native platform ticks:

```text
timestamp                      sensorType       accelX   gyroX   pressure   RSSI
2026-08-31T22:10:00.001Z       accelerometer    0.12     -       -          -
2026-08-31T22:10:00.018Z       gyroscope        -        0.01    -          -
2026-08-31T22:10:01.000Z       barometer        -        -       1008.42    -
2026-08-31T22:10:03.000Z       wifi             -        -       -          -57

```

### Timestamp Handling

* **`timestamp` / `arrivalTimestamp`**: ISO-8601 UTC string (with millisecond precision) recorded upon app receipt.
* **`sensorTimestamp`**: Native hardware timestamp (seconds since boot) preserved directly when provided by platform APIs.

---

## Getting Started

### Prerequisites

* Node.js ≥ 18
* Expo CLI & EAS CLI (`npm install -g eas-cli`)
* Physical Android device (sensors and Wi-Fi scanning are disabled/mocked in emulators)

### Installation

```bash
# Clone repository
git clone https://github.com/GitCoder052023/Ascent.git
cd WifiLogger

# Install dependencies
npm install

```

### Device Development Builds

Because this project relies on custom native modules (`react-native-wifi-reborn`, `expo-sensors`, background services), run it with a **Development Build** instead of Expo Go:

```bash
# Build for Android
eas build --profile development --platform android

```

---

## Permissions Required

| Permission | Purpose |
| --- | --- |
| `ACCESS_FINE_LOCATION` | Required by Android to read Wi-Fi network information (SSID/BSSID) |
| `ACCESS_BACKGROUND_LOCATION` | Enables background Wi-Fi signal logging during walks |
| `FOREGROUND_SERVICE` | Keeps the data collection worker active on Android |

---

## Data Schema Reference

### Core Observation Columns (CSV / JSON)

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Unique record UUID |
| `sessionId` | string | Session identifier (e.g., `SESSION_001`) |
| `timestamp` | string | ISO 8601 UTC receipt time |
| `sensorTimestamp` | number | null | Platform hardware timestamp (seconds) |
| `sensorType` | string | `accelerometer` | `gyroscope` | `barometer` | `wifi` |
| `floor` | string | Active floor label (`GROUND_FLOOR`, `FLOOR_1`, `FLOOR_2`) |
| `activity` | string | null | Active transition label (`GOING_UPSTAIRS`, `COMING_DOWNSTAIRS`) |
| `accelerometerX/Y/Z` | number | null | Raw acceleration forces ($g$) |
| `gyroscopeX/Y/Z` | number | null | Raw rotational velocity ($\text{rad/s}$) |
| `barometerPressure` | number | null | Atmospheric pressure ($\text{hPa}$) |
| `motionState` | string | Heuristic state (`WALKING` | `STATIONARY`) |
| `ssid` / `bssid` / `signalStrength` | string / number | Wi-Fi network parameters (on `wifi` rows) |

---

## Project Structure

```
src/
├── app/                  # Main entry screen, layout, and control UI
├── components/           # UI components for metrics, status, and logging
├── hooks/                # Sensor collection, motion detector, and Wi-Fi hooks
├── lib/                  # SQLite storage, row serialization, and signal logic
├── services/             # Background location/Wi-Fi tasks
└── utils/                # Formatting and math utilities
scripts/
└── verify-raw-observation.mjs  # Data schema and row shape validation script

```

---

## License

[MIT](https://www.google.com/search?q=LICENSE) — Copyright 2026 Hamdan Khubaib