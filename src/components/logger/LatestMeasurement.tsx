import { Text } from "react-native";
import { InfoRow } from "../InfoRow";
import { Section } from "../Section";
import { styles } from "../../styles/appStyles";
import type { WifiLogger } from "../../hooks/useWifiLogger";

export function LatestMeasurement({
  latest,
}: {
  latest: WifiLogger["items"][number] | undefined;
}) {
  return (
    <Section title="LATEST WI‑FI MEASUREMENT">
      {latest ? (
        <>
          <InfoRow label="Time" value={new Date(latest.timestamp).toISOString()} />
          <InfoRow label="Floor" value={latest.floor.replaceAll("_", " ")} />
          <InfoRow label="SSID" value={latest.ssid} />
          <InfoRow label="BSSID" value={latest.bssid} />
          <InfoRow
            label="RSSI"
            value={
              latest.signalStrength === null
                ? null
                : `${latest.signalStrength} ${latest.signalStrengthUnit ?? "dBm"}`
            }
          />
          <InfoRow label="Signal unit" value={latest.signalStrengthUnit} />
          <InfoRow
            label="Frequency"
            value={latest.frequency === null ? null : `${latest.frequency} MHz`}
          />
          <InfoRow label="App state" value={latest.appState ?? null} />
          <InfoRow label="Lock screen" value={latest.lockScreen ?? null} />
        </>
      ) : (
        <Text style={styles.empty}>No Wi-Fi measurements yet.</Text>
      )}
    </Section>
  );
}
