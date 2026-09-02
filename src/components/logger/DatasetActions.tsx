import { Pressable, Text, View } from "react-native";
import { styles } from "../../styles/appStyles";
import type { WifiLogger } from "../../hooks/useWifiLogger";

export function DatasetActions({ logger }: { logger: WifiLogger }) {
  const disabled = (logger.rawCount === 0 && logger.wifiCount === 0) || logger.recording;

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
