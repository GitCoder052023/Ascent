# 📶 WifiLogger

> **⚠️ Important Context:** WifiLogger was originally built as an **internal testing tool** while developing a product for a client. It was never intended to be a polished, general-purpose application. We're open-sourcing it as-is because we believe the underlying techniques — background Wi-Fi sampling, Kalman-filtered signal estimation, motion-adaptive polling — are genuinely useful and hard to find good references for. Take what's useful, ignore what's rough.

A React Native (Expo) app that continuously logs Wi-Fi signal data across physical floors/zones — in the foreground **and** background — and exports structured datasets for analysis.

Built with Expo SDK 57 · React Native 0.86 · TypeScript

---

## What It Does

WifiLogger connects to your current Wi-Fi network and records signal measurements at adaptive intervals. It was designed for walking around a multi-floor space and collecting labeled signal-strength data per zone.

**Core capabilities:**

- **Cross-platform Wi‑Fi collection** — Android reads native RSSI in dBm from the connected AP; iOS does not expose a continuous raw dBm stream the same way, so the app uses a custom estimate pipeline instead
- **Background-efficient logging** — continues recording when the app is backgrounded or the screen is locked, using platform-native mechanisms (Android Foreground Service, iOS Background Location)
- **Motion-adaptive sampling** — uses accelerometer data to detect walking vs. stationary states, sampling every **3 seconds** while moving and every **30 seconds** when still
- **Floor/zone labeling** — tag measurements with a floor label (FLOOR_1 / FLOOR_2) to build per-zone datasets
- **Dataset export** — export all collected measurements as **CSV** or **JSON** via the native share sheet
- **SQLite persistence** — measurements are stored locally in SQLite with WAL journaling and buffered writes, surviving app restarts
- **iOS RSSI reconstruction** — a dedicated `SignalEstimationEngine` turns coarse iOS signal scores into usable estimated dBm values so the dataset remains comparable across platforms

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
| Sensors | `expo-sensors` (Accelerometer) |
| Export | `expo-file-system`, `expo-sharing` |

---

## Architecture Overview

```
┌─────────────────────────────────────────────┐
│                    UI Layer                  │
│              src/app/index.tsx               │
│    Floor selector · Metrics · Export actions │
└──────────────────┬──────────────────────────┘
                   │
          ┌────────▼────────┐
          │  useWifiLogger   │  Main orchestrator hook
          │  useMotionDetect │  Accelerometer → walking/stationary
          └────────┬────────┘
                   │
     ┌─────────────┼─────────────┐
     ▼             ▼             ▼
 lib/wifi.ts   lib/signal    lib/db.ts
 NetInfo +     Engine.ts     SQLite WAL +
 WifiManager   Kalman +      buffered writes
               Band Model
                   │
                   ▼
          services/backgroundTask.ts
          expo-task-manager + expo-location
          (foreground service / bg location)
```

### Android vs. iOS RSSI Collection

The key behavior is different by platform, and that difference is why we needed a separate iOS-only estimation path.

| Platform | What the OS gives us | How we use it |
|---|---|---|
| Android | Native connected-AP RSSI in dBm via `WifiManager.getCurrentSignalStrength()` and Wi‑Fi frequency | Store it directly as `signalStrength` and treat it as the ground truth for that sample |
| iOS | No continuous raw dBm stream from the connected AP in the way Android exposes it; background reads are coarse and normalized | Convert the available normalized score into an estimated dBm value using a custom reconstruction engine |

On Android, the app can read a relatively steady stream of Wi‑Fi metrics directly from the native stack. That makes the data collection path straightforward: native dBm → smoothing/filtering if needed → exported dataset.

On iOS, we do not get the same kind of continuous raw RSSI stream. In practice, the app receives a normalized / quantized signal score from the system rather than a true, ongoing dBm trace. That is not enough to produce a comparable floor-strength dataset without additional modeling. So we built a dedicated `SignalEstimationEngine` that:

1. **Normalizes** the iOS signal score into a 0–1 value (handling both native dBm and percentage-style inputs when present)
2. **Applies a 1D Kalman filter** to smooth the noisy score with motion-aware process noise (`Q=0.30` when walking, `Q=0.01` when stationary)
3. **Maps the smoothed score back to dBm** using band-aware calibration for the actual Wi‑Fi band:
   - 2.4 GHz: −92 to −28 dBm
   - 5 GHz: −88 to −32 dBm
   - 6 GHz: −84 to −35 dBm

This is not a perfect replacement for true native RSSI. It is a best-effort reconstruction that allows the app to produce a comparable signal series on iOS for the same floor-mapping task. In other words, the app uses the same target outcome across both platforms — a continuous, labeled signal-strength dataset — but the iOS path had to invent its own estimation layer because the platform itself does not natively supply the raw dBm stream Android does.

### Motion Detection

