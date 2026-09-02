import { Alert, Platform } from "react-native";
import {
  isIgnoringBatteryOptimizations,
  requestIgnoreBatteryOptimizations,
} from "../../modules/recording-keepalive";

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
