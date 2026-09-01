import { useEffect, useRef, useState } from "react";
import {
  Alert,
  AppState,
  PermissionsAndroid,
  Platform,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Device from "expo-device";
import {
  clearMeasurements,
  createMeasurement,
  exportDataset,
  loadMeasurements,
  persistWifiMeasurement,
  type Floor,
  type Measurement,
} from "../lib/dataset";
import { getConnectedWifi, processWifiSignal, type WifiSnapshot } from "../lib/wifi";
import { EMPTY_WIFI } from "../constants/app";
import { useMotionDetector } from "./useMotionDetector";
import {
  startBackgroundLoggingAsync,
  stopBackgroundLoggingAsync,
  setBackgroundFloor,
  isBackgroundLoggingActiveAsync,
} from "../services/backgroundTask";
import {
  endRecordingSession,
  flushRawWriteBuffer,
  flushWriteBuffer,
  getRawObservationCount,
  insertRecordingSession,
  nextSessionId,
} from "../lib/db";
import { formatIsoMillis } from "../lib/rawObservation";
import { nativeAndroidSignal } from "../lib/signalEngine";
import {
  hydrateLabelsFromStorage,
  KEY_LOCKED_SSID,
  setCachedActivity,
  setCachedFloor,
  setCachedLockedSsid,
  setCachedMotionState,
  setCachedRecording,
  setCachedSessionId,
} from "../lib/recordingContext";
import { PLATFORM_SENSOR_NOTES, type ActivityLabel } from "../lib/rawTypes";
import {
  probeSensorAvailability,
  requestMotionPermissions,
  useRawSensorCollector,
} from "./useRawSensorCollector";
import {
  isImuCollectorRunning,
  isUsingNativeImu,
  startImuCollector,
  stopImuCollector,
  syncNativeRecordingLabels,
} from "../lib/imuCollector";
import {
  isIgnoringBatteryOptimizations,
  isNativeImuAvailable,
  isNativeImuRecording,
  requestIgnoreBatteryOptimizations,
  subscribeNativeImuLatest,
} from "../../modules/recording-keepalive";

const KEY_STARTED = "@wifi_logger_started";

const DEVICE_META = {
  platform: Platform.OS,
  deviceModel: Device.modelName ?? null,
  osVersion: Platform.Version?.toString() ?? null,
};

export function useWifiLogger() {
  const [hydrated, setHydrated] = useState(false);
  const [floor, setFloorState] = useState<Floor>("FLOOR_1");
  const [activity, setActivityState] = useState<ActivityLabel | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [wifi, setWifi] = useState<WifiSnapshot>(EMPTY_WIFI);
  const [items, setItems] = useState<Measurement[]>([]);
  const [rawCount, setRawCount] = useState(0);
  const [recording, setRecording] = useState(false);
  const [nativeCapture, setNativeCapture] = useState(false);
  const [started, setStarted] = useState<number | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [paused, setPaused] = useState(false);
  const [network, setNetwork] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [appActive, setAppActive] = useState(AppState.currentState === "active");
  const [lastProcessed, setLastProcessed] = useState<{
    normalizedScore: number | null;
    estimatedDbm: number | null;
    frequencyBand: string;
    source: "android-native" | "ios-estimated";
  }>({
    normalizedScore: null,
    estimatedDbm: null,
    frequencyBand: "UNKNOWN",
    source: Platform.OS === "android" ? "android-native" : "ios-estimated",
  });

  const { isMoving, motionState, sampleIntervalMs } = useMotionDetector({
    enabled: appActive && !recording && hydrated,
    ownUpdateInterval: !recording && hydrated,
  });
  const interval = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSampleKey = useRef<string | null>(null);
  const rawCollector = useRawSensorCollector();

  function setFloor(next: Floor) {
    setFloorState(next);
    setCachedFloor(next);
    setBackgroundFloor(next);
    syncNativeRecordingLabels();
  }

  function setActivity(next: ActivityLabel | null) {
    setActivityState(next);
    setCachedActivity(next);
    syncNativeRecordingLabels();
  }

  useEffect(() => {
    setCachedMotionState(motionState);
  }, [motionState]);

  useEffect(() => {
    setBackgroundFloor(floor);
  }, [floor]);

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    async function init() {
      const labels = await hydrateLabelsFromStorage();
      setFloorState(labels.floor);
      setActivityState(labels.activity);
      if (labels.sessionId) {
        setSessionId(labels.sessionId);
      }
      try {
        const measurements = await loadMeasurements();
        setItems(measurements);
      } catch {
        setNotice("Could not load the saved dataset.");
      }
      void getRawObservationCount().then(setRawCount).catch(() => {});
      void refresh();
      await restoreRecordingIfNeeded();
      setHydrated(true);
    }

    void init();

    const subscription = AppState.addEventListener("change", (state) => {
      const active = state === "active";
      setAppActive(active);
      void flushWriteBuffer();
      void flushRawWriteBuffer();
      if (active) {
        void refresh();
        void loadMeasurements().then(setItems);
        void getRawObservationCount().then(setRawCount);
        void restoreRecordingIfNeeded();
      }
    });

    return () => subscription.remove();
  }, []);
  /* eslint-enable react-hooks/exhaustive-deps */

  useEffect(() => {
    const clock = setInterval(() => {
      void getRawObservationCount().then(setRawCount).catch(() => {});
    }, 1000);
    return () => clearInterval(clock);
  }, [recording]);

  async function restoreRecordingIfNeeded() {
    try {
      if (Platform.OS === "android") {
        // Location FGS restarts the Activity in a loop. Native IMU FGS is the keep-alive.
        if (await isBackgroundLoggingActiveAsync()) {
          await stopBackgroundLoggingAsync().catch(() => {});
        }
      }

      const storedStarted = await AsyncStorage.getItem(KEY_STARTED);
      const storedNetwork = await AsyncStorage.getItem(KEY_LOCKED_SSID);
      const nativeOn = isNativeImuRecording();
      const locationOn =
        Platform.OS !== "android" && (await isBackgroundLoggingActiveAsync());
      if (!storedStarted && !nativeOn && !locationOn) {
        return;
      }

      setRecording(true);
      setCachedRecording(true);
      if (storedStarted) {
        const parsed = parseInt(storedStarted, 10);
        if (!isNaN(parsed)) {
          setStarted(parsed);
        }
      } else {
        const now = Date.now();
        setStarted(now);
        await AsyncStorage.setItem(KEY_STARTED, String(now)).catch(() => {});
      }
      if (storedNetwork) {
        setNetwork(storedNetwork);
        setCachedLockedSsid(storedNetwork);
      }
      if (!isImuCollectorRunning()) {
        await startImuCollector(DEVICE_META);
      }
      setNativeCapture(isUsingNativeImu() || isNativeImuRecording());
    } catch {
      // Ignore restore errors; the user can start a new session.
    }
  }

  useEffect(() => {
    if (!recording || !started) {
      return;
    }

    const clock = setInterval(
      () => setSeconds(Math.floor((Date.now() - started) / 1000)),
      1000
    );

    return () => clearInterval(clock);
  }, [recording, started]);

  useEffect(() => {
    if (!isNativeImuAvailable()) {
      return;
    }
    return subscribeNativeImuLatest((event) => {
      if (!event.wifiConnectionState) {
        return;
      }
      const connected = event.wifiConnectionState === "CONNECTED";
      setWifi({
        connectionState: connected ? "CONNECTED" : "DISCONNECTED",
        ssid: event.wifiSsid ?? null,
        bssid: event.wifiBssid ?? null,
        signalStrength: event.wifiRssi ?? null,
        signalStrengthUnit: event.wifiRssi != null ? "dBm" : null,
        frequency: event.wifiFrequency ?? null,
      });
      setLastProcessed(nativeAndroidSignal(event.wifiRssi ?? null, event.wifiFrequency ?? null));
      if (event.wifiSsidMismatch) {
        setPaused(true);
        setNotice(
          `WARNING: Connected Wi-Fi changed. Previous: ${network}. Current: ${event.wifiSsid}. Wi-Fi sampling paused; IMU recording continues.`
        );
      }
    });
  }, [network]);

  useEffect(() => {
    if (!recording || !nativeCapture) {
      return;
    }
    const clock = setInterval(() => {
      void loadMeasurements().then(setItems).catch(() => {});
    }, 2000);
    return () => clearInterval(clock);
  }, [recording, nativeCapture]);

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    if (!recording || paused || nativeCapture) {
      return;
    }

    interval.current = setInterval(() => void sample(), sampleIntervalMs);

    return () => {
      if (interval.current) {
        clearInterval(interval.current);
      }
    };
  }, [recording, paused, floor, network, sampleIntervalMs, nativeCapture]);
  /* eslint-enable react-hooks/exhaustive-deps */

  async function refresh() {
    try {
      const current = await getConnectedWifi();
      setWifi(current);

      const processed = processWifiSignal(current, isMoving);
      setLastProcessed(processed);
    } catch {
      setWifi(EMPTY_WIFI);
    }
  }

  async function requestPermission() {
    if (Platform.OS === "android") {
      const permissions: string[] = [
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
      ];
      if (typeof Platform.Version === "number" && Platform.Version >= 33) {
        const postNotifications = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
        if (postNotifications) {
          permissions.push(postNotifications);
        }
        permissions.push("android.permission.NEARBY_WIFI_DEVICES");
      }

      const result = await PermissionsAndroid.requestMultiple(
        permissions as Parameters<typeof PermissionsAndroid.requestMultiple>[0]
      );
      if (result[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] !== PermissionsAndroid.RESULTS.GRANTED) {
        setNotice(
          "Location permission is off. Wi-Fi fields may be empty; IMU recording can still continue."
        );
      }

      if (typeof Platform.Version === "number" && Platform.Version >= 29) {
        const fineGranted =
          result[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] ===
          PermissionsAndroid.RESULTS.GRANTED;
        if (fineGranted) {
          await requestBackgroundLocation();
        }
      }
    }
    await requestMotionPermissions();

    if (
      Platform.OS === "android" &&
      typeof Platform.Version === "number" &&
      Platform.Version >= 29
    ) {
      const activityRecognition = PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION;
      if (activityRecognition) {
        await PermissionsAndroid.request(activityRecognition).catch(() => null);
      }
    }
    return true;
  }

  async function requestBackgroundLocation() {
    const background =
      PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION ??
      "android.permission.ACCESS_BACKGROUND_LOCATION";
    await new Promise<void>((resolve) => {
      Alert.alert(
        "Allow location all the time",
        "Android hides SSID and RSSI when the screen is off unless this app has background location. Choose Allow all the time on the next screen.",
        [
          { text: "Skip", style: "cancel", onPress: () => resolve() },
          {
            text: "Continue",
            onPress: () => {
              void PermissionsAndroid.request(background)
                .catch(() => null)
                .finally(() => resolve());
            },
          },
        ]
      );
    });
  }

  async function ensureUnrestrictedBattery(): Promise<boolean> {
    if (Platform.OS !== "android" || isIgnoringBatteryOptimizations()) {
      return true;
    }
    return await new Promise((resolve) => {
      Alert.alert(
        "Unrestricted battery required",
        "Lock-screen IMU and Wi-Fi will stop unless this app is exempt from battery optimization. Recording will not start until you allow it.",
        [
          { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
          {
            text: "Allow",
            onPress: () => {
              void requestIgnoreBatteryOptimizations().finally(() => {
                resolve(isIgnoringBatteryOptimizations());
              });
            },
          },
        ]
      );
    });
  }

  async function sample() {
    try {
      const current = await getConnectedWifi();
      setWifi(current);

      if (current.connectionState !== "CONNECTED" || !current.ssid) {
        return;
      }

      if (network && current.ssid !== network) {
        setPaused(true);
        setNotice(
          `WARNING: Connected Wi-Fi changed. Previous: ${network}. Current: ${current.ssid}. Wi-Fi sampling paused; IMU recording continues.`
        );
        return;
      }

      const processed = processWifiSignal(current, isMoving);
      setLastProcessed(processed);

      const item = createMeasurement(floor, current, processed);
      const key = `${item.timestamp.slice(0, 19)}-${item.ssid}-${item.floor}`;

      if (key === lastSampleKey.current) {
        return;
      }

      lastSampleKey.current = key;
      await persistWifiMeasurement(item);
      setItems((old) => [...old, item]);
    } catch {
      setNotice(
        "A Wi-Fi reading failed. IMU recording continues; Wi-Fi will retry at the next interval."
      );
    }
  }

  async function start() {
    try {
      if (!(await requestPermission())) {
        return;
      }
      if (!(await ensureUnrestrictedBattery())) {
        setNotice(
          "Recording did not start. Allow unrestricted battery, then tap Start Recording again."
        );
        return;
      }

      const current = await getConnectedWifi();
      setWifi(current);

      const now = Date.now();
      const availability = await probeSensorAvailability();
      const newSessionId = await nextSessionId();
      await insertRecordingSession({
        id: newSessionId,
        startedAt: formatIsoMillis(now),
        endedAt: null,
        accelerometerAvailable: availability.accelerometerAvailable,
        gyroscopeAvailable: availability.gyroscopeAvailable,
        barometerAvailable: availability.barometerAvailable,
        platform: DEVICE_META.platform,
        deviceModel: DEVICE_META.deviceModel,
        osVersion: DEVICE_META.osVersion,
        notes: PLATFORM_SENSOR_NOTES,
      });

      setCachedSessionId(newSessionId);
      setCachedFloor(floor);
      setCachedActivity(activity);
      setCachedRecording(true);
      setSessionId(newSessionId);
      setStarted(now);
      setSeconds(0);
      setPaused(false);
      setRecording(true);

      await AsyncStorage.setItem(KEY_STARTED, String(now));
      if (current.connectionState === "CONNECTED" && current.ssid) {
        setCachedLockedSsid(current.ssid);
        setNetwork(current.ssid);
      } else {
        setCachedLockedSsid(null);
        setNetwork(null);
      }

      await startImuCollector(DEVICE_META);
      setNativeCapture(isUsingNativeImu());

      let backgroundNotice: string | null = null;
      if (Platform.OS === "android") {
        // Tear down any leftover location FGS from older builds. Starting it
        // next to the IMU service recreates the Activity until recording is aborted.
        await stopBackgroundLoggingAsync().catch(() => {});
      } else {
        try {
          const bgOk = await startBackgroundLoggingAsync(floor);
          if (!bgOk) {
            backgroundNotice =
              "Background keep-alive could not start. Recording still runs while this screen stays open.";
          }
        } catch (e) {
          console.warn("Could not start background task:", e);
        }
      }

      if (Platform.OS === "android" && isUsingNativeImu()) {
        backgroundNotice = [
          backgroundNotice,
          "Keep the IMU notification visible and lock Ascent in Recents.",
        ]
          .filter(Boolean)
          .join(" ");
      }

      if (!availability.barometerAvailable) {
        backgroundNotice = [backgroundNotice, "No barometer on this device. Pressure rows will not be written."]
          .filter(Boolean)
          .join(" ");
      }

      if (current.connectionState !== "CONNECTED" || !current.ssid) {
        backgroundNotice = [
          backgroundNotice,
          "No Wi-Fi connection. Recording IMU/barometer only; Wi-Fi rows will appear if you connect later.",
        ]
          .filter(Boolean)
          .join(" ");
      }

      setNotice(backgroundNotice);

      if (!isUsingNativeImu() && current.connectionState === "CONNECTED" && current.ssid) {
        await sample();
      }
    } catch (e) {
      console.warn("Could not start recording:", e);
      setNotice("Recording could not start. Try again.");
    }
  }

  async function stop() {
    setRecording(false);
    setPaused(false);
    setCachedRecording(false);
    setNativeCapture(false);
    await stopImuCollector();
    await AsyncStorage.removeItem(KEY_STARTED);
    setCachedLockedSsid(null);
    setNetwork(null);
    try {
      await stopBackgroundLoggingAsync();
    } catch (e) {
      console.warn("Could not stop background task:", e);
    }
    await flushWriteBuffer();
    await flushRawWriteBuffer();
    if (sessionId) {
      await endRecordingSession(sessionId, formatIsoMillis(Date.now()));
    }
    setCachedSessionId(null);
    setSessionId(null);
    const count = await getRawObservationCount().catch(() => rawCount);
    setRawCount(count);
    setNotice("Recording stopped. Your dataset remains stored on this device.");
  }

  async function resume() {
    const current = await getConnectedWifi();

    if (network && current.ssid !== network) {
      setNotice("Reconnect to the original Wi-Fi before resuming Wi-Fi sampling.");
      return;
    }

    setPaused(false);
    setNotice(null);
    await sample();
  }

  function clear() {
    Alert.alert(
      "Clear dataset?",
      `This permanently removes ${rawCount} raw observations and ${items.length} Wi-Fi measurements.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: () => {
            void clearMeasurements();
            setItems([]);
            setRawCount(0);
          },
        },
      ]
    );
  }

  return {
    activity,
    availability: rawCollector.availability,
    clear,
    exportDataset,
    floor,
    isMoving,
    items,
    lastProcessed,
    latestRaw: rawCollector.latest,
    motionState,
    notice,
    paused,
    rawCount,
    recording,
    resume,
    sampleIntervalMs,
    seconds,
    sessionId,
    setActivity,
    setFloor,
    setNotice,
    start,
    stop,
    wifi,
  };
}
