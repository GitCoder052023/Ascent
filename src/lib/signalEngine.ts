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

export type SignalSource = "android-native";

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
