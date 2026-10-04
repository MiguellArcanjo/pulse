import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider } from "../session/SessionProvider";
import { colors } from "../theme";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.bg },
            headerTintColor: colors.text,
            headerShadowVisible: false,
            contentStyle: { backgroundColor: colors.bg },
            headerBackButtonDisplayMode: "minimal",
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="pair" options={{ headerShown: false, gestureEnabled: false }} />
          <Stack.Screen name="devices" options={{ title: "Dispositivos" }} />
          <Stack.Screen name="diagnostics" options={{ title: "Diagnóstico" }} />
        </Stack>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
