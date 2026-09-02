import { Pressable, Text, View } from "react-native";
import { styles } from "../../styles/appStyles";
import type { WifiLogger } from "../../hooks/useWifiLogger";

export function Hero() {
  return (
    <View style={styles.hero}>
      <Text style={styles.eyebrow}>GYM EXPERIMENT</Text>
      <Text style={styles.title}>Ascent</Text>
      <Text style={styles.sub}>Raw sensor dataset logger</Text>
    </View>
  );
}

export function RecorderStatus({ logger }: { logger: WifiLogger }) {
  return (
    <View style={styles.status}>
      <View style={[styles.dot, logger.recording ? styles.good : styles.muted]} />
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
  );
}

export function NoticeBanner({ logger }: { logger: WifiLogger }) {
  if (!logger.notice) {
    return null;
  }
  return (
    <Pressable onPress={() => logger.setNotice(null)} style={styles.notice}>
      <Text style={styles.noticeText}>{logger.notice}</Text>
      <Text style={styles.dismiss}>TAP TO DISMISS</Text>
    </Pressable>
  );
}
