import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { DevicesResponse } from "@pulse/protocol";
import { usePulse } from "../session/SessionProvider";
import { Button, Card, Pill } from "../ui";
import { colors } from "../theme";
import { formatDateTime } from "../format";

const GRANTS: Record<string, string> = {
  READ: "Leitura",
  SAFE_ACTION: "Ações seguras",
  CONFIRM: "Ações com confirmação",
  CRITICAL: "Ações críticas",
};

export default function Devices() {
  const { client, unpair } = usePulse();
  const [data, setData] = useState<DevicesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [unpairing, setUnpairing] = useState(false);

  const load = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    try {
      setData(await client.devices());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const confirmUnpair = () => {
    Alert.alert(
      "Desparear este iPhone?",
      "O PC deixa de aceitar este iPhone. Para voltar, será preciso ler um QR novo no Pulse Desktop.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Desparear",
          style: "destructive",
          onPress: async () => {
            setUnpairing(true);
            await unpair();
            router.replace("/pair");
          },
        },
      ],
    );
  };

  const active = data?.devices.filter((d) => d.status === "active") ?? [];

  return (
    <ScrollView
      style={s.screen}
      contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor={colors.dim} />}
    >
      {error && (
        <Card>
          <Text style={s.error}>{error}</Text>
        </Card>
      )}
      {!data && !error && <ActivityIndicator color={colors.blue} />}

      {active.map((d) => {
        const me = d.id === data?.me;
        return (
          <Card key={d.id}>
            <View style={s.row}>
              <Ionicons name="phone-portrait-outline" size={22} color={colors.blueSoft} />
              <View style={{ flex: 1 }}>
                <Text style={s.name}>
                  {d.name}
                  {me ? <Text style={s.me}>  · este iPhone</Text> : null}
                </Text>
                <Text style={s.meta}>{d.model || "iPhone"}</Text>
              </View>
              <Pill label={d.online ? "Conectado" : "Offline"} tone={d.online ? "ok" : "dim"} />
            </View>
            <Text style={s.meta}>Pareado em {formatDateTime(d.pairedAtMs)}</Text>
            {!d.online && d.lastSeenMs && <Text style={s.meta}>Última conexão: {formatDateTime(d.lastSeenMs)}</Text>}
            <Text style={s.meta}>Permissões: {d.grants.map((g) => GRANTS[g] ?? g).join(", ")}</Text>
          </Card>
        );
      })}

      <Button label="Desparear este iPhone" variant="danger" icon="log-out-outline" busy={unpairing} onPress={confirmUnpair} />
      <Text style={s.footnote}>Outros dispositivos só podem ser revogados pelo Pulse Desktop.</Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  name: { color: colors.text, fontSize: 17, fontWeight: "600" },
  me: { color: colors.blueSoft, fontSize: 14, fontWeight: "400" },
  meta: { color: colors.dim, fontSize: 13 },
  error: { color: colors.red },
  footnote: { color: colors.faint, fontSize: 12, textAlign: "center" },
});
