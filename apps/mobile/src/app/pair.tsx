// "Add Computer": lê o QR do Pulse Desktop, prova que tem o segredo (HMAC),
// mostra o código de conferência e espera a aprovação no PC.
//
// Também abre por deep link (`pulse://pair?...`), quando o QR é lido pela
// câmera nativa do iPhone.

import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Crypto from "expo-crypto";
import * as Device from "expo-device";
import * as Haptics from "expo-haptics";
import Ionicons from "@expo/vector-icons/Ionicons";
import {
  claimPairing,
  claimProof,
  newNonce,
  pairingCode,
  pairingFromParams,
  parsePairingQr,
  pollPairing,
  pollProof,
  PulseApiError,
  PulseNetworkError,
} from "@pulse/client";
import type { PairingQr } from "@pulse/protocol";
import { usePulse } from "../session/SessionProvider";
import { Button, Card, Screen } from "../ui";
import { colors, radius } from "../theme";

const POLL_EVERY_MS = 1500;

type Phase =
  | { kind: "scan" }
  | { kind: "name"; qr: PairingQr }
  | { kind: "claiming"; qr: PairingQr }
  | { kind: "waiting"; qr: PairingQr; code: string }
  | { kind: "error"; message: string };

function defaultName(): string {
  // No iOS 16+ o nome real do aparelho exige entitlement; o modelo é o que temos.
  const model = Device.modelName ?? "iPhone";
  return Device.deviceName && Device.deviceName !== model ? Device.deviceName : model;
}

function describeError(e: unknown): string {
  if (e instanceof PulseNetworkError) {
    return `${e.message} Confira se o Tailscale está ligado no iPhone e no PC.`;
  }
  if (e instanceof PulseApiError) return e.message;
  return String(e);
}

export default function Pair() {
  const params = useLocalSearchParams<Record<string, string>>();
  const { completePairing, unpairedReason, paired } = usePulse();
  const [phase, setPhase] = useState<Phase>({ kind: "scan" });
  const [name, setName] = useState(defaultName);
  const nonceRef = useRef<string | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  // Já pareado (ex.: abriu um deep link antigo): vai para a Home.
  useEffect(() => {
    if (paired) router.replace("/");
  }, [paired]);

  // Deep link: os parâmetros do QR já vêm na rota.
  useEffect(() => {
    if (!params.p) return;
    const qr = pairingFromParams((k) => (typeof params[k] === "string" ? params[k] : undefined));
    setPhase(qr ? { kind: "name", qr } : { kind: "error", message: "Este link de pareamento é inválido." });
  }, [params]);

  const onScanned = useCallback((data: string) => {
    setPhase((p) => {
      if (p.kind !== "scan") return p;
      const qr = parsePairingQr(data);
      if (!qr) return p; // ignora QRs que não são do Pulse e continua lendo
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return { kind: "name", qr };
    });
  }, []);

  const start = async (qr: PairingQr) => {
    if (qr.expiresAtMs < Date.now()) {
      setPhase({ kind: "error", message: "Este QR expirou. Gere outro no Pulse Desktop." });
      return;
    }
    setPhase({ kind: "claiming", qr });
    const nonce = newNonce(Crypto.getRandomBytes);
    nonceRef.current = nonce;
    try {
      await claimPairing(qr.coreUrl, {
        pairingId: qr.pairingId,
        deviceNonce: nonce,
        proof: claimProof(qr, nonce),
        deviceName: name.trim() || defaultName(),
        deviceModel: Device.modelId ? String(Device.modelId) : (Device.modelName ?? ""),
      });
    } catch (e) {
      setPhase({ kind: "error", message: describeError(e) });
      return;
    }
    setPhase({ kind: "waiting", qr, code: pairingCode(qr, nonce) });
    void poll(qr, nonce);
  };

  const poll = async (qr: PairingQr, nonce: string) => {
    while (!cancelled.current) {
      await new Promise((r) => setTimeout(r, POLL_EVERY_MS));
      if (cancelled.current) return;
      try {
        const st = await pollPairing(qr.coreUrl, {
          pairingId: qr.pairingId,
          deviceNonce: nonce,
          proof: pollProof(qr, nonce),
        });
        if (st.status === "pending") continue;
        if (st.status === "approved") {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          await completePairing({ coreUrl: qr.coreUrl, deviceId: st.deviceId, tokens: st.tokens });
          router.replace("/");
          return;
        }
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setPhase({
          kind: "error",
          message: st.status === "denied" ? "O acesso foi recusado no PC." : "O pedido expirou. Gere um QR novo no PC.",
        });
        return;
      } catch (e) {
        // Oscilação de rede durante a espera não encerra o pareamento.
        if (e instanceof PulseNetworkError) continue;
        setPhase({ kind: "error", message: describeError(e) });
        return;
      }
    }
  };

  return (
    <Screen title="Adicionar PC" subtitle="Conecte este iPhone ao Pulse do seu computador.">
      {unpairedReason && phase.kind === "scan" && (
        <Card style={s.notice}>
          <Text style={s.noticeText}>{unpairedReason}</Text>
        </Card>
      )}

      {phase.kind === "scan" && <Scanner onScanned={onScanned} />}

      {phase.kind === "name" && (
        <Card>
          <Text style={s.label}>Nome deste iPhone no PC</Text>
          <TextInput
            style={s.input}
            value={name}
            onChangeText={setName}
            maxLength={64}
            autoCorrect={false}
            returnKeyType="done"
            accessibilityLabel="Nome deste iPhone"
          />
          <Text style={s.hint}>{phase.qr.coreUrl}</Text>
          <Button label="Pedir acesso" onPress={() => void start(phase.qr)} />
          <Button label="Ler outro QR" variant="secondary" onPress={() => setPhase({ kind: "scan" })} />
        </Card>
      )}

      {phase.kind === "claiming" && (
        <Card style={s.center}>
          <ActivityIndicator color={colors.blue} />
          <Text style={s.hint}>Falando com o PC…</Text>
        </Card>
      )}

      {phase.kind === "waiting" && (
        <Card style={s.center}>
          <Ionicons name="desktop-outline" size={36} color={colors.blueSoft} />
          <Text style={s.waitTitle}>Aprove no PC</Text>
          <Text style={s.hint}>O Pulse Desktop deve mostrar este mesmo código:</Text>
          <Text style={s.code} accessibilityLabel={`Código ${phase.code.split("").join(" ")}`}>
            {phase.code.slice(0, 3)} {phase.code.slice(3)}
          </Text>
          <Text style={s.hint}>Se for diferente, recuse no PC.</Text>
          <ActivityIndicator color={colors.blue} style={{ marginTop: 8 }} />
        </Card>
      )}

      {phase.kind === "error" && (
        <Card>
          <View style={s.errorRow}>
            <Ionicons name="alert-circle" size={20} color={colors.red} />
            <Text style={s.errorText}>{phase.message}</Text>
          </View>
          <Button label="Ler QR de novo" onPress={() => setPhase({ kind: "scan" })} />
        </Card>
      )}

      <Text style={s.footnote}>
        No PC: Pulse Desktop → Dispositivos → Adicionar dispositivo. iPhone e PC precisam estar no
        Tailscale.
      </Text>
    </Screen>
  );
}

