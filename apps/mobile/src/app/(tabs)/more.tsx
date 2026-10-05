import { StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Constants from "expo-constants";
import { usePulse } from "../../session/SessionProvider";
import { ListRow, Screen, SectionTitle } from "../../ui";
import { colors } from "../../theme";

export default function More() {
  const { paired } = usePulse();
  return (
    <Screen title="More">
      <View style={s.group}>
        <ListRow icon="phone-portrait-outline" label="Dispositivos" detail="Acesso deste iPhone ao PC" onPress={() => router.push("/devices")} />
        <ListRow icon="settings-outline" label="Settings" detail="Face ID por ação, Lockdown Mode" onPress={() => router.push("/settings")} />
        <ListRow icon="pulse-outline" label="Diagnóstico" detail="Face ID, Keychain, assinatura, conexão" onPress={() => router.push("/diagnostics")} />
      </View>

      <SectionTitle>Em breve</SectionTitle>
      <View style={s.group}>
        <ListRow icon="globe-outline" label="Browser" badge="M5" />
        <ListRow icon="flash-outline" label="Trigger" badge="M6" />
        <ListRow icon="folder-open-outline" label="Files" badge="M7" />
        <ListRow icon="terminal-outline" label="Terminal" badge="M8" />
        <ListRow icon="code-slash-outline" label="Claude Code" badge="M8" />
      </View>

      <Text style={s.footer}>
        Pulse Mobile {Constants.expoConfig?.version ?? "?"}
        {__DEV__ ? " · dev client" : ""}
        {paired ? `\n${paired.coreUrl}` : ""}
      </Text>
    </Screen>
  );
}

const s = StyleSheet.create({
  group: { borderRadius: 14, overflow: "hidden", gap: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  footer: { color: colors.faint, fontSize: 12, textAlign: "center", marginTop: 12 },
});
