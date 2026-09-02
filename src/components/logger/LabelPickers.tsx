import { Pressable, Text, View } from "react-native";
import type { Floor } from "../../lib/dataset";
import { ACTIVITY_OPTIONS, FLOOR_OPTIONS } from "../../lib/rawTypes";
import { styles } from "../../styles/appStyles";
import type { WifiLogger } from "../../hooks/useWifiLogger";

const FLOOR_SUB: Record<Floor, string> = {
  FLOOR_1: "Strength area",
  FLOOR_2: "Cardio area",
};

export function FloorPicker({ logger }: { logger: WifiLogger }) {
  return (
    <>
      <Text style={styles.label}>CURRENT FLOOR LABEL</Text>
      <View style={styles.floorRow}>
        {FLOOR_OPTIONS.map((item) => (
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
              {item.replaceAll("_", " ")}
            </Text>
            <Text
              style={[
                styles.floorSub,
                logger.floor === item && styles.floorTextActive,
              ]}
            >
              {FLOOR_SUB[item]}
            </Text>
          </Pressable>
        ))}
      </View>
    </>
  );
}

export function ActivityPicker({ logger }: { logger: WifiLogger }) {
  return (
    <>
      <Text style={styles.label}>MANUAL ACTIVITY LABEL</Text>
      <View style={styles.floorRow}>
        {ACTIVITY_OPTIONS.map((item) => {
          const active = logger.activity === item;
          return (
            <Pressable
              key={item}
              onPress={() => logger.setActivity(active ? null : item)}
              style={[styles.floor, active && styles.activityActive]}
            >
              <Text style={[styles.floorText, active && styles.activityTextActive]}>
                {item.replaceAll("_", " ")}
              </Text>
              <Text style={[styles.floorSub, active && styles.activityTextActive]}>
                {active ? "Tap to clear" : "Tap to set"}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </>
  );
}
