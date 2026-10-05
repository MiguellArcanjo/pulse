import { useCallback, useState } from "react";
import { Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, Image } from "react-native";
import { useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { Action, ControlSnapshot, Level, Screenshot } from "@pulse/protocol";
import { usePulse } from "../../session/SessionProvider";
import { performAction } from "../../control/performAction";
import { Card, GRID_GAP, SCREEN_PADDING, SectionTitle, useGridItemWidth, type IconName } from "../../ui";
import { colors, radius } from "../../theme";
import { formatBytes, formatDuration, formatRate, gb } from "../../format";

const REFRESH_MS = 5000;

const POWER: Array<{ action: Action; label: string; icon: IconName; level: Level }> = [
  { action: { action: "lock" }, label: "Bloquear", icon: "lock-closed-outline", level: "SAFE_ACTION" },
  { action: { action: "suspend" }, label: "Suspender", icon: "moon-outline", level: "CONFIRM" },
  { action: { action: "restart" }, label: "Reiniciar", icon: "refresh-outline", level: "CONFIRM" },
  { action: { action: "shutdown" }, label: "Desligar", icon: "power-outline", level: "CONFIRM" },
  { action: { action: "screenshot" }, label: "Screenshot", icon: "camera-outline", level: "CONFIRM" },
];

export default function Control() {
  const insets = useSafeAreaInsets();
  const cell = useGridItemWidth(3);
  const { client, heartbeat, policy, connection } = usePulse();
  const [snap, setSnap] = useState<ControlSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [shot, setShot] = useState<Screenshot | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!client) return;
    try {
      setSnap(await client.control());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [client]);

  // Atualiza só enquanto a aba está na tela.
  useFocusEffect(
    useCallback(() => {
      void load();
      const t = setInterval(() => void load(), REFRESH_MS);
      return () => clearInterval(t);
    }, [load]),
  );

  const online = connection.kind === "online";
  const lockdown = policy?.lockdown ?? snap?.policy.lockdown ?? false;
  const can = (level: Level) => online && !lockdown && !!snap?.grants.includes(level);

  const run = async (key: string, action: Action) => {
    if (!client) return;
    setBusy(key);
    setMessage(null);
    const out = await performAction(client, action);
    setBusy(null);
    if (out.kind === "done") {
      if (out.result.screenshot) setShot(out.result.screenshot);
      setMessage({ ok: true, text: out.result.message });
      void load();
    } else if (out.kind === "error") {
      setMessage({ ok: false, text: out.message });
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={[s.content, { paddingTop: insets.top + 12 }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.dim}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
      >
        <Text style={s.title} accessibilityRole="header">
          Control
        </Text>

        {lockdown && (
          <Card style={s.lockdown}>
            <View style={s.row}>
              <Ionicons name="shield-half-outline" size={20} color={colors.amber} />
              <Text style={s.lockdownTitle}>Lockdown Mode ativo</Text>
            </View>
            <Text style={s.dimText}>Somente leitura. Para voltar a agir no PC, desative no Pulse Desktop.</Text>
          </Card>
        )}
        {!online && (
          <Text style={s.dimText}>PC offline: as ações ficam desativadas até reconectar.</Text>
        )}
        {message && (
          <Card style={message.ok ? s.msgOk : s.msgBad}>
            <Text style={s.msgText}>{message.text}</Text>
          </Card>
        )}
        {error && <Text style={s.errorText}>{error}</Text>}

        <View style={s.grid}>
          <Mini width={cell} label="CPU" value={heartbeat ? `${heartbeat.cpuPercent.toFixed(0)}%` : "—"} />
          <Mini width={cell} label="RAM" value={heartbeat ? `${gb(heartbeat.memUsedBytes)}/${gb(heartbeat.memTotalBytes)} GB` : "—"} />
          <Mini width={cell} label="GPU" value={heartbeat?.gpuPercent != null ? `${heartbeat.gpuPercent.toFixed(0)}%` : "—"} />
          <Mini width={cell} label="Disco" value={heartbeat?.systemDisk ? formatBytes(heartbeat.systemDisk.usedBytes) : "—"} />
          <Mini width={cell} label="Rede ↓" value={heartbeat ? formatRate(heartbeat.netRxBytesPerSec) : "—"} />
          <Mini width={cell} label="Ligado há" value={heartbeat ? formatDuration(heartbeat.systemUptimeSecs) : "—"} />
        </View>

        <SectionTitle>Energia e tela</SectionTitle>
        <View style={s.powerGrid}>
          {POWER.map((p) => {
            const enabled = can(p.level) && !busy;
            return (
              <Pressable
                key={p.label}
                accessibilityRole="button"
                accessibilityState={{ disabled: !enabled, busy: busy === p.label }}
                disabled={!enabled}
                onPress={() => void run(p.label, p.action)}
                style={({ pressed }) => [s.powerBtn, { width: cell }, pressed && s.pressed, !enabled && s.disabled]}
              >
                <Ionicons name={p.icon} size={24} color={p.action.action === "shutdown" ? colors.red : colors.blueSoft} />
                <Text style={s.powerLabel}>{busy === p.label ? "…" : p.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <SectionTitle>Abrir no PC</SectionTitle>
        <Text style={s.dimText}>Toque para abrir o app na tela do computador.</Text>
        <Card style={s.listCard}>
          {snap && snap.allowedApps.length === 0 && (
            <Text style={s.empty}>Nenhum app permitido. Adicione no Pulse Desktop → Control.</Text>
          )}
          {snap?.allowedApps.map((a, i) => (
            <Row
              key={a.id}
              first={i === 0}
              title={a.name}
              icon="play-circle-outline"
              disabled={!can("SAFE_ACTION") || !!busy}
              onPress={() => void run(a.id, { action: "appLaunch", params: { appId: a.id } })}
            />
          ))}
        </Card>

        <SectionTitle>Apps abertos</SectionTitle>
        <Card style={s.listCard}>
          {snap?.apps.map((a, i) => (
            <Row
              key={a.pid}
              first={i === 0}
              title={a.title}
              subtitle={`${a.process} · ${formatBytes(a.memBytes)}`}
              icon="close-circle-outline"
              iconColor={colors.dim}
              disabled={!can("CONFIRM") || !!busy}
              onPress={() => void run(`app-${a.pid}`, { action: "appClose", params: { pid: a.pid } })}
            />
          ))}
        </Card>

        <SectionTitle>Processos</SectionTitle>
        <Card style={s.listCard}>
          {snap?.processes.slice(0, 10).map((p, i) => (
            <Row
              key={p.pid}
              first={i === 0}
              title={p.name}
              subtitle={`CPU ${p.cpuPercent.toFixed(1)}% · ${formatBytes(p.memBytes)}`}
              icon="stop-circle-outline"
              iconColor={colors.red}
              disabled={!can("CONFIRM") || !!busy}
              onPress={() => void run(`proc-${p.pid}`, { action: "processKill", params: { pid: p.pid } })}
            />
          ))}
        </Card>

        {snap && <Text style={s.dimText}>{snap.runningServices.length} serviços do Windows em execução.</Text>}
      </ScrollView>

      <Modal visible={!!shot} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShot(null)}>
        <View style={s.shotScreen}>
          <View style={s.shotHeader}>
            <Text style={s.shotTitle}>Tela do PC</Text>
            <Pressable accessibilityRole="button" onPress={() => setShot(null)} hitSlop={12}>
              <Text style={s.shotClose}>Fechar</Text>
            </Pressable>
          </View>
          {shot && (
            <ScrollView maximumZoomScale={4} minimumZoomScale={1} centerContent contentContainerStyle={s.shotContent}>
              <Image
                source={{ uri: `data:${shot.mime};base64,${shot.base64}` }}
                style={{ width: "100%", aspectRatio: shot.width / shot.height }}
                resizeMode="contain"
                accessibilityLabel="Captura da tela do PC"
              />
            </ScrollView>
          )}
        </View>
      </Modal>
    </View>
  );
}

function Mini({ label, value, width }: { label: string; value: string; width: number }) {
  return (
    <Card style={[s.mini, { width }]}>
      <Text style={s.miniLabel}>{label}</Text>
      <Text style={s.miniValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </Card>
  );
}

function Row(props: {
  title: string;
  subtitle?: string;
  icon: IconName;
  iconColor?: string;
  first: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <View style={[s.listRow, !props.first && s.listBorder]}>
      <View style={{ flex: 1 }}>
        <Text style={s.rowTitle} numberOfLines={1}>
          {props.title}
        </Text>
        {props.subtitle && <Text style={s.rowSub}>{props.subtitle}</Text>}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={props.title}
        disabled={props.disabled}
        onPress={props.onPress}
        hitSlop={10}
        style={({ pressed }) => [pressed && s.pressed, props.disabled && s.disabled]}
      >
        <Ionicons name={props.icon} size={26} color={props.iconColor ?? colors.blueSoft} />
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  content: { paddingHorizontal: SCREEN_PADDING, paddingBottom: 32, gap: 12 },
  title: { color: colors.text, fontSize: 32, fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  lockdown: { borderColor: colors.amberSoft, backgroundColor: colors.amberSoft },
  lockdownTitle: { color: colors.amber, fontSize: 16, fontWeight: "700" },
  dimText: { color: colors.dim, fontSize: 13 },
  errorText: { color: colors.red, fontSize: 13 },
  msgOk: { borderColor: colors.greenSoft },
  msgBad: { borderColor: colors.redSoft, backgroundColor: colors.redSoft },
  msgText: { color: colors.text, fontSize: 14 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: GRID_GAP },
  mini: { padding: 10, gap: 2 },
  miniLabel: { color: colors.dim, fontSize: 11, fontWeight: "600" },
  miniValue: { color: colors.text, fontSize: 15, fontWeight: "700" },
  powerGrid: { flexDirection: "row", flexWrap: "wrap", gap: GRID_GAP },
  powerBtn: {
    height: 84,
    borderRadius: radius.card,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  powerLabel: { color: colors.text, fontSize: 13, fontWeight: "600" },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.35 },
  listCard: { paddingVertical: 2 },
  listRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  listBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  rowTitle: { color: colors.text, fontSize: 15 },
  rowSub: { color: colors.dim, fontSize: 12, marginTop: 1 },
  empty: { color: colors.dim, paddingVertical: 10, fontSize: 14 },
  shotScreen: { flex: 1, backgroundColor: "#000" },
  shotHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16 },
  shotTitle: { color: colors.text, fontSize: 17, fontWeight: "600" },
  shotClose: { color: colors.blueSoft, fontSize: 17 },
  shotContent: { flexGrow: 1, justifyContent: "center" },
});
