import { Text, View } from "react-native";
import { styles } from "../styles/appStyles";

export function Metric({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, accent && styles.accent]}>{value}</Text>
    </View>
  );
}
