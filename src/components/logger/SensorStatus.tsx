import { InfoRow } from "../InfoRow";
import { Section } from "../Section";
import type { WifiLogger } from "../../hooks/useWifiLogger";

export function SensorStatus({ logger }: { logger: WifiLogger }) {
  const a = logger.availability;
  return (
    <Section title="SENSOR AVAILABILITY">
      <InfoRow label="Accelerometer" value={a.accelerometerAvailable ? "available" : "unavailable"} />
      <InfoRow label="Gyroscope" value={a.gyroscopeAvailable ? "available" : "unavailable"} />
      <InfoRow label="Barometer" value={a.barometerAvailable ? "available" : "unavailable"} />
      <InfoRow label="Last accel row" value={logger.latestRaw.accelerometer} />
      <InfoRow label="Last gyro row" value={logger.latestRaw.gyroscope} />
      <InfoRow label="Last pressure row" value={logger.latestRaw.barometer} />
      <InfoRow label="Last Wi-Fi row" value={logger.latestRaw.wifi} />
      <InfoRow label="Wi-Fi samples" value={logger.wifiCount} />
    </Section>
  );
}
