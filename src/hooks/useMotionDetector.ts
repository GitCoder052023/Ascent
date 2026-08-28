import { useEffect, useRef, useState } from "react";
import { Accelerometer } from "expo-sensors";

export type MotionState = "WALKING" | "STATIONARY";

export function useMotionDetector() {
  const [isMoving, setIsMoving] = useState(false);
  const windowRef = useRef<number[]>([]);

  useEffect(() => {
    // Set accelerometer update interval to 500ms
    Accelerometer.setUpdateInterval(500);

    const subscription = Accelerometer.addListener(({ x, y, z }) => {
      // Total magnitude of acceleration vector (approx 1.0 G at rest)
      const magnitude = Math.sqrt(x * x + y * y + z * z);
      
      const window = windowRef.current;
      window.push(magnitude);

      // Keep sliding window of 10 samples (5 seconds of data)
      if (window.length > 10) {
        window.shift();
      }

      if (window.length >= 4) {
        // Calculate mean
        const mean = window.reduce((sum, val) => sum + val, 0) / window.length;
        // Calculate variance
        const variance =
          window.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
          window.length;

        // Variance threshold: resting variance is ~0.001 - 0.02, walking is > 0.06
        const moving = variance > 0.06;
        setIsMoving(moving);
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
