import { withNative, withNativeAsync } from "./native";

export function nativeRawObservationCount(): number | null {
  return withNative<number | null>(null, (module) => {
    const count = module.rawCount();
    return typeof count === "number" && count >= 0 ? count : null;
  });
}

export function nativeWifiObservationCount(): number | null {
  return withNative<number | null>(null, (module) => {
    const count = module.wifiCount();
    return typeof count === "number" && count >= 0 ? count : null;
  });
}

export async function flushNativeImuWrites(): Promise<void> {
  await withNativeAsync<void>(undefined, async (module) => {
    await module.flushWrites();
  });
}