function Scanner({ onScanned }: { onScanned: (data: string) => void }) {
  const [permission, requestPermission] = useCameraPermissions();

  if (!permission) return <ActivityIndicator color={colors.blue} />;
  if (!permission.granted) {
    return (
      <Card>
        <Text style={s.hint}>O Pulse usa a câmera só para ler o QR Code de pareamento.</Text>
        <Button label="Permitir câmera" onPress={() => void requestPermission()} />
      </Card>
    );
  }
  return (
    <View style={s.camera}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={({ data }) => onScanned(data)}
      />
      <View style={s.frame} pointerEvents="none" />
    </View>
  );
}

const s = StyleSheet.create({
  notice: { borderColor: colors.amberSoft, backgroundColor: colors.amberSoft },
  noticeText: { color: colors.amber, fontSize: 14 },
  camera: { height: 360, borderRadius: radius.card, overflow: "hidden", backgroundColor: "#000" },
  frame: {
    position: "absolute",
    top: "18%",
    left: "18%",
    right: "18%",
    bottom: "18%",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.7)",
    borderRadius: 16,
  },
  label: { color: colors.dim, fontSize: 13, fontWeight: "600" },
  input: {
    color: colors.text,
    backgroundColor: colors.bg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.control,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
  },
  hint: { color: colors.dim, fontSize: 14, textAlign: "center" },
  center: { alignItems: "center", paddingVertical: 24, gap: 10 },
  waitTitle: { color: colors.text, fontSize: 20, fontWeight: "700" },
  code: { color: colors.text, fontSize: 44, fontWeight: "700", letterSpacing: 4, fontVariant: ["tabular-nums"] },
  errorRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  errorText: { color: colors.text, fontSize: 15, flex: 1 },
  footnote: { color: colors.faint, fontSize: 13, textAlign: "center", marginTop: 8 },
});
