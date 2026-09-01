import { AppState, Platform } from "react-native";
import { nativeDevicePresence } from "../../modules/recording-keepalive";

export type AppPresenceState = "FOREGROUND" | "BACKGROUND";
export type YesNoUnknown = "YES" | "NO" | "UNKNOWN";

export type DevicePresence = {
  appState: AppPresenceState;
  lockScreen: YesNoUnknown;
  screenOn: YesNoUnknown;
};

let jsAppState: AppPresenceState =
  AppState.currentState === "active" ? "FOREGROUND" : "BACKGROUND";

AppState.addEventListener("change", (state) => {
  jsAppState = state === "active" ? "FOREGROUND" : "BACKGROUND";
});

export function getDevicePresence(): DevicePresence {
  if (Platform.OS === "android") {
    const native = nativeDevicePresence();
    if (native) {
      return native;
    }
  }

  if (jsAppState === "FOREGROUND") {
    return {
      appState: "FOREGROUND",
      lockScreen: "NO",
      screenOn: "YES",
    };
  }

  return {
    appState: "BACKGROUND",
    lockScreen: Platform.OS === "ios" ? "UNKNOWN" : "UNKNOWN",
    screenOn: "UNKNOWN",
  };
}
