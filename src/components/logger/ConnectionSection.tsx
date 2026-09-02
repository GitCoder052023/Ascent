import { InfoRow } from "../InfoRow";
import { Section } from "../Section";
import type { WifiLogger } from "../../hooks/useWifiLogger";

export function ConnectionSection({ logger }: { logger: WifiLogger }) {
  return (
    <Section title="CURRENT CONNECTION">
      <InfoRow label="Connection" value={logger.wifi.connectionState} />
      <InfoRow label="SSID" value={logger.wifi.ssid} />
      <InfoRow label="BSSID" value={logger.wifi.bssid} />
      <InfoRow
        label="RSSI"
        value={
          logger.wifi.signalStrength === null
            ? null
            : `${logger.wifi.signalStrength} ${logger.wifi.signalStrengthUnit ?? "dBm"}`
        }
      />
      <InfoRow label="Signal unit" value={logger.wifi.signalStrengthUnit} />
      <InfoRow
        label="Frequency & Band"
        value={
          logger.wifi.frequency === null
            ? null
            : `${logger.wifi.frequency} MHz (${logger.lastProcessed.frequencyBand})`
        }
      />
      <InfoRow label="Normalized" value={logger.lastProcessed.normalizedScore} />
    </Section>
  );
}
