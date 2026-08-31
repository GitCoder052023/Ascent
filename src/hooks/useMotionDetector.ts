import { useEffect, useRef, useState } from "react";
import { Accelerometer } from "expo-sensors";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { setCachedMotionState } from "../lib/recordingContext";

export type MotionState = "WALKING" | "STATIONARY";
export const KEY_LAST_MOTION = "@wifi_logger_last_motion";

// Keep 'isMoving' active for 6 seconds after any detected step/movement
const MOTION_HANGOVER_MS = 6000;
// Sample accelerometer every 100ms (10Hz) for high precision
const SENSOR_INTERVAL_MS = 100;

export function useMotionDetector() {
  const [isMoving, setIsMoving] = useState(false);
  const windowRef = useRef<number[]>([]);
  const gravityRef = useRef<number>(1.0);
  const lastMotionTimeRef = useRef<number>(0);
  const lastPersistRef = useRef<number>(0);

  useEffect(() => {
    Accelerometer.setUpdateInterval(SENSOR_INTERVAL_MS);

    const subscription = Accelerometer.addListener(({ x, y, z }) => {
      // Total acceleration magnitude vector (approx 1.0 G at rest)
      const magnitude = Math.sqrt(x * x + y * y + z * z);

      // Low-pass filter to isolate gravity component
      gravityRef.current = 0.85 * gravityRef.current + 0.15 * magnitude;

      // High-pass dynamic linear acceleration (removes static gravity)
      const linearAccel = Math.abs(magnitude - gravityRef.current);

      const window = windowRef.current;
      window.push(magnitude);

      // Sliding window of 15 samples (1.5 seconds of data at 10Hz)
      if (window.length > 15) {
        window.shift();
      }

      const now = Date.now();

      if (window.length >= 4) {
        const mean = window.reduce((sum, val) => sum + val, 0) / window.length;
        const variance =
          window.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
          window.length;

        // Sensitive dual-threshold: Instant step peak (>0.045 G) OR walking variance (>0.005)
        const stepDetected = linearAccel > 0.045 || variance > 0.005;

        if (stepDetected) {
          lastMotionTimeRef.current = now;
          if (now - lastPersistRef.current > 1000) {
            lastPersistRef.current = now;
            void AsyncStorage.setItem(KEY_LAST_MOTION, String(now)).catch(() => {});
          }
        }

        const active = now - lastMotionTimeRef.current < MOTION_HANGOVER_MS;
        setIsMoving((prev) => {
          if (prev === active) {
            return prev;
          }
          return active;
        });
        setCachedMotionState(active ? "WALKING" : "STATIONARY");
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  const motionState: MotionState = isMoving ? "WALKING" : "STATIONARY";
  // 3s interval when walking, 30s interval when stationary
  const sampleIntervalMs = isMoving ? 3000 : 30000;

  return {
    isMoving,
    motionState,
    sampleIntervalMs,
  };
}
