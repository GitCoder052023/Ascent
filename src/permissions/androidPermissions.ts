import { Accelerometer } from "expo-sensors";
import { PermissionsAndroid, Platform } from "react-native";
import { requestBackgroundLocation } from "./backgroundLocation";

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
