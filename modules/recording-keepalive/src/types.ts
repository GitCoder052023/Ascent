type EventSubscription = { remove: () => void };

export type NativeLatestEvent = {
  accelerometer: string | null;
  gyroscope: string | null;
  barometer: string | null;
  motionState: string;
  lastSampleAt: number;
  wifiConnectionState?: string | null;
  wifiSsid?: string | null;
  wifiBssid?: string | null;
  wifiRssi?: number | null;
  wifiFrequency?: number | null;
  wifiTimestamp?: string | null;
  wifiSsidMismatch?: boolean;
  appState?: string | null;
  lockScreen?: string | null;
  screenOn?: string | null;
};

export type NativeRecordingOptions = {
  sessionId?: string | null;
  floor?: string | null;
  activity?: string | null;
  motionState?: string | null;
  deviceModel?: string | null;
  osVersion?: string | null;
  lockedSsid?: string | null;
};

export type RecordingKeepaliveNative = {
  acquire: () => boolean;
  release: () => boolean;
  isHeld: () => boolean;
  isRecording: () => boolean;
  lastSampleAgeMs: () => number;
  isIgnoringBatteryOptimizations: () => boolean;
  requestIgnoreBatteryOptimizations: () => Promise<boolean>;
  probeAvailability: () => {
    accelerometerAvailable: boolean;
    gyroscopeAvailable: boolean;
    barometerAvailable: boolean;
  };
  startRecording: (options: Record<string, string | null | undefined>) => Promise<boolean>;
  updateLabels: (options: Record<string, string | null | undefined>) => boolean;
  stopRecording: () => Promise<boolean>;
  rawCount: () => number;
  wifiCount: () => number;
  presence: () => {
    appState: string;
    lockScreen: string;
    screenOn: string;
  };
  flushWrites: () => Promise<boolean>;
  addListener: (
    event: "onLatest",
    listener: (event: NativeLatestEvent) => void
  ) => EventSubscription;
};
