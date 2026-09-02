import { Alert, PermissionsAndroid, Platform } from "react-native";
import * as Location from "expo-location";
import { Accelerometer } from "expo-sensors";
import {
  isIgnoringBatteryOptimizations,
  requestIgnoreBatteryOptimizations,
} from "../../modules/recording-keepalive";

export async function requestRecordingPermissions(
  onNotice: (message: string) => void
): Promise<boolean> {
  if (Platform.OS === "android") {
    const permissions: string[] = [
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
    ];
    if (typeof Platform.Version === "number" && Platform.Version >= 33) {
      const postNotifications = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
      if (postNotifications) {
        permissions.push(postNotifications);
      }
      permissions.push("android.permission.NEARBY_WIFI_DEVICES");
    }

    const result = await PermissionsAndroid.requestMultiple(
      permissions as Parameters<typeof PermissionsAndroid.requestMultiple>[0]
    );
    if (
      result[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] !==
      PermissionsAndroid.RESULTS.GRANTED
    ) {
      onNotice(
        "Location permission is off. Wi-Fi fields may be empty; IMU recording can still continue."
      );
    }

    if (typeof Platform.Version === "number" && Platform.Version >= 29) {
      const fineGranted =
        result[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] ===
        PermissionsAndroid.RESULTS.GRANTED;
      if (fineGranted) {
        await requestBackgroundLocation();
      }
    }
  }
  try {
    await Accelerometer.requestPermissionsAsync();
  } catch {
    // Motion permission is optional; IMU recording can still continue.
  }

  if (
    Platform.OS === "android" &&
    typeof Platform.Version === "number" &&
    Platform.Version >= 29
  ) {
    const activityRecognition = PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION;
    if (activityRecognition) {
      await PermissionsAndroid.request(activityRecognition).catch(() => null);
    }
  }
  return true;
}

async function requestBackgroundLocation() {
  if (await hasBackgroundLocation()) {
    return;
  }
  const background =
    PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION ??
    "android.permission.ACCESS_BACKGROUND_LOCATION";
  await new Promise<void>((resolve) => {
    Alert.alert(
      "Allow location all the time",
      "Android hides SSID and RSSI when the screen is off unless this app has background location. Choose Allow all the time on the next screen.",
      [
        { text: "Skip", style: "cancel", onPress: () => resolve() },
        {
          text: "Continue",
          onPress: () => {
            void PermissionsAndroid.request(background)
              .catch(() => null)
              .finally(() => resolve());
          },
        },
      ]
    );
  });
}

async function hasBackgroundLocation(): Promise<boolean> {
  if (Platform.OS !== "android") {
    return true;
  }
  if (typeof Platform.Version === "number" && Platform.Version < 29) {
    return true;
  }
  try {
    const background = await Location.getBackgroundPermissionsAsync();
    if (background.status === "granted") {
      return true;
    }
  } catch {
    // Fall through to the platform permission check.
  }
  try {
    const permission =
      PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION ??
      "android.permission.ACCESS_BACKGROUND_LOCATION";
    return await PermissionsAndroid.check(permission);
  } catch {
    return false;
  }
}

export async function ensureUnrestrictedBattery(): Promise<boolean> {
  if (Platform.OS !== "android" || isIgnoringBatteryOptimizations()) {
    return true;
  }
  return await new Promise((resolve) => {
    Alert.alert(
      "Unrestricted battery required",
      "Lock-screen IMU and Wi-Fi will stop unless this app is exempt from battery optimization. Recording will not start until you allow it.",
      [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        {
          text: "Allow",
          onPress: () => {
            void requestIgnoreBatteryOptimizations().finally(() => {
              resolve(isIgnoringBatteryOptimizations());
            });
          },
        },
      ]
    );
  });
}
