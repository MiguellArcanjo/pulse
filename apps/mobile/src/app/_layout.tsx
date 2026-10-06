import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { MorphProvider } from "../data/MorphProvider";
import { ThemeProvider, useTheme } from "../design/theme";

function Navigator() {
  const { colors, scheme } = useTheme();
  return (
    <>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
    </>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <MorphProvider>
        <Navigator />
      </MorphProvider>
    </ThemeProvider>
  );
}
