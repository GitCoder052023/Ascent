import { Pressable, Text, View } from "react-native";
import { Metric } from "../Metric";
import { formatDuration } from "../../utils/format";
import { styles } from "../../styles/appStyles";
import type { WifiLogger } from "../../hooks/useWifiLogger";

export function RecordingMetrics({ logger }: { logger: WifiLogger }) {
  return (
    <>
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
      <View style={styles.floorRow}>
        <View style={[styles.floor, { flex: 1, paddingVertical: 10 }]}>
          <Text style={{ fontSize: 10, color: "#8E8E93", fontWeight: "600" }}>
            APP STATE
          </Text>
          <Text style={{ fontSize: 14, fontWeight: "700", color: "#1C1C1E", marginTop: 2 }}>
            {logger.presence.appState}
          </Text>
        </View>
        <View style={[styles.floor, { flex: 1, paddingVertical: 10 }]}>
          <Text style={{ fontSize: 10, color: "#8E8E93", fontWeight: "600" }}>
            LOCK SCREEN
          </Text>
          <Text style={{ fontSize: 14, fontWeight: "700", color: "#1C1C1E", marginTop: 2 }}>
            {logger.presence.lockScreen}
            {logger.presence.screenOn === "NO" ? " · SCREEN OFF" : ""}
          </Text>
        </View>
      </View>
    </>
  );
}

export function RecordButtons({ logger }: { logger: WifiLogger }) {
  return (
    <>
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
    </>
  );
}
