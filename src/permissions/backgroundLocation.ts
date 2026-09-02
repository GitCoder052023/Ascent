import { Alert, PermissionsAndroid, Platform } from "react-native";
import * as Location from "expo-location";

export async function requestBackgroundLocation() {
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

export async function hasBackgroundLocation(): Promise<boolean> {
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
