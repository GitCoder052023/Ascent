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
  ): {
    normalizedScore: number | null;
    estimatedDbm: number | null;
    frequencyBand: FrequencyBand;
  } {
    const band = getFrequencyBand(frequency);
    const bounds = BAND_BOUNDS[band];

    if (rawScore === null || isNaN(rawScore)) {
      return {
        normalizedScore: null,
        estimatedDbm: null,
        frequencyBand: band,
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

    // Dynamic Model B Formula: Piecewise band-aware calculation
    const span = bounds.maxDbm - bounds.minDbm;
    const estimatedDbm = Math.round((bounds.minDbm + smoothedScore * span) * 10) / 10;

    return {
      normalizedScore: Math.round(smoothedScore * 1000) / 1000,
      estimatedDbm,
      frequencyBand: band,
    };
  }

  public reset(): void {
    this.xEst = null;
    this.P = 1.0;
  }
}

export const globalSignalEngine = new SignalEstimationEngine();
