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
import {
  hydrateLabelsFromStorage,
  setCachedActivity,
  setCachedFloor,
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
  ensureImuCollectorAlive,
  isImuCollectorRunning,
  startImuCollector,
  stopImuCollector,
} from "../lib/imuCollector";

const KEY_STARTED = "@wifi_logger_started";
const KEY_NETWORK = "@wifi_logger_network";

const DEVICE_META = {
  platform: Platform.OS,
  deviceModel: Device.modelName ?? null,
  osVersion: Platform.Version?.toString() ?? null,
};

export function useWifiLogger() {
  const [floor, setFloorState] = useState<Floor>("FLOOR_1");
  const [activity, setActivityState] = useState<ActivityLabel | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [wifi, setWifi] = useState<WifiSnapshot>(EMPTY_WIFI);
  const [items, setItems] = useState<Measurement[]>([]);
  const [rawCount, setRawCount] = useState(0);
  const [recording, setRecording] = useState(false);
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
    enabled: appActive && !recording,
    ownUpdateInterval: !recording,
  });
  const interval = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSampleKey = useRef<string | null>(null);
  const rawCollector = useRawSensorCollector();

  function setFloor(next: Floor) {
    setFloorState(next);
    setCachedFloor(next);
    setBackgroundFloor(next);
  }

  function setActivity(next: ActivityLabel | null) {
    setActivityState(next);
    setCachedActivity(next);
  }

  useEffect(() => {
    setCachedMotionState(motionState);
  }, [motionState]);

  useEffect(() => {
    setBackgroundFloor(floor);
  }, [floor]);

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    void hydrateLabelsFromStorage().then((labels) => {
      setFloorState(labels.floor);
      setActivityState(labels.activity);
      if (labels.sessionId) {
        setSessionId(labels.sessionId);
      }
    });
    void loadMeasurements()
      .then(setItems)
      .catch(() => setNotice("Could not load the saved dataset."));
    void getRawObservationCount().then(setRawCount).catch(() => {});
    void refresh();
    void syncBackgroundStatus();

    const subscription = AppState.addEventListener("change", (state) => {
      const active = state === "active";
      setAppActive(active);
      void flushWriteBuffer();
      void flushRawWriteBuffer();
      if (active) {
        void refresh();
        void loadMeasurements().then(setItems);
        void getRawObservationCount().then(setRawCount);
        void syncBackgroundStatus();
        void ensureImuCollectorAlive();
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

  async function syncBackgroundStatus() {
    try {
      const active = await isBackgroundLoggingActiveAsync();
      if (active) {
        setRecording(true);
        setCachedRecording(true);
        const storedStarted = await AsyncStorage.getItem(KEY_STARTED);
        const storedNetwork = await AsyncStorage.getItem(KEY_NETWORK);
        if (storedStarted) {
          const parsed = parseInt(storedStarted, 10);
          if (!isNaN(parsed)) setStarted(parsed);
        } else {
          setStarted(Date.now());
        }
        if (storedNetwork) {
          setNetwork(storedNetwork);
        }
        if (!isImuCollectorRunning()) {
          void startImuCollector(DEVICE_META);
        }
      }
    } catch {
      // Ignore background sync errors
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

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    if (!recording || paused || !appActive) {
      return;
    }

    interval.current = setInterval(() => void sample(), sampleIntervalMs);

    return () => {
      if (interval.current) {
        clearInterval(interval.current);
      }
    };
  }, [recording, paused, floor, network, sampleIntervalMs, appActive]);
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
      const permissions = [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
      if (typeof Platform.Version === "number" && Platform.Version >= 33) {
        const postNotifications = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
        if (postNotifications) {
          permissions.push(postNotifications);
        }
      }

      const result = await PermissionsAndroid.requestMultiple(permissions);
      if (result[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] !== PermissionsAndroid.RESULTS.GRANTED) {
        setNotice(
          "Location permission is off. Wi-Fi fields may be empty; IMU recording can still continue."
        );
      }
    }
    await requestMotionPermissions();
    return true;
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
    if (!(await requestPermission())) {
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
      await AsyncStorage.setItem(KEY_NETWORK, current.ssid);
      setNetwork(current.ssid);
    } else {
      await AsyncStorage.removeItem(KEY_NETWORK);
      setNetwork(null);
    }

    await startImuCollector(DEVICE_META);

    let backgroundNotice: string | null = null;
    try {
      const bgOk = await startBackgroundLoggingAsync(floor);
      if (!bgOk) {
        backgroundNotice =
          "Background keep-alive could not start. Recording still runs while this screen stays open.";
      }
    } catch (e) {
      console.warn("Could not start background task:", e);
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

    if (current.connectionState === "CONNECTED" && current.ssid) {
      await sample();
    }
  }

  async function stop() {
    setRecording(false);
    setPaused(false);
    setCachedRecording(false);
    await stopImuCollector();
    await AsyncStorage.removeItem(KEY_STARTED);
    await AsyncStorage.removeItem(KEY_NETWORK);
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
