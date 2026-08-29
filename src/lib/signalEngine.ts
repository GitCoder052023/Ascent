export type FrequencyBand = "2.4GHz" | "5GHz" | "6GHz" | "UNKNOWN";

export type BandBounds = {
  minDbm: number;
  maxDbm: number;
};

export const BAND_BOUNDS: Record<FrequencyBand, BandBounds> = {
  "2.4GHz": { minDbm: -92, maxDbm: -28 },
  "5GHz": { minDbm: -88, maxDbm: -32 },
  "6GHz": { minDbm: -84, maxDbm: -35 },
  UNKNOWN: { minDbm: -90, maxDbm: -30 },
};

export function getFrequencyBand(frequency: number | null): FrequencyBand {
  if (!frequency) return "UNKNOWN";
  if (frequency >= 2400 && frequency <= 2484) return "2.4GHz";
  if (frequency >= 5150 && frequency <= 5885) return "5GHz";
  if (frequency >= 5925 && frequency <= 7125) return "6GHz";
  return "UNKNOWN";
}

/** iOS-only: reverse-engineer dBm from a normalized/quantized score. */
export type SignalSource = "android-native" | "ios-estimated";

export type ProcessedSignal = {
  normalizedScore: number | null;
  estimatedDbm: number | null;
  frequencyBand: FrequencyBand;
  source: SignalSource;
};

/** Android WifiInfo.INVALID_RSSI is -127; treat 0 and positive as non-dBm. */
export function isValidAndroidRssiDbm(value: number | null): value is number {
  return value !== null && !isNaN(value) && value < 0 && value > -127;
}

export function nativeAndroidSignal(
  rssiDbm: number | null,
  frequency: number | null
): ProcessedSignal {
  const frequencyBand = getFrequencyBand(frequency);
  if (!isValidAndroidRssiDbm(rssiDbm)) {
    return {
      normalizedScore: null,
      estimatedDbm: null,
      frequencyBand,
      source: "android-native",
    };
  }

  const bounds = BAND_BOUNDS[frequencyBand];
  const span = bounds.maxDbm - bounds.minDbm;
  const score = span === 0 ? 0 : (rssiDbm - bounds.minDbm) / span;

  return {
    normalizedScore: Math.round(Math.max(0, Math.min(1, score)) * 1000) / 1000,
    estimatedDbm: rssiDbm,
    frequencyBand,
    source: "android-native",
  };
}

export class SignalEstimationEngine {
  private xEst: number | null = null; // Estimated normalized score
  private P: number = 1.0;            // Error covariance
  private R: number = 2.5;            // iOS step quantization measurement noise
  private lastTimestamp: number = Date.now();

  /**
   * Process raw signal score (0.0 to 1.0) through Kalman Filter & Band Calibrator
   * @param rawScore Normalized signal score from iOS (0.0 - 1.0)
   * @param frequency Wi-Fi frequency in MHz
   * @param isMoving Whether device is currently in motion
   */
  public processSignal(
    rawScore: number | null,
    frequency: number | null,
    isMoving: boolean = false
  ): ProcessedSignal {
    const band = getFrequencyBand(frequency);
    const bounds = BAND_BOUNDS[band];

    if (rawScore === null || isNaN(rawScore)) {
      return {
        normalizedScore: null,
        estimatedDbm: null,
        frequencyBand: band,
        source: "ios-estimated",
      };
    }

    // Dynamic Process Noise: 0.01 when stationary (heavy smooth), 0.30 when moving (fast track)
    const Q = isMoving ? 0.30 : 0.01;
    const now = Date.now();
    const dt = Math.max(1, (now - this.lastTimestamp) / 1000);
    this.lastTimestamp = now;

    // 1D Kalman Filter Update
    if (this.xEst === null) {
      this.xEst = rawScore;
      this.P = 1.0;
    } else {
      // 1. Predict
      this.P = this.P + Q * dt;

      // 2. Update
      const K = this.P / (this.P + this.R);
      this.xEst = this.xEst + K * (rawScore - this.xEst);
      this.P = (1 - K) * this.P;
    }

    // Clamp smoothed normalized score between 0 and 1
    const smoothedScore = Math.max(0, Math.min(1, this.xEst));

    // Piecewise band-aware calculation
    const span = bounds.maxDbm - bounds.minDbm;
    const estimatedDbm = Math.round((bounds.minDbm + smoothedScore * span) * 10) / 10;

    return {
      normalizedScore: Math.round(smoothedScore * 1000) / 1000,
      estimatedDbm,
      frequencyBand: band,
      source: "ios-estimated",
    };
  }

  public reset(): void {
    this.xEst = null;
    this.P = 1.0;
  }
}

export const globalSignalEngine = new SignalEstimationEngine();
