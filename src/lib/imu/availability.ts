import { Accelerometer, Barometer, Gyroscope } from "expo-sensors";
import { probeNativeAvailability } from "../../../modules/recording-keepalive";
import type { SensorAvailability } from "../rawTypes";

export async function probeSensorAvailability(): Promise<SensorAvailability> {
  const native = probeNativeAvailability();
  if (native) {
    return native;
  }
  const [accelerometerAvailable, gyroscopeAvailable, barometerAvailable] =
    await Promise.all([
      Accelerometer.isAvailableAsync().catch(() => false),
      Gyroscope.isAvailableAsync().catch(() => false),
      Barometer.isAvailableAsync().catch(() => false),
    ]);

  return {
    accelerometerAvailable,
    gyroscopeAvailable,
    barometerAvailable,
  };
}

export async function requestMotionPermissions(): Promise<boolean> {
  try {
    const result = await Accelerometer.requestPermissionsAsync();
    return result.granted;
  } catch {
    return true;
  }
}
