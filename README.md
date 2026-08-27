# Wi-Fi Floor Data Logger

An internal Wi-Fi data-collection and feasibility-testing tool built as part of the development of a product for a client.

This repository contains the logger **as-is** and has been open-sourced to make the data-collection approach and platform limitations transparent. It was originally built as an internal engineering/testing utility, not as a polished standalone consumer application.

The app collects labeled measurements from the Wi-Fi network the phone is **already connected to**. It does **not** scan for nearby Wi-Fi networks.

## Purpose

The original purpose of this application was to investigate whether Wi-Fi characteristics could be used as an input for distinguishing between different physical areas/floors of a gym.

The experiment is straightforward:

1. Connect a phone to the gym's Wi-Fi.
2. Collect measurements from the currently connected Wi-Fi network.
3. Label those measurements with the physical floor where they were collected.
4. Export the resulting dataset for further analysis and feasibility testing.

This application is only the **data-collection component**. It does not perform positioning, floor detection, fingerprint matching, or machine-learning classification.

## Project status

This project is being released **as-is** from its original internal testing context.

It should be considered an experimental engineering/data-collection tool rather than a production-ready Wi-Fi positioning system.

In particular:

* The UI and workflow were designed around controlled internal data collection.
* Some implementation decisions are specific to the original client/product experiment.
* Android and iOS expose different Wi-Fi information.
* Unsupported measurements are intentionally represented as `null`.
* Compatibility with future versions of Android, iOS, React Native, or Expo is not guaranteed.
* Successful measurements on one device or Wi-Fi setup do not guarantee identical behavior on another.

## Tech stack

This project uses:

* Expo SDK 57
* React Native 0.86
* TypeScript
* Expo development/release builds through EAS

Because the application requires native Wi-Fi functionality, **Expo Go is not supported** for the actual data-collection functionality.

## Building the Android application with EAS

The easiest way to test the application on a real Android phone is to create an Android APK using **EAS Build**.

### 1. Install dependencies

```bash
npm install
```

### 2. Install and log in to EAS CLI

If EAS CLI is not already installed:

```bash
npm install -g eas-cli
```

Then log in:

```bash
eas login
```

### 3. Build an Android APK

For a directly installable testing build:

```bash
eas build --platform android --profile preview
```

### 5. Download the APK

After the EAS build completes, EAS provides a build URL. Open that URL on your Android phone and download the generated `.apk`.

### 6. Start collecting data

Once installed:

1. Connect the phone to the Wi-Fi network being tested.
2. Open Wi-Fi Floor Data Logger.
3. Grant the required Android permissions when prompted.
4. Select the appropriate floor.
5. Start recording.
6. Keep the application open while collecting data.
7. Export the dataset as CSV or JSON when finished.

## iOS limitations

iOS exposes substantially less Wi-Fi information to third-party applications than Android.

The application therefore does not attempt to fabricate unavailable values.

When a measurement cannot be obtained from the operating system, the corresponding field is stored as `null`.

| Field                  | Android                       | iOS           |
| ---------------------- | ----------------------------- | ------------- |
| Connection state       | Yes                           | Yes           |
| Connected SSID         | Yes, with required permission | Conditional   |
| Connected BSSID        | Yes, with required permission | Conditional   |
| RSSI / signal strength | Yes, dBm                      | Not available |
| Frequency / channel    | Yes, MHz                      | Not available |

The in-app **Platform Capabilities** panel also makes these differences visible.

## Data-collection workflow

The intended testing workflow is:

1. Connect the phone to the Wi-Fi before opening the recorder.
2. Select **Floor 1** or **Floor 2** as the ground-truth label.
3. Start recording.
4. Keep the application open during the collection session.
5. Change the floor label whenever moving between floors.
6. If the connected SSID changes, recording pauses.
7. Reconnect to the original Wi-Fi network and explicitly resume recording.
8. Stop the session.
9. Export the collected data as CSV or JSON.

The sampling interval is **25 seconds**.

The logger is designed for foreground collection over a multi-hour testing session. It does not claim reliable continuous background Wi-Fi collection.

## Dataset schema

Each measurement is stored locally and can be exported as CSV or JSON.

Example record:

```json
{
  "id": "unique-id",
  "timestamp": "2026-08-27T12:34:56.000Z",
  "floor": "FLOOR_1",
  "ssid": "GymWiFi",
  "bssid": "AA:BB:CC:DD:EE:FF",
  "signalStrength": -57,
  "signalStrengthUnit": "dBm",
  "frequency": 5180,
  "connectionType": "wifi",
  "platform": "android",
  "deviceModel": "optional model",
  "osVersion": "optional OS version"
}
```

Any value that the operating system does not provide is stored as `null`.

Raw measurements are preserved without normalization.

No measurement is saved when the device is disconnected from Wi-Fi or when the Wi-Fi read operation fails.

## License

See the repository's license file for the terms under which this code is distributed.
