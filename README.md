# Wi-Fi Floor Data Logger

An Android and iOS feasibility-study app for collecting labeled measurements from the Wi-Fi network the phone is **already connected to**. It never scans nearby access points, and does not include attendance, authentication, QR, membership, biometric, or backend features.

## Setup and run

This project uses Expo SDK 57, React Native 0.86, and TypeScript. Install dependencies with `npm install`.

The Wi-Fi module includes native code, so this app must run in an Expo development build or a release build; it cannot retrieve these Wi-Fi fields in Expo Go. Build a development client with EAS (or run `npx expo prebuild` followed by the platform build command), then run `npx expo start --dev-client`.

Use a physical phone. A simulator cannot provide meaningful connected-Wi-Fi measurements.

## Packages and permissions

- `@react-native-community/netinfo` identifies the active connection and provides SSID/BSSID where the operating system permits it.
- `react-native-wifi-reborn` reads the **currently connected** Android Wi-Fi BSSID, RSSI and frequency. Its Expo config plugin adds Android fine-location permission and the iOS Wi-Fi Information entitlement. It is never used to scan Wi-Fi networks.
- `@react-native-async-storage/async-storage` keeps the dataset through restarts.
- `expo-file-system` creates export files in the app sandbox and `expo-sharing` invokes the native share sheet.
- `expo-keep-awake` prevents the display from sleeping during an active foreground recording session.

On Android, Android requires `ACCESS_FINE_LOCATION` to reveal connected Wi-Fi identity/details. The app explains this before requesting it. If it is denied, enable Location access for Wi-Fi Floor Data Logger in Android Settings, then start recording again. No location value is collected or stored.

On iOS there is no app runtime Wi-Fi permission prompt. The build declares Apple’s Wi-Fi Information entitlement, but Apple and the device may still withhold SSID/BSSID unless the entitlement and provisioning conditions are accepted. The app records `null`, never invented values, when that happens.

## Platform capability matrix

| Field | Android | iOS |
| --- | --- | --- |
| Connection state | Yes | Yes |
| Connected SSID | Yes, with location access | Conditional: Wi-Fi Information entitlement/provisioning |
| Connected BSSID | Yes, with location access | Conditional: Wi-Fi Information entitlement/provisioning |
| RSSI / signal strength | Yes, dBm | Not available |
| Frequency/channel | Yes, MHz | Not available |

The in-app Platform Capabilities panel repeats these limits. This deliberately makes the experiment’s iOS limitation visible rather than filling missing values with estimates.

## Gym workflow

1. Join the gym Wi-Fi before opening the recorder.
2. Select **Floor 1** or **Floor 2**; this is the ground-truth label for subsequent samples.
3. Start recording and keep the app open during the session.
4. Change the floor label whenever you move floors.
5. If the SSID changes, recording pauses. Reconnect to the original SSID and explicitly resume.
6. Stop the session and tap **Export CSV** (or JSON) to save/share the dataset.

The sampling interval is 25 seconds. Collection is designed for foreground use over a multi-hour workout. Android and iOS do not offer a reliable, permission-free continuous background reading path for this implementation, so background collection is not claimed or simulated. If the app is temporarily backgrounded, it refreshes when brought back to the foreground.

## Dataset schema

Each record is stored locally as JSON and exported as CSV or JSON:

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

Any field the platform does not provide is stored as `null`. Raw values are preserved without normalization, and no measurement is saved while Wi-Fi is disconnected or when the Wi-Fi read fails.
