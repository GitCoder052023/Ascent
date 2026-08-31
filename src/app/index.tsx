import { Pressable, ScrollView, Text, View } from "react-native";
import { InfoRow } from "../components/InfoRow";
import { Metric } from "../components/Metric";
import { Section } from "../components/Section";
import { useWifiLogger } from "../hooks/useWifiLogger";
import type { Floor } from "../lib/dataset";
import { ACTIVITY_OPTIONS, FLOOR_OPTIONS } from "../lib/rawTypes";
import { formatDuration } from "../utils/format";
import { styles } from "../styles/appStyles";

const FLOOR_SUB: Record<Floor, string> = {
  GROUND_FLOOR: "Ground",
  FLOOR_1: "Strength area",
  FLOOR_2: "Cardio area",
};

export default function Index() {
  const logger = useWifiLogger();
  const latest = logger.items.at(-1);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>GYM EXPERIMENT</Text>
        <Text style={styles.title}>Ascent</Text>
        <Text style={styles.sub}>Raw sensor dataset logger</Text>
      </View>

      <View style={styles.status}>
        <View
          style={[
            styles.dot,
            logger.recording ? styles.good : styles.muted,
          ]}
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.statusLabel}>RECORDER</Text>
          <Text style={styles.statusValue}>
            {logger.recording
              ? logger.paused
                ? "Wi-Fi paused · IMU on"
                : "Recording"
              : "Idle"}
          </Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={styles.rssi}>{logger.sessionId ?? "NO SESSION"}</Text>
          <Text style={{ fontSize: 11, color: "#78E3B4", fontWeight: "600" }}>
            {logger.activity ?? logger.floor}
          </Text>
        </View>
      </View>

      {logger.notice && (
        <Pressable
          onPress={() => logger.setNotice(null)}
          style={styles.notice}
        >
          <Text style={styles.noticeText}>{logger.notice}</Text>
          <Text style={styles.dismiss}>TAP TO DISMISS</Text>
        </Pressable>
      )}

      <Text style={styles.label}>CURRENT FLOOR LABEL</Text>
      <View style={styles.floorRow}>
        {FLOOR_OPTIONS.map((item) => (
          <Pressable
            key={item}
            onPress={() => logger.setFloor(item)}
            style={[styles.floor, logger.floor === item && styles.floorActive]}
          >
            <Text
              style={[
                styles.floorText,
                logger.floor === item && styles.floorTextActive,
              ]}
            >
              {item.replaceAll("_", " ")}
            </Text>
            <Text
              style={[
                styles.floorSub,
                logger.floor === item && styles.floorTextActive,
              ]}
            >
              {FLOOR_SUB[item]}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>MANUAL ACTIVITY LABEL</Text>
      <View style={styles.floorRow}>
        {ACTIVITY_OPTIONS.map((item) => {
          const active = logger.activity === item;
          return (
            <Pressable
              key={item}
              onPress={() => logger.setActivity(active ? null : item)}
              style={[styles.floor, active && styles.activityActive]}
            >
              <Text style={[styles.floorText, active && styles.activityTextActive]}>
                {item.replaceAll("_", " ")}
              </Text>
              <Text style={[styles.floorSub, active && styles.activityTextActive]}>
                {active ? "Tap to clear" : "Tap to set"}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.metrics}>
        <Metric
          label="RECORDING"
          value={logger.recording ? (logger.paused ? "PAUSED" : "● YES") : "NO"}
          accent={logger.recording && !logger.paused}
        />
        <Metric label="RAW ROWS" value={String(logger.rawCount)} />
        <Metric label="DURATION" value={formatDuration(logger.seconds)} />
      </View>

      <View style={styles.floorRow}>
        <View style={[styles.floor, { flex: 1, paddingVertical: 10 }]}>
          <Text style={{ fontSize: 10, color: "#8E8E93", fontWeight: "600" }}>
            MOTION STATE
          </Text>
          <Text style={{ fontSize: 14, fontWeight: "700", color: "#1C1C1E", marginTop: 2 }}>
            {logger.motionState}
          </Text>
        </View>
        <View style={[styles.floor, { flex: 1, paddingVertical: 10 }]}>
          <Text style={{ fontSize: 10, color: "#8E8E93", fontWeight: "600" }}>
            WIFI INTERVAL
          </Text>
          <Text style={{ fontSize: 14, fontWeight: "700", color: "#208AEF", marginTop: 2 }}>
            {Math.round(logger.sampleIntervalMs / 1000)}s
          </Text>
        </View>
      </View>

      <Pressable
        onPress={logger.recording ? logger.stop : () => void logger.start()}
        style={[styles.primary, logger.recording && styles.stop]}
      >
        <Text style={styles.primaryText}>
          {logger.recording ? "STOP RECORDING" : "START RECORDING"}
        </Text>
      </Pressable>
      {logger.paused && (
        <Pressable onPress={() => void logger.resume()} style={styles.secondary}>
          <Text style={styles.secondaryText}>RESUME WI‑FI SAMPLING</Text>
        </Pressable>
      )}

      <SensorStatus logger={logger} />
      <ConnectionSection logger={logger} />
      <LatestMeasurement latest={latest} />
      <DatasetActions logger={logger} />

      <Text style={styles.footnote}>
        Raw rows are independent sensor events (accel / gyro / barometer / Wi‑Fi) with millisecond arrival timestamps and the active manual labels. Keep the recording notifications visible. On Android, IMU is written by a native service independent of the JS runtime. Allow unrestricted battery when prompted, and lock the app in Recents on aggressive OEMs. Gaps are still possible if Android kills the process. No fusion, filtering, or auto-labeling is applied to this dataset.
      </Text>
    </ScrollView>
  );
}

function SensorStatus({ logger }: { logger: ReturnType<typeof useWifiLogger> }) {
  const a = logger.availability;
  return (
    <Section title="SENSOR AVAILABILITY">
      <InfoRow label="Accelerometer" value={a.accelerometerAvailable ? "available" : "unavailable"} />
      <InfoRow label="Gyroscope" value={a.gyroscopeAvailable ? "available" : "unavailable"} />
      <InfoRow label="Barometer" value={a.barometerAvailable ? "available" : "unavailable"} />
      <InfoRow label="Last accel row" value={logger.latestRaw.accelerometer} />
      <InfoRow label="Last gyro row" value={logger.latestRaw.gyroscope} />
      <InfoRow label="Last pressure row" value={logger.latestRaw.barometer} />
      <InfoRow label="Wi-Fi samples" value={logger.items.length} />
    </Section>
  );
}

function ConnectionSection({ logger }: { logger: ReturnType<typeof useWifiLogger> }) {
  const nativeAndroid = logger.lastProcessed.source === "android-native";
  return (
    <Section title="CURRENT CONNECTION & SIGNAL ENGINE">
      <InfoRow label="Connection" value={logger.wifi.connectionState} />
      <InfoRow label="SSID" value={logger.wifi.ssid} />
      <InfoRow label="BSSID" value={logger.wifi.bssid} />
      <InfoRow
        label={nativeAndroid ? "RSSI" : "RSSI"}
        value={logger.wifi.signalStrength === null ? null : `${logger.wifi.signalStrength} dBm`}
      />
      <InfoRow
        label="Frequency & Band"
        value={
          logger.wifi.frequency === null
            ? null
            : `${logger.wifi.frequency} MHz (${logger.lastProcessed.frequencyBand})`
        }
      />
      <InfoRow
        label={nativeAndroid ? "Normalized" : "Normalized"}
        value={logger.lastProcessed.normalizedScore}
      />
      {!nativeAndroid && (
        <InfoRow
          label="RSSI (estimated)"
          value={
            logger.lastProcessed.estimatedDbm === null
              ? null
              : `${logger.lastProcessed.estimatedDbm} dBm`
          }
        />
      )}
    </Section>
  );
}

function LatestMeasurement({ latest }: { latest: ReturnType<typeof useWifiLogger>["items"][number] | undefined }) {
  return (
    <Section title="LATEST WI‑FI MEASUREMENT">
      {latest ? (
        <>
          <InfoRow label="Time" value={new Date(latest.timestamp).toISOString()} />
          <InfoRow label="Floor" value={latest.floor.replaceAll("_", " ")} />
          <InfoRow label="SSID" value={latest.ssid} />
          <InfoRow
            label="Signal"
            value={
              latest.platform === "android"
                ? latest.signalStrength === null
                  ? null
                  : `${latest.signalStrength} dBm`
                : latest.signalStrengthEstimatedDbm !== null &&
                    latest.signalStrengthEstimatedDbm !== undefined
                  ? `${latest.signalStrengthEstimatedDbm} dBm (Est)`
                  : latest.signalStrength === null
                    ? null
                    : `${latest.signalStrength} dBm`
            }
          />
        </>
      ) : (
        <Text style={styles.empty}>No Wi-Fi measurements yet.</Text>
      )}
    </Section>
  );
}

function DatasetActions({ logger }: { logger: ReturnType<typeof useWifiLogger> }) {
  const disabled = logger.rawCount === 0 && !logger.items.length;

  return (
    <>
      <View style={styles.actions}>
        <Pressable
          disabled={disabled}
          onPress={() =>
            void logger.exportDataset(logger.items, "csv").catch((error: Error) =>
              logger.setNotice(error.message),
            )
          }
          style={[styles.action, disabled && styles.disabled]}
        >
          <Text style={styles.actionText}>EXPORT CSV</Text>
        </Pressable>
        <Pressable
          disabled={disabled}
          onPress={logger.clear}
          style={[styles.action, disabled && styles.disabled]}
        >
          <Text style={styles.actionText}>CLEAR DATA</Text>
        </Pressable>
      </View>
      <Pressable
        disabled={disabled}
        onPress={() =>
          void logger.exportDataset(logger.items, "json").catch((error: Error) =>
            logger.setNotice(error.message),
          )
        }
      >
        <Text style={[styles.json, disabled && styles.disabledText]}>
          Export JSON instead
        </Text>
      </Pressable>
    </>
  );
}
