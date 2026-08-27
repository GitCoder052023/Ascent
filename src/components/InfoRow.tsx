import { Text, View } from "react-native";
import { formatUnavailable } from "../utils/format";
import { styles } from "../styles/appStyles";

export function InfoRow({
  label,
  value,
}: {
  label: string;
  value: string | number | null;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{formatUnavailable(value)}</Text>
    </View>
  );
}
