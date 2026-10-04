import { ActivityIndicator, View } from "react-native";
import { Redirect, Tabs } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { usePulse } from "../../session/SessionProvider";
import { colors } from "../../theme";
import type { IconName } from "../../ui";

const TABS: Array<{ name: string; title: string; icon: IconName; iconActive: IconName }> = [
  { name: "index", title: "Home", icon: "home-outline", iconActive: "home" },
  { name: "projects", title: "Projects", icon: "folder-outline", iconActive: "folder" },
  { name: "control", title: "Control", icon: "desktop-outline", iconActive: "desktop" },
  { name: "echo", title: "Echo", icon: "sparkles-outline", iconActive: "sparkles" },
  { name: "more", title: "More", icon: "ellipsis-horizontal-circle-outline", iconActive: "ellipsis-horizontal-circle" },
];

export default function TabsLayout() {
  const { paired } = usePulse();

  // Lendo o Keychain na abertura.
  if (paired === undefined) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: "center" }}>
        <ActivityIndicator color={colors.blue} />
      </View>
    );
  }
  if (paired === null) return <Redirect href="/pair" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.blueSoft,
        tabBarInactiveTintColor: colors.faint,
        tabBarStyle: { backgroundColor: colors.bg, borderTopColor: colors.border },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      {TABS.map((t) => (
        <Tabs.Screen
          key={t.name}
          name={t.name}
          options={{
            title: t.title,
            tabBarIcon: ({ color, focused, size }) => (
              <Ionicons name={focused ? t.iconActive : t.icon} size={size} color={color} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
