import { withNative } from "./native";

export function nativeDevicePresence(): {
  appState: "FOREGROUND" | "BACKGROUND";
  lockScreen: "YES" | "NO" | "UNKNOWN";
  screenOn: "YES" | "NO" | "UNKNOWN";
} | null {
  return withNative<{
    appState: "FOREGROUND" | "BACKGROUND";
    lockScreen: "YES" | "NO" | "UNKNOWN";
    screenOn: "YES" | "NO" | "UNKNOWN";
  } | null>(null, (module) => {
    const value = module.presence();
    const appState = value.appState === "FOREGROUND" ? "FOREGROUND" : "BACKGROUND";
    const lockScreen =
      value.lockScreen === "YES" || value.lockScreen === "NO" || value.lockScreen === "UNKNOWN"
        ? value.lockScreen
        : "UNKNOWN";
    const screenOn =
      value.screenOn === "YES" || value.screenOn === "NO" || value.screenOn === "UNKNOWN"
        ? value.screenOn
        : "UNKNOWN";
    return { appState, lockScreen, screenOn };
  });
}
