import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { AuditItem } from "@pulse/protocol";
import { usePulse } from "../../session/SessionProvider";
import { Bar, Card, Pill, Screen, SectionTitle } from "../../ui";
import { colors } from "../../theme";
import { formatAgo, formatBytes, formatDuration, formatRate, formatTime, gb } from "../../format";
import { describeAudit } from "../../audit";

export default function Home() {
  const { connection, status, heartbeat, audit, lastUpdateMs, reconnect } = usePulse();
  const online = connection.kind === "online";
  const stale = !online;
  const now = useNow(15_000);

  const memPct = heartbeat ? (heartbeat.memUsedBytes / heartbeat.memTotalBytes) * 100 : 0;
  const disk = heartbeat?.systemDisk ?? null;

  return (
    <Screen>
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.hostname} numberOfLines={1}>
            {status?.hostname ?? "Seu PC"}
          </Text>
          <Text style={s.os}>{status?.osVersion ?? "—"}</Text>
        </View>
        {online ? (
          <Pill label="Online" tone="ok" />
        ) : connection.kind === "connecting" ? (
          <Pill label="Conectando" tone="warn" />
        ) : (
          <Pill label="PC Offline" tone="bad" />
        )}
      </View>

      {!online && connection.kind !== "connecting" && (
        <Pressable onPress={reconnect} accessibilityRole="button" accessibilityHint="Tentar reconectar agora">
          <Card style={s.offline}>
            <View style={s.offlineRow}>
              <Ionicons name="cloud-offline-outline" size={20} color={colors.red} />
              <Text style={s.offlineTitle}>PC Offline</Text>
            </View>
            <Text style={s.offlineText}>
              {connection.kind === "offline" ? connection.reason : "Sem conexão com o PC."}{" "}
              {lastUpdateMs ? `Última atualização: ${formatAgo(lastUpdateMs, now)}.` : "Ainda sem dados deste PC."}
            </Text>
            <Text style={s.offlineHint}>Toque para tentar de novo.</Text>
          </Card>
        </Pressable>
      )}

      {heartbeat && (
        <Text style={s.uptime}>
          Ligado há {formatDuration(heartbeat.systemUptimeSecs)}
          {online ? "" : ` · dados de ${lastUpdateMs ? formatTime(lastUpdateMs) : "—"}`}
        </Text>
      )}

      <View style={[s.grid, stale && s.stale]}>
        <Metric label="CPU" value={heartbeat ? `${heartbeat.cpuPercent.toFixed(0)}%` : "—"} percent={heartbeat?.cpuPercent} />
        <Metric
          label="RAM"
          value={heartbeat ? gb(heartbeat.memUsedBytes) : "—"}
          unit={heartbeat ? `/ ${gb(heartbeat.memTotalBytes)} GB` : undefined}
          percent={heartbeat ? memPct : undefined}
        />
        <Metric
          label="Disco"
          value={disk ? formatBytes(disk.usedBytes) : "—"}
          unit={disk ? `/ ${formatBytes(disk.totalBytes)}` : undefined}
          percent={disk ? (disk.usedBytes / disk.totalBytes) * 100 : undefined}
          color={colors.green}
        />
        <Card style={s.metric}>
          <Text style={s.metricLabel}>Rede</Text>
          <Text style={s.net}>↓ {heartbeat ? formatRate(heartbeat.netRxBytesPerSec) : "—"}</Text>
          <Text style={s.net}>↑ {heartbeat ? formatRate(heartbeat.netTxBytesPerSec) : "—"}</Text>
        </Card>
      </View>

      <SectionTitle>Atividade recente</SectionTitle>
      <Card style={[s.activity, stale && s.stale]}>
        {audit.length === 0 ? (
          <Text style={s.empty}>Nada registrado ainda.</Text>
        ) : (
          audit.slice(0, 6).map((a, i) => <ActivityRow key={a.id} item={a} first={i === 0} />)
        )}
      </Card>
    </Screen>
  );
}

function useNow(everyMs: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

function Metric(props: { label: string; value: string; unit?: string; percent?: number; color?: string }) {
  return (
    <Card style={s.metric}>
      <Text style={s.metricLabel}>{props.label}</Text>
      <Text style={s.metricValue} numberOfLines={1} adjustsFontSizeToFit>
        {props.value}
        {props.unit ? <Text style={s.metricUnit}> {props.unit}</Text> : null}
      </Text>
      {props.percent !== undefined && <Bar percent={props.percent} color={props.color} />}
    </Card>
  );
}

function ActivityRow({ item, first }: { item: AuditItem; first: boolean }) {
  const d = describeAudit(item);
  return (
    <View style={[s.actRow, !first && s.actBorder]}>
      <Ionicons name={d.icon} size={18} color={colors.blueSoft} />
      <View style={{ flex: 1 }}>
        <Text style={s.actTitle} numberOfLines={1}>
          {d.title}
        </Text>
        <Text style={s.actSub}>
          {formatTime(item.tsMs)} · {d.who}
        </Text>
      </View>
      {item.result !== "ok" && <Pill label={item.result === "denied" ? "Negado" : "Erro"} tone="bad" />}
    </View>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 12 },
  hostname: { color: colors.text, fontSize: 30, fontWeight: "700" },
  os: { color: colors.dim, fontSize: 14, marginTop: 2 },
  uptime: { color: colors.dim, fontSize: 14 },
  offline: { borderColor: colors.redSoft, backgroundColor: "rgba(240,82,82,0.08)" },
  offlineRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  offlineTitle: { color: colors.red, fontSize: 17, fontWeight: "700" },
  offlineText: { color: colors.text, fontSize: 14 },
  offlineHint: { color: colors.dim, fontSize: 12 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  stale: { opacity: 0.45 },
  metric: { width: "47.9%", minHeight: 104 },
  metricLabel: { color: colors.dim, fontSize: 13, fontWeight: "600" },
  metricValue: { color: colors.text, fontSize: 24, fontWeight: "700" },
  metricUnit: { color: colors.dim, fontSize: 13, fontWeight: "400" },
  net: { color: colors.text, fontSize: 16, fontWeight: "600" },
  activity: { paddingVertical: 4 },
  empty: { color: colors.dim, paddingVertical: 10 },
  actRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  actBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  actTitle: { color: colors.text, fontSize: 15 },
  actSub: { color: colors.dim, fontSize: 12, marginTop: 1 },
});
