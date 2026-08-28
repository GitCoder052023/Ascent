import { useEffect, useRef, useState } from "react";
import {
  Alert,
  AppState,
  PermissionsAndroid,
  Platform,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  clearMeasurements,
  createMeasurement,
  exportDataset,
  loadMeasurements,
  saveMeasurements,
  type Floor,
  type Measurement,
} from "../lib/dataset";
import { getConnectedWifi, type WifiSnapshot } from "../lib/wifi";
import { EMPTY_WIFI } from "../constants/app";
import { globalSignalEngine } from "../lib/signalEngine";
import { useMotionDetector } from "./useMotionDetector";
import {
  startBackgroundLoggingAsync,
  stopBackgroundLoggingAsync,
  setBackgroundFloor,
  isBackgroundLoggingActiveAsync,
} from "../services/backgroundTask";

const KEY_STARTED = "@wifi_logger_started";
const KEY_NETWORK = "@wifi_logger_network";

export function useWifiLogger() {
  const [floor, setFloor] = useState<Floor>("FLOOR_1");
  const [wifi, setWifi] = useState<WifiSnapshot>(EMPTY_WIFI);
  const [items, setItems] = useState<Measurement[]>([]);
  const [recording, setRecording] = useState(false);
  const [started, setStarted] = useState<number | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [paused, setPaused] = useState(false);
  const [network, setNetwork] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastProcessed, setLastProcessed] = useState<{
    normalizedScore: number | null;
    estimatedDbm: number | null;
    frequencyBand: string;
  }>({
    normalizedScore: null,
    estimatedDbm: null,
    frequencyBand: "UNKNOWN",
  });

  const { isMoving, motionState, sampleIntervalMs } = useMotionDetector();
  const interval = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSampleKey = useRef<string | null>(null);

  useEffect(() => {
    setBackgroundFloor(floor);
  }, [floor]);

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    void loadMeasurements()
      .then(setItems)
      .catch(() => setNotice("Could not load the saved dataset."));
    void refresh();
    void syncBackgroundStatus();

    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void refresh();
        void loadMeasurements().then(setItems);
        void syncBackgroundStatus();
      }
    });

    return () => subscription.remove();
  }, []);
  /* eslint-enable react-hooks/exhaustive-deps */

  async function syncBackgroundStatus() {
    try {
      const active = await isBackgroundLoggingActiveAsync();
      if (active) {
        setRecording(true);
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
    if (!recording || paused) {
      return;
    }

    interval.current = setInterval(() => void sample(), sampleIntervalMs);

    return () => {
      if (interval.current) {
        clearInterval(interval.current);
      }
    };
  }, [recording, paused, floor, network, sampleIntervalMs, isMoving]);
  /* eslint-enable react-hooks/exhaustive-deps */

  async function refresh() {
    try {
      const current = await getConnectedWifi();
      setWifi(current);

      const processed = globalSignalEngine.processSignal(
        current.signalStrength !== null ? current.signalStrength / 100 : null,
        current.frequency,
        isMoving
      );
      setLastProcessed(processed);
    } catch {
      setWifi(EMPTY_WIFI);
    }
  }

  async function requestPermission() {
    if (Platform.OS === "android") {
      const result = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        {
          title: "Wi-Fi connection access",
          message:
            "Android requires location access to read connected Wi-Fi details in foreground and background.",
          buttonPositive: "Allow",
          buttonNegative: "Not now",
        }
      );

      if (result !== PermissionsAndroid.RESULTS.GRANTED) {
        setNotice(
          "Wi-Fi details need Location permission. Enable it in Settings before recording."
        );
        return false;
      }
    }
    return true;
  }

  async function sample() {
    try {
      const current = await getConnectedWifi();
      setWifi(current);

      if (current.connectionState !== "CONNECTED" || !current.ssid) {
        setNotice(
          "Recording is waiting: connect to Wi-Fi to collect a measurement."
        );
        return;
      }

      if (network && current.ssid !== network) {
        setPaused(true);
        setNotice(
          `WARNING: Connected Wi-Fi changed. Previous: ${network}. Current: ${current.ssid}. Recording paused.`
        );
        return;
      }

      const processed = globalSignalEngine.processSignal(
        current.signalStrength !== null ? current.signalStrength / 100 : null,
        current.frequency,
        isMoving
      );
      setLastProcessed(processed);

      const item = createMeasurement(floor, current, processed);
      const key = `${item.timestamp.slice(0, 19)}-${item.ssid}-${item.floor}`;

      if (key === lastSampleKey.current) {
        return;
      }

      lastSampleKey.current = key;
      await saveMeasurements([item]);
      setItems((old) => [...old, item]);
    } catch {
      setNotice(
        "A Wi-Fi reading failed. Recording will retry at the next interval."
      );
    }
  }

  async function start() {
    if (!(await requestPermission())) {
      return;
    }

    const current = await getConnectedWifi();
    setWifi(current);

    if (current.connectionState !== "CONNECTED" || !current.ssid) {
      setNotice("Connect to the Wi-Fi network first, then start recording.");
      return;
    }

    const now = Date.now();
    setNetwork(current.ssid);
    setStarted(now);
    setSeconds(0);
    setPaused(false);
    setRecording(true);
    setNotice(null);

    await AsyncStorage.setItem(KEY_STARTED, String(now));
    await AsyncStorage.setItem(KEY_NETWORK, current.ssid);

    // Register background service
    try {
      const bgOk = await startBackgroundLoggingAsync(floor);
      if (!bgOk) {
        setNotice(
          "Background location permission ('Allow all the time') is required to log Wi-Fi in the background."
        );
      }
    } catch (e) {
      console.warn("Could not start background task:", e);
    }

    await sample();
  }

  async function stop() {
    setRecording(false);
    setPaused(false);
    await AsyncStorage.removeItem(KEY_STARTED);
    await AsyncStorage.removeItem(KEY_NETWORK);
    try {
      await stopBackgroundLoggingAsync();
    } catch (e) {
      console.warn("Could not stop background task:", e);
    }
    setNotice("Recording stopped. Your dataset remains stored on this device.");
  }

  async function resume() {
    const current = await getConnectedWifi();

    if (current.ssid !== network) {
      setNotice("Reconnect to the original Wi-Fi before resuming.");
      return;
    }

    setPaused(false);
    setNotice(null);
    await sample();
  }

  function clear() {
    Alert.alert(
      "Clear dataset?",
      `This permanently removes ${items.length} local measurements.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: () => {
            void clearMeasurements();
            setItems([]);
          },
        },
      ]
    );
  }

  return {
    clear,
    exportDataset,
    floor,
    isMoving,
    items,
    lastProcessed,
    motionState,
    notice,
    paused,
    recording,
    resume,
    sampleIntervalMs,
    seconds,
    setFloor,
    setNotice,
    start,
    stop,
    wifi,
  };
}

