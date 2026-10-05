// Segurança deste iPhone no PC. A política fica no Core: daqui só dá para
// apertá-la livremente; afrouxar Face ID pede Face ID; Lockdown só desliga no PC.

import { useState } from "react";
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import type { SecurityPolicy } from "@pulse/protocol";
import { usePulse } from "../session/SessionProvider";
import { requireFaceId } from "../security/SecurityGate";
import { performAction } from "../control/performAction";
import { Button, Card, SectionTitle } from "../ui";
import { colors } from "../theme";

const FACE_ID: Array<{ key: keyof SecurityPolicy; label: string }> = [
  { key: "requireFaceIdTerminal", label: "Terminal" },
  { key: "requireFaceIdPower", label: "Ações de energia" },
  { key: "requireFaceIdFileDeletion", label: "Excluir arquivos" },
  { key: "requireFaceIdEchoCritical", label: "Ações críticas do Echo" },
];

export default function Settings() {
  const { client, policy } = usePulse();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async (key: keyof SecurityPolicy, value: boolean) => {
    if (!client || !policy) return;
    setError(null);
    let faceIdVerified = false;
    if (!value) {
      faceIdVerified = await requireFaceId("securitySettings", "Diminuir uma proteção do Pulse");
      if (!faceIdVerified) return;
    }
    setBusy(true);
    try {
      // A política nova chega pelo stream; não é preciso guardar a resposta.
      await client.setSecurity({ policy: { ...policy, [key]: value }, faceIdVerified });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const enableLockdown = () => {
    if (!client) return;
    Alert.alert(
      "Ativar o Lockdown Mode?",
      "Este e todos os iPhones ficam somente leitura. Só é possível desativar no Pulse Desktop, no PC.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Ativar",
          style: "destructive",
          onPress: async () => {
            setBusy(true);
            const out = await performAction(client, { action: "lockdownEnable" });
            setBusy(false);
            if (out.kind === "error") setError(out.message);
          },
        },
      ],
    );
  };

  if (!policy) {
    return (
      <View style={s.screen}>
        <Text style={s.dim}>Conecte ao PC para ver as configurações.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <SectionTitle>Lockdown Mode</SectionTitle>
      <Card>
        <Text style={s.body}>
          {policy.lockdown
            ? "Ativo: o iPhone está em modo somente leitura. Desative no Pulse Desktop."
            : "Use se perder o iPhone ou suspeitar de acesso indevido: bloqueia ações, terminal e Echo. O monitoramento continua."}
        </Text>
        {!policy.lockdown && (
          <Button label="Ativar Lockdown" variant="danger" icon="shield-half-outline" busy={busy} onPress={enableLockdown} />
        )}
      </Card>

      <SectionTitle>Exigir Face ID para</SectionTitle>
      <Card style={s.list}>
        {FACE_ID.map((f, i) => (
          <View key={f.key} style={[s.row, i > 0 && s.border]}>
            <Text style={s.body}>{f.label}</Text>
            <Switch
              value={policy[f.key] as boolean}
              disabled={busy}
              onValueChange={(v) => void toggle(f.key, v)}
              trackColor={{ true: colors.blue }}
              accessibilityLabel={`Exigir Face ID para ${f.label}`}
            />
          </View>
        ))}
      </Card>
      <Text style={s.dim}>Desligar uma exigência pede Face ID. Ações críticas sempre exigem Face ID.</Text>
      {error && <Text style={s.error}>{error}</Text>}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: 16 },
  content: { gap: 12, paddingBottom: 32 },
  body: { color: colors.text, fontSize: 15, flexShrink: 1 },
  dim: { color: colors.dim, fontSize: 13 },
  error: { color: colors.red, fontSize: 14 },
  list: { paddingVertical: 4 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingVertical: 10 },
  border: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
});
