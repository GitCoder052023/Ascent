import { useEffect, useRef, useState } from "react";
import { Alert, AppState } from "react-native";
import {
  clearMeasurements,
  exportDataset,
  loadMeasurements,
  type Floor,
  type Measurement,
} from "../lib/dataset";
import { EMPTY_WIFI, WIFI_SAMPLE_INTERVAL_MS } from "../constants/app";
import { getDevicePresence, type DevicePresence } from "../lib/devicePresence";
import { useMotionDetector } from "./useMotionDetector";
import { setBackgroundFloor } from "../services/backgroundTask";
import {
  flushRawWriteBuffer,
  flushWriteBuffer,
  getRawObservationCount,
  getWifiMeasurementCount,
} from "../lib/db";
import {
  hydrateLabelsFromStorage,
  setCachedActivity,
  setCachedFloor,
  setCachedMotionState,
} from "../lib/recordingContext";
import type { ActivityLabel } from "../lib/rawTypes";
import { useRawSensorCollector } from "./useRawSensorCollector";
import { syncNativeRecordingLabels } from "../lib/imuCollector";
import {
  isNativeImuAvailable,
  isNativeImuRecording,
  subscribeNativeImuLatest,
} from "../../modules/recording-keepalive";
import { getDeviceMeta } from "../lib/deviceMeta";
import { presenceFromNativeLatest, wifiFromNativeLatest } from "../capture/nativeLatest";
import { getConnectedWifi, processWifiSignal } from "../lib/wifi";
import { cacheWifiFields } from "./wifiLogger/cacheWifi";
import { restoreRecordingIfNeeded } from "./wifiLogger/restoreRecording";
import { refreshWifi, sampleWifiJs } from "./wifiLogger/sampleWifi";
import { startRecordingSession, stopRecordingSession } from "./wifiLogger/sessionLifecycle";

const DEVICE_META = getDeviceMeta();

export function useWifiLogger() {
  const [hydrated, setHydrated] = useState(false);
  const [floor, setFloorState] = useState<Floor>("FLOOR_1");
  const [activity, setActivityState] = useState<ActivityLabel | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [wifi, setWifi] = useState(EMPTY_WIFI);
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
  const [lastProcessed, setLastProcessed] = useState({
    normalizedScore: null as number | null,
    estimatedDbm: null as number | null,
    frequencyBand: "UNKNOWN",
    source: "android-native" as const,
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
      void refreshWifi({ setWifi, setLastProcessed });
      await restoreRecordingIfNeeded(DEVICE_META, {
        setStarted,
        setNetwork,
        setRecording,
        setNativeCapture,
      });
      setHydrated(true);
    }

    void init();

    const subscription = AppState.addEventListener("change", (state) => {
      const active = state === "active";
      setAppActive(active);
      void flushWriteBuffer();
      void flushRawWriteBuffer();
      if (active) {
        void refreshWifi({ setWifi, setLastProcessed });
        if (!isNativeImuRecording()) {
          void loadMeasurements().then(setItems).catch(() => {});
        }
        void getRawObservationCount().then(setRawCount);
        void getWifiMeasurementCount().then(setWifiCount);
        void restoreRecordingIfNeeded(DEVICE_META, {
          setStarted,
          setNetwork,
          setRecording,
          setNativeCapture,
        });
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

  async function sample() {
    await sampleWifiJs({
      nativeCapture,
      floor,
      network,
      lastSampleKey,
      setWifi,
      setPaused,
      setNotice,
      setLastProcessed,
      setItems,
    });
  }

  async function start() {
    await startRecordingSession({
      recording,
      startingRef,
      floor,
      activity,
      deviceMeta: DEVICE_META,
      sample,
      setWifi,
      setSessionId,
      setStarted,
      setSeconds,
      setPaused,
      setNetwork,
      setNativeCapture,
      setRecording,
      setNotice,
    });
  }

  async function stop() {
    await stopRecordingSession({
      sessionId,
      rawCount,
      itemsLength: items.length,
      setWifi,
      setSessionId,
      setStarted,
      setSeconds,
      setPaused,
      setNetwork,
      setNativeCapture,
      setRecording,
      setNotice,
      setItems,
      setRawCount,
      setWifiCount,
    });
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

export type WifiLogger = ReturnType<typeof useWifiLogger>;
