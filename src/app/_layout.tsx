import { Stack } from "expo-router";
import "../services/backgroundTask";

export default function RootLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}