The `useMotionDetector` hook runs the accelerometer at 10 Hz, applies a high-pass filter to isolate linear acceleration from gravity, and uses a dual-threshold approach (instantaneous step peak > 0.045 G **or** sliding-window variance > 0.005) with a 6-second hangover to classify walking vs. stationary.

---

## Getting Started

### Prerequisites

- Node.js ≥ 18
- [Expo CLI](https://docs.expo.dev/get-started/installation/)
- For device builds: [EAS CLI](https://docs.expo.dev/eas/) (`npm install -g eas-cli`)
- A physical device (Wi-Fi APIs don't work on simulators/emulators)

### Install & Run

```bash
# Clone the repo
git clone https://github.com/your-username/WifiLogger.git
cd WifiLogger

# Install dependencies
npm install

# Start the dev server
npx expo start
```

### Building for Device

This app requires a **development build** (not Expo Go) because it uses native modules (`react-native-wifi-reborn`, `expo-task-manager`, etc.).

```bash
# Development build (internal distribution)
eas build --profile development --platform android
eas build --profile development --platform ios

# Preview APK (Android)
eas build --profile preview --platform android
```

---

## Permissions

The app requests the following permissions — all necessary for Wi-Fi signal access and background logging:

| Permission | Why |
|---|---|
| `ACCESS_FINE_LOCATION` | Required by Android to read Wi-Fi SSID and BSSID |
| `ACCESS_BACKGROUND_LOCATION` | Background Wi-Fi sampling when app is not in foreground |
| `FOREGROUND_SERVICE` | Android foreground service for continuous logging |
| `POST_NOTIFICATIONS` | Android 13+ notification for the foreground service |
| `WAKE_LOCK` | Prevent CPU sleep during background sampling |
| iOS Location (Always) | Background location triggers used as a keep-alive for Wi-Fi reads |

---

## Exported Data Schema

Each measurement (CSV/JSON) contains a single record from either the native Android path or the iOS estimation pipeline. The exported schema keeps both the raw/native and reconstructed values so the dataset can be compared across platforms.

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique measurement ID |
| `timestamp` | ISO 8601 | When the measurement was taken |
| `floor` | `FLOOR_1` \| `FLOOR_2` | User-selected zone label |
| `ssid` | string | Connected Wi-Fi network name |
| `bssid` | string | Access point MAC address |
| `signalStrength` | number | Native RSSI in dBm on Android. On iOS this is the best available signal value before reconstruction, often a coarse normalized score converted to an approximation before storage. |
| `signalStrengthUnit` | `dBm` | Unit used for the raw/native signal |
| `frequency` | number | Wi-Fi frequency in MHz |
| `connectionType` | `wifi` | Always "wifi" |
| `platform` | string | `ios` or `android` |
| `deviceModel` | string | Device model name |
| `osVersion` | string | OS version string |
| `signalStrengthNormalized` | number | Kalman-smoothed normalized score (0–1), generated for both platforms to keep downstream processing consistent |
| `signalStrengthEstimatedDbm` | number | Band-calibrated estimated dBm. Android often uses the native value directly; iOS uses the custom reconstruction engine |
| `frequencyBand` | string | `2.4GHz`, `5GHz`, `6GHz`, or `UNKNOWN` |

---

## Project Structure

```
src/
├── app/
│   ├── _layout.tsx          # Root layout
│   └── index.tsx            # Main screen UI
├── components/
│   ├── InfoRow.tsx           # Key-value display row
│   ├── Metric.tsx            # Metric card
│   └── Section.tsx           # Collapsible section wrapper
├── constants/
│   └── app.ts               # App-wide constants
├── hooks/
│   ├── useMotionDetector.ts  # Accelerometer-based motion detection
│   └── useWifiLogger.ts      # Main logging orchestrator
├── lib/
│   ├── dataset.ts            # Measurement CRUD + export
│   ├── db.ts                 # SQLite database layer
│   ├── signalEngine.ts       # Kalman filter + band calibration
│   └── wifi.ts               # Wi-Fi snapshot via NetInfo + WifiManager
├── services/
│   └── backgroundTask.ts     # Background logging task
├── styles/
│   └── appStyles.ts          # Stylesheet
└── utils/
    └── format.ts             # Formatting helpers
```

---

## Known Limitations

This was an internal tool — treat it accordingly:

- **Hardcoded to two floors** — the floor labels (`FLOOR_1` / `FLOOR_2`) and their descriptions ("Strength area" / "Cardio area") are hardcoded for the specific gym we were testing in. You'll want to make these configurable for your use case.
- **iOS signal estimation is approximate** — the Kalman + band-model approach produces reasonable estimates but they're not ground truth. Use them as relative indicators.
- **No scan of nearby networks** — only the currently connected AP is logged. This intentionally avoids `WifiManager.loadWifiList()` to stay within background constraints.
- **No remote sync** — all data stays on-device. Export manually via the share sheet.

---

## License

[MIT](LICENSE) — Copyright 2026 Hamdan Khubaib
