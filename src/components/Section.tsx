import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { styles } from "../styles/appStyles";

export function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <>
      <Text style={styles.section}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </>
  );
}
