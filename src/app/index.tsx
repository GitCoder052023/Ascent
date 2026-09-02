import { ScrollView, Text } from "react-native";
import { useWifiLogger } from "../hooks/useWifiLogger";
import { styles } from "../styles/appStyles";
import { ActivityPicker, FloorPicker } from "../components/logger/LabelPickers";
import { ConnectionSection } from "../components/logger/ConnectionSection";
import { DatasetActions } from "../components/logger/DatasetActions";
import { Hero, NoticeBanner, RecorderStatus } from "../components/logger/HeroStatus";
import { LatestMeasurement } from "../components/logger/LatestMeasurement";
import { RecordButtons, RecordingMetrics } from "../components/logger/RecordingPanel";
import { SensorStatus } from "../components/logger/SensorStatus";

export default function Index() {
  const logger = useWifiLogger();
  const latest = logger.items.at(-1);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Hero />
      <RecorderStatus logger={logger} />
      <NoticeBanner logger={logger} />
      <FloorPicker logger={logger} />
      <ActivityPicker logger={logger} />
      <RecordingMetrics logger={logger} />
      <RecordButtons logger={logger} />
      <SensorStatus logger={logger} />
      <ConnectionSection logger={logger} />
      <LatestMeasurement latest={latest} />
      <DatasetActions logger={logger} />
      <Text style={styles.footnote}>
        Raw rows are independent sensor events (accel / gyro / barometer / Wi‑Fi) with millisecond arrival timestamps and the active manual labels. On Android, IMU plus connected Wi-Fi (SSID, BSSID, RSSI dBm, frequency) are written every 2s in foreground, background, and on the lock screen. Each row includes appState, lockScreen, and screenOn. Keep the IMU recording notification visible, allow unrestricted battery and location all the time, and lock the app in Recents on aggressive OEMs. Gaps are still possible if Android kills the process. No fusion, filtering, or auto-labeling is applied to this dataset.
      </Text>
    </ScrollView>
  );
}
