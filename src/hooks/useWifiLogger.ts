import { useEffect, useRef, useState } from "react";
import { Alert, AppState, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
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
import { EMPTY_WIFI, WIFI_SAMPLE_INTERVAL_MS } from "../constants/app";
import { getDevicePresence, type DevicePresence } from "../lib/devicePresence";
import { useMotionDetector } from "./useMotionDetector";
import {
  stopBackgroundLoggingAsync,
  setBackgroundFloor,
  isBackgroundLoggingActiveAsync,
} from "../services/backgroundTask";
import {
  endRecordingSession,
  flushRawWriteBuffer,
  flushWriteBuffer,
  getRawObservationCount,
  getWifiMeasurementCount,
  insertRecordingSession,
  nextSessionId,
} from "../lib/db";
import { formatIsoMillis } from "../lib/rawObservation";
import {
  hydrateLabelsFromStorage,
  KEY_LOCKED_SSID,
  setCachedActivity,
  setCachedFloor,
  setCachedLockedSsid,
  setCachedMotionState,
  setCachedRecording,
  setCachedSessionId,
  setCachedWifi,
} from "../lib/recordingContext";
import { PLATFORM_SENSOR_NOTES, type ActivityLabel } from "../lib/rawTypes";
import { probeSensorAvailability, useRawSensorCollector } from "./useRawSensorCollector";
import {
  isImuCollectorRunning,
  isUsingNativeImu,
  startImuCollector,
  stopImuCollector,
  syncNativeRecordingLabels,
} from "../lib/imuCollector";
import {
  isNativeImuAvailable,
  isNativeImuRecording,
  subscribeNativeImuLatest,
} from "../../modules/recording-keepalive";
import { getDeviceMeta } from "../lib/deviceMeta";
import {
  ensureUnrestrictedBattery,
  requestRecordingPermissions,
} from "../permissions/recordingPermissions";
import { presenceFromNativeLatest, wifiFromNativeLatest } from "../capture/nativeLatest";

const KEY_STARTED = "@wifi_logger_started";
const DEVICE_META = getDeviceMeta();

function cacheWifiFields(current: WifiSnapshot) {
  setCachedWifi({
    ssid: current.ssid,
    bssid: current.bssid,
    signalStrength: current.signalStrength,
    signalStrengthUnit: current.signalStrengthUnit,
    frequency: current.frequency,
  });
}

export function useWifiLogger() {
  const [hydrated, setHydrated] = useState(false);
  const [floor, setFloorState] = useState<Floor>("FLOOR_1");
  const [activity, setActivityState] = useState<ActivityLabel | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [wifi, setWifi] = useState<WifiSnapshot>(EMPTY_WIFI);
  const [items, setItems] = useState<Measurement[]>([]);
  const [rawCount, setRawCount] = useState(0);
  const [wifiCount, setWifiCount] = useState(0);
  const [recording, setRecording] = useState(false);
  const [nativeCapture, setNativeCapture] = useState(false);
  const [started, setStarted] = useState<number | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [paused, setPaused] = useState(false);
  const [network, setNetwork] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [appActive, setAppActive] = useState(AppState.currentState === "active");
  const [presence, setPresence] = useState<DevicePresence>(getDevicePresence);
  const [lastProcessed, setLastProcessed] = useState<{
    normalizedScore: number | null;
    estimatedDbm: number | null;
    frequencyBand: string;
    source: "android-native";
  }>({
    normalizedScore: null,
    estimatedDbm: null,
    frequencyBand: "UNKNOWN",
    source: "android-native",
  });

  const { isMoving, motionState, sampleIntervalMs } = useMotionDetector({
    enabled: appActive && !recording && hydrated,
    ownUpdateInterval: !recording && hydrated,
  });
  const interval = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSampleKey = useRef<string | null>(null);
  const startingRef = useRef(false);
  const rawCollector = useRawSensorCollector();
  const jsWifiSampling = recording && !nativeCapture && !isNativeImuAvailable();

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
      void getWifiMeasurementCount().then(setWifiCount).catch(() => {});
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
        if (!isNativeImuRecording()) {
          void loadMeasurements().then(setItems).catch(() => {});
        }
        void getRawObservationCount().then(setRawCount);
        void getWifiMeasurementCount().then(setWifiCount);
        void restoreRecordingIfNeeded();
      }
    });

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const clock = setInterval(() => {
      void getRawObservationCount().then(setRawCount).catch(() => {});
      void getWifiMeasurementCount().then(setWifiCount).catch(() => {});
      setPresence(getDevicePresence());
    }, 1000);
    return () => clearInterval(clock);
  }, [recording]);

  async function restoreRecordingIfNeeded() {
    try {
      if (Platform.OS === "android") {
        if (await isBackgroundLoggingActiveAsync()) {
          await stopBackgroundLoggingAsync().catch(() => {});
        }
      }

      const storedStarted = await AsyncStorage.getItem(KEY_STARTED);
      const nativeOn = isNativeImuRecording();
      if (!storedStarted && !nativeOn) {
        return;
      }

      const storedNetwork = await AsyncStorage.getItem(KEY_LOCKED_SSID);
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
      if (!isImuCollectorRunning() && !isNativeImuRecording()) {
        return;
      }
      setRecording(true);
      setCachedRecording(true);
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
      const nextPresence = presenceFromNativeLatest(event);
      if (nextPresence) {
        setPresence(nextPresence);
      }
      const nextWifi = wifiFromNativeLatest(event);
      if (!nextWifi) {
        return;
      }
      setWifi(nextWifi.snapshot);
      cacheWifiFields(nextWifi.snapshot);
      setLastProcessed(nextWifi.processed);
      if (event.wifiSsidMismatch) {
        setPaused(true);
        setNotice(
          `WARNING: Connected Wi-Fi changed. Previous: ${network}. Current: ${event.wifiSsid}. IMU and Wi-Fi rows still record.`
        );
      }
    });
  }, [network]);

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    if (!jsWifiSampling) {
      return;
    }

    interval.current = setInterval(() => void sample(), WIFI_SAMPLE_INTERVAL_MS);

    return () => {
      if (interval.current) {
        clearInterval(interval.current);
      }
    };
  }, [jsWifiSampling, floor, network]);
  /* eslint-enable react-hooks/exhaustive-deps */

  async function refresh() {
    try {
      const current = await getConnectedWifi();
      setWifi(current);
      cacheWifiFields(current);
      setLastProcessed(processWifiSignal(current));
    } catch {
      setWifi(EMPTY_WIFI);
    }
  }

  async function sample() {
    if (isNativeImuAvailable() || nativeCapture) {
      return;
    }
    try {
      const current = await getConnectedWifi();
      setWifi(current);
      cacheWifiFields(current);

      if (network && current.ssid && current.ssid !== network) {
        setPaused(true);
        setNotice(
          `WARNING: Connected Wi-Fi changed. Previous: ${network}. Current: ${current.ssid}. IMU and Wi-Fi rows still record.`
        );
      }

      const processed = processWifiSignal(current);
      setLastProcessed(processed);

      const item = createMeasurement(floor, current, processed);
      const key = `${item.timestamp.slice(0, 19)}-${item.ssid}-${item.bssid}-${item.signalStrength}-${item.floor}`;

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

  async function abortFailedStart() {
    setRecording(false);
    setPaused(false);
    setCachedRecording(false);
    setNativeCapture(false);
    await stopImuCollector().catch(() => {});
    await AsyncStorage.removeItem(KEY_STARTED).catch(() => {});
    setCachedLockedSsid(null);
    setNetwork(null);
    setCachedSessionId(null);
    setSessionId(null);
    setStarted(null);
    setSeconds(0);
  }

  async function start() {
    if (recording || startingRef.current) {
      return;
    }
    startingRef.current = true;
    try {
      if (isNativeImuRecording() || isImuCollectorRunning()) {
        await stopImuCollector().catch(() => {});
      }
      if (!(await requestRecordingPermissions(setNotice))) {
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
      setRecording(true);

      let backgroundNotice: string | null = null;
      if (Platform.OS === "android") {
        await stopBackgroundLoggingAsync().catch(() => {});
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

      if (!isUsingNativeImu()) {
        await sample();
      }
    } catch (e) {
      console.warn("Could not start recording:", e);
      await abortFailedStart();
      setNotice("Recording could not start. Try again.");
    } finally {
      startingRef.current = false;
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
    try {
      const measurements = await loadMeasurements();
      setItems(measurements);
    } catch {
      // Keep the in-memory list if the reload fails.
    }
    const count = await getRawObservationCount().catch(() => rawCount);
    setRawCount(count);
    const wCount = await getWifiMeasurementCount().catch(() => items.length);
    setWifiCount(wCount);
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
    setWifi(current);
    cacheWifiFields(current);
    setLastProcessed(processWifiSignal(current));
    if (!isNativeImuAvailable() && !nativeCapture) {
      await sample();
    }
  }

  function clear() {
    Alert.alert(
      "Clear dataset?",
      `This permanently removes ${rawCount} raw observations and ${wifiCount || items.length} Wi-Fi measurements.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: () => {
            void clearMeasurements();
            setItems([]);
            setRawCount(0);
            setWifiCount(0);
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
    presence,
    rawCount,
    recording,
    resume,
    sampleIntervalMs: recording ? WIFI_SAMPLE_INTERVAL_MS : sampleIntervalMs,
    seconds,
    sessionId,
    setActivity,
    setFloor,
    setNotice,
    start,
    stop,
    wifi,
    wifiCount,
  };
}
