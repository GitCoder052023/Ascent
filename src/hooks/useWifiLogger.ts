import { useEffect, useRef, useState } from "react";
import {
  Alert,
  AppState,
  PermissionsAndroid,
  Platform,
} from "react-native";
import {
  activateKeepAwakeAsync,
  deactivateKeepAwake,
} from "expo-keep-awake";
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
import { EMPTY_WIFI, SAMPLE_MS } from "../constants/app";

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
  const interval = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSample = useRef<string | null>(null);

  useEffect(() => {
    if (recording && !paused) {
      void activateKeepAwakeAsync("wifi-logger");

      return () => {
        void deactivateKeepAwake("wifi-logger");
      };
    }
  }, [recording, paused]);

  useEffect(() => {
    void loadMeasurements()
      .then(setItems)
      .catch(() => setNotice("Could not load the saved dataset."));
    void refresh();

    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void refresh();
      }
    });

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!recording || !started) {
      return;
    }

    const clock = setInterval(
      () => setSeconds(Math.floor((Date.now() - started) / 1000)),
      1000,
    );

    return () => clearInterval(clock);
  }, [recording, started]);

  // `sample` intentionally reads the current floor/network closure; these state values restart the timer when changed.
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    if (!recording || paused) {
      return;
    }

    interval.current = setInterval(() => void sample(), SAMPLE_MS);

    return () => {
      if (interval.current) {
        clearInterval(interval.current);
      }
    };
  }, [recording, paused, floor, network]);
  /* eslint-enable react-hooks/exhaustive-deps */

  async function refresh() {
    try {
      setWifi(await getConnectedWifi());
    } catch {
      setWifi(EMPTY_WIFI);
    }
  }

  async function requestPermission() {
    if (Platform.OS !== "android") {
      return true;
    }

    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      {
        title: "Wi-Fi connection access",
        message:
          "Android requires location access to show details of the Wi-Fi you are already connected to. This app never scans nearby networks.",
        buttonPositive: "Allow",
        buttonNegative: "Not now",
      },
    );

    if (result === PermissionsAndroid.RESULTS.GRANTED) {
      return true;
    }

    setNotice(
      "Wi-Fi details need Android location access. Enable it in Settings before recording.",
    );
    return false;
  }

  async function sample() {
    try {
      const current = await getConnectedWifi();
      setWifi(current);

      if (current.connectionState !== "CONNECTED" || !current.ssid) {
        setNotice(
          "Recording is waiting: connect to Wi-Fi to collect a measurement.",
        );
        return;
      }

      if (network && current.ssid !== network) {
        setPaused(true);
        setNotice(
          `WARNING: Connected Wi-Fi changed. Previous: ${network}. Current: ${current.ssid}. Recording paused.`,
        );
        return;
      }

      const item = createMeasurement(floor, current);
      const key = `${item.timestamp.slice(0, 19)}-${item.ssid}-${item.floor}`;

      if (key === lastSample.current) {
        return;
      }

      lastSample.current = key;
      setItems((old) => {
        const next = [...old, item];
        void saveMeasurements(next);
        return next;
      });
    } catch {
      setNotice(
        "A Wi-Fi reading failed. Recording will retry at the next interval.",
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
      setNotice("Connect to the gym Wi-Fi first, then start recording.");
      return;
    }

    setNetwork(current.ssid);
    setStarted(Date.now());
    setSeconds(0);
    setPaused(false);
    setRecording(true);
    setNotice(null);
    await sample();
  }

  function stop() {
    setRecording(false);
    setPaused(false);
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
      ],
    );
  }

  return {
    clear,
    exportDataset,
    floor,
    items,
    notice,
    paused,
    recording,
    resume,
    seconds,
    setFloor,
    setNotice,
    start,
    stop,
    wifi,
  };
}
