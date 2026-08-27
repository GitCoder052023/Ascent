import { Pressable, ScrollView, Text, View } from "react-native";
import { InfoRow } from "../components/InfoRow";
import { Metric } from "../components/Metric";
import { Section } from "../components/Section";
import { useWifiLogger } from "../hooks/useWifiLogger";
import type { Floor } from "../lib/dataset";
import { formatDuration, formatUnavailable } from "../utils/format";
import { styles } from "../styles/appStyles";

export default function Index() {
  const logger = useWifiLogger();
  const latest = logger.items.at(-1);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>GYM EXPERIMENT</Text>
        <Text style={styles.title}>Wi‑Fi Floor{"\n"}Data Logger</Text>
        <Text style={styles.sub}>
          Collect labeled readings from the Wi‑Fi you are already connected to.
        </Text>
      </View>

      <View style={styles.status}>
        <View
          style={[
            styles.dot,
            logger.wifi.connectionState === "CONNECTED"
              ? styles.good
              : styles.muted,
          ]}
        />
        <View>
          <Text style={styles.statusLabel}>CONNECTED WI‑FI</Text>
          <Text style={styles.statusValue}>
            {logger.wifi.connectionState === "CONNECTED"
              ? formatUnavailable(logger.wifi.ssid)
              : "Not connected"}
          </Text>
        </View>
        <Text style={styles.rssi}>
          {logger.wifi.signalStrength === null
            ? "—"
            : `${logger.wifi.signalStrength} dBm`}
        </Text>
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
        {(["FLOOR_1", "FLOOR_2"] as Floor[]).map((item) => (
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
              {item.replace("_", " ")}
            </Text>
            <Text
              style={[
                styles.floorSub,
                logger.floor === item && styles.floorTextActive,
              ]}
            >
              {item === "FLOOR_1" ? "Strength area" : "Cardio area"}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.metrics}>
        <Metric
          label="RECORDING"
          value={logger.recording ? (logger.paused ? "PAUSED" : "● YES") : "NO"}
          accent={logger.recording && !logger.paused}
        />
        <Metric label="MEASUREMENTS" value={String(logger.items.length)} />
        <Metric label="DURATION" value={formatDuration(logger.seconds)} />
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
          <Text style={styles.secondaryText}>RESUME ON ORIGINAL WI‑FI</Text>
        </Pressable>
      )}

      <ConnectionSection logger={logger} />
      <LatestMeasurement latest={latest} />
      <CapabilitiesSection />
      <DatasetActions logger={logger} />

      <Text style={styles.footnote}>
        Samples every 25 seconds while the app is open. Background collection is
        not guaranteed; keep the app in the foreground for a reliable session.
      </Text>
    </ScrollView>
  );
}

function ConnectionSection({ logger }: { logger: ReturnType<typeof useWifiLogger> }) {
  return (
    <Section title="CURRENT CONNECTION">
      <InfoRow label="Connection" value={logger.wifi.connectionState} />
      <InfoRow label="SSID" value={logger.wifi.ssid} />
      <InfoRow label="BSSID" value={logger.wifi.bssid} />
      <InfoRow
        label="Signal strength"
        value={logger.wifi.signalStrength === null ? null : `${logger.wifi.signalStrength} dBm`}
      />
      <InfoRow
        label="Frequency"
        value={logger.wifi.frequency === null ? null : `${logger.wifi.frequency} MHz`}
      />
    </Section>
  );
}

function LatestMeasurement({ latest }: { latest: ReturnType<typeof useWifiLogger>["items"][number] | undefined }) {
  return (
    <Section title="LATEST MEASUREMENT">
      {latest ? (
        <>
          <InfoRow label="Time" value={new Date(latest.timestamp).toLocaleTimeString()} />
          <InfoRow label="Floor" value={latest.floor.replace("_", " ")} />
          <InfoRow label="SSID" value={latest.ssid} />
          <InfoRow
            label="Signal"
            value={latest.signalStrength === null ? null : `${latest.signalStrength} dBm`}
          />
        </>
      ) : (
        <Text style={styles.empty}>No measurements yet.</Text>
      )}
    </Section>
  );
}

function CapabilitiesSection() {
  return (
    <Section title="PLATFORM CAPABILITIES">
      <Text style={styles.capTitle}>Android</Text>
      <Text style={styles.cap}>
        SSID, BSSID, signal strength & frequency — available with location
        permission.
      </Text>
      <Text style={styles.capTitle}>iOS</Text>
      <Text style={styles.cap}>
        SSID & BSSID — available only with Apple’s Wi‑Fi Information entitlement.
        Signal strength & frequency — not available.
      </Text>
    </Section>
  );
}

function DatasetActions({ logger }: { logger: ReturnType<typeof useWifiLogger> }) {
  const disabled = !logger.items.length;

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
