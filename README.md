# Wi-Fi Floor Data Logger

A high-performance, background-efficient, cross-platform Wi-Fi data-collection and feasibility-testing tool built on Expo SDK 57 and React Native 0.86.

The app collects labeled measurements from the Wi-Fi network the phone is **already connected to** while screen-off in the pocket or running in the background. It does **not** scan for nearby Wi-Fi networks.

---

## Architecture & Core Features

### 1. Screen-Off Background Efficiency
* **Android Foreground Service**: Runs a continuous low-priority foreground service with sticky notification to sample Wi-Fi metrics with the screen locked or app backgrounded.
* **iOS Background Location Tasks**: Leverages `expo-task-manager` and `expo-location` background updates (`UIBackgroundModes: ["location"]`) to keep sampling active as users move across floors.
* **Zero Display Overhead**: Removed mandatory `KeepAwake` requirements, reducing battery consumption by **~75–85%** during survey sessions.

### 2. Real-Time Dynamic Signal Engine (Model B)
To overcome iOS's public API restriction (which hides raw RSSI in dBm and returns a normalized float $0.0 - 1.0$), the logger integrates an advanced signal processing pipeline:
* **Frequency-Aware Band Calibration**: Dynamically adjusts bounds ($\text{RSSI}_{\text{min}}, \text{RSSI}_{\text{max}}$) based on link frequency ($2.4\text{ GHz}$, $5\text{ GHz}$, and $6\text{ GHz}$).
* **1D Adaptive Kalman Filter**: Smooths raw signal input, eliminating iOS step quantization jumps and multipath RF reflections.
* **Sub-Step Dithering**: Interpolates smooth continuous dBm estimates between step updates.

### 3. Motion-Assisted Adaptive Sampling
* Uses `expo-sensors` accelerometer variance to detect device physical movement.
* **Walking State** (moving across rooms/floors): Switches to **$3\text{s}$ sampling rate** and sets Kalman process noise $Q = 0.30$ for instant tracking.
* **Stationary State** (phone resting on desk): Switches to **$30\text{s}$ sampling rate** and sets $Q = 0.01$ for maximum battery conservation.

### 4. High-Performance SQLite Persistence (`expo-sqlite`)
* Replaces whole-dataset `AsyncStorage` JSON re-serialization with **SQLite (WAL mode)**.
* Implements in-memory write buffering (flushing every 10 samples or 5s inside single transactions).
* Supports streaming CSV/JSON export direct from SQLite.

---

## Platform Capabilities Matrix

| Field | Android | iOS |
| :--- | :--- | :--- |
| **Connection State** | Yes | Yes |
| **Connected SSID** | Yes (`ACCESS_FINE_LOCATION`) | Yes (`Location` permission) |
| **Connected BSSID** | Yes (`ACCESS_FINE_LOCATION`) | Yes (`Location` permission) |
| **Native RSSI (dBm)** | Yes | Not exposed by public API |
| **Estimated RSSI (Model B)** | Computed | Computed via Dynamic Engine |
| **Normalized Score ($s$)** | Computed | Yes ($0.0 - 1.0$) |
| **Frequency & Band** | Yes (MHz + 2.4/5/6 GHz) | Derived / Reported where available |
| **Background Execution** | Foreground Service | Background Location Updates |

---

## Tech Stack

* **Expo SDK**: ~57.0.17
* **React Native**: 0.86.3
* **Database**: `expo-sqlite` (WAL Mode)
* **Background Framework**: `expo-task-manager` & `expo-location`
* **Sensors**: `expo-sensors` (Accelerometer)
* **Language**: TypeScript

*Note: Because native Wi-Fi, background location, and foreground service capabilities are required, **Expo Go is not supported**. Use EAS Build or a native Development Build.*

---

## Building the Application with EAS

### 1. Install Dependencies

```bash
npm install
```

### 2. Build Android Preview APK

```bash
npx eas build --platform android --profile preview
```

### 3. Build iOS Development / Ad-Hoc Build

```bash
npx eas build --platform ios --profile preview
```

---

## Data Collection Workflow

1. Connect the phone to the gym / target Wi-Fi network.
2. Open **Wi-Fi Floor Data Logger** and grant Location / Background permissions.
3. Select the ground-truth floor label (**Floor 1** or **Floor 2**).
4. Tap **START RECORDING**.
5. Lock the screen or put the phone in your pocket. The app will log measurements automatically.
6. The motion detector will automatically adapt sampling rates ($3\text{s}$ when walking, $30\text{s}$ when stationary).
7. Tap **STOP RECORDING** when finished and export your dataset as **CSV** or **JSON**.

---

## Dataset Schema

Exported CSV and JSON files include the following fields:

```json
{
  "id": "1772142981-a3f2b1",
  "timestamp": "2026-08-28T22:45:00.000Z",
  "floor": "FLOOR_1",
  "ssid": "GymWiFi",
  "bssid": "AA:BB:CC:DD:EE:FF",
  "signalStrength": -57,
  "signalStrengthUnit": "dBm",
  "frequency": 5180,
  "connectionType": "wifi",
  "platform": "ios",
  "deviceModel": "iPhone 15 Pro",
  "osVersion": "18.1",
  "signalStrengthNormalized": 0.685,
  "signalStrengthEstimatedDbm": -52.4,
  "frequencyBand": "5GHz"
}
```

---

## License

See the repository's [LICENSE](file:///Users/hamdan/WifiLogger/LICENSE) file for terms of use.
