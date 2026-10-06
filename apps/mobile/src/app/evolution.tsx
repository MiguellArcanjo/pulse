import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Modal, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { EvolutionEvent } from "@morph/client";
import { describeError, useMorph } from "../data/MorphProvider";
import { UiIcon } from "../design/icons";
import { ScreenScroll, Surface, Tap, Txt } from "../design/primitives";
import { useTheme } from "../design/theme";
import { GUTTER, radius, space } from "../design/tokens";
import { eventColor, eventTitle, PERIODS, relativeTime, withinPeriod, type PeriodId } from "../evolution/labels";

type Data = { events: EvolutionEvent[]; counts: { tools: number; automations: number; integrations: number } };

/**
 * Evolução (mockup 10): como o app mudou, por que, e desfazer.
 * Os dados vêm do servidor; sem conexão, a tela diz isso em vez de inventar.
 */
export default function Evolution() {
  const morph = useMorph();
  const { colors, accent } = useTheme();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<PeriodId>("month");
  const [selected, setSelected] = useState<EvolutionEvent | null>(null);

  const load = useCallback(async () => {
    if (morph.status !== "ready") return;
    try {
      setError(null);
      setData(await morph.evolution());
    } catch (err) {
      setError(describeError(err).replace("Nada foi salvo.", "A linha do tempo precisa do servidor."));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [morph.status]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (morph.status !== "ready") return null;
  const spec = morph.snapshot?.spec;
  const now = new Date();
  const events = (data?.events ?? []).filter((e) => withinPeriod(e.createdAt, period, now));
  const latestVersion = data?.events[0]?.version ?? 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.bar, { paddingTop: insets.top }]}>
        <Tap onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} style={styles.back} accessibilityLabel="Voltar">
          <UiIcon name="chevron-left" size={28} color={colors.text} />
        </Tap>
        <Txt variant="title">Evolução</Txt>
      </View>
      <ScreenScroll topInset={false} onRefresh={() => void load()}>
        <View style={[styles.segment, { backgroundColor: colors.surface }]}>
          {PERIODS.map((p) => {
            const on = p.id === period;
            return (
              <Tap key={p.id} haptic={false} onPress={() => setPeriod(p.id)} style={[styles.segmentItem, on && { backgroundColor: colors.surfaceStrong }]}>
                <Txt variant="footnote" tone={on ? "primary" : "secondary"} style={{ fontWeight: on ? "600" : "400" }}>
                  {p.label}
                </Txt>
              </Tap>
            );
          })}
        </View>

        {error && (
          <Txt variant="footnote" tone="tertiary">
            {error}
          </Txt>
        )}
        {data && events.length === 0 && (
          <Txt variant="footnote" tone="tertiary">
            Nenhuma mudança neste período.
          </Txt>
        )}

        <View>
          {events.map((e, i) => (
            <Tap key={e.id} haptic={false} onPress={() => setSelected(e)} style={styles.item}>
              <View style={styles.rail}>
                <View style={[styles.dot, { backgroundColor: eventColor(e), shadowColor: eventColor(e) }]} />
                {i < events.length - 1 && <View style={[styles.line, { backgroundColor: colors.border }]} />}
              </View>
              <View style={{ flex: 1, paddingBottom: space.xl, gap: 2 }}>
                <Txt variant="footnote" style={{ color: i === 0 ? accent.main : colors.textTertiary }}>
                  {relativeTime(e.createdAt, now)}
                </Txt>
                <Txt variant="callout">{eventTitle(e, spec)}</Txt>
                {e.kind !== "app_started" && (
                  <Txt variant="footnote" tone="secondary" numberOfLines={2}>
                    {e.summary}
                  </Txt>
                )}
              </View>
            </Tap>
          ))}
        </View>

        {data && (
          <View style={styles.counts}>
            <Count value={data.counts.tools} label="ferramentas" />
            <Count value={data.counts.automations} label="automações" />
            <Count value={data.counts.integrations} label="integrações" />
          </View>
        )}
      </ScreenScroll>

      <EventSheet
        event={selected}
        latestVersion={latestVersion}
        title={selected ? eventTitle(selected, spec) : ""}
        onClose={() => setSelected(null)}
        onUndo={async (e) => {
          setSelected(null);
          try {
            await morph.restore(e.version - 1);
            await load();
          } catch (err) {
            Alert.alert("Não foi desfeito", describeError(err).replace("Nada foi salvo.", "Nada mudou."));
          }
        }}
      />
    </View>
  );
}

function Count({ value, label }: { value: number; label: string }) {
  return (
    <Surface style={styles.count}>
      <Txt variant="stat">{value}</Txt>
      <Txt variant="caption" tone="secondary">
        {label}
      </Txt>
    </Surface>
  );
}

/** Detalhe de um evento: o que mudou, e desfazer (sempre com confirmação). */
function EventSheet({
  event,
  title,
  latestVersion,
  onClose,
  onUndo,
}: {
  event: EvolutionEvent | null;
  title: string;
  latestVersion: number;
  onClose(): void;
  onUndo(e: EvolutionEvent): void;
}) {
  const { colors, accent } = useTheme();
  const insets = useSafeAreaInsets();
  if (!event) return null;
  const canUndo = event.version > 0;
  const later = latestVersion - event.version;

  const confirm = () => {
    const extra = later > 0 ? `\n\nAs ${later} mudança(s) feitas depois desta também serão desfeitas.` : "";
    Alert.alert("Desfazer esta mudança?", `O app volta a como estava antes dela. Seus dados continuam guardados.${extra}`, [
      { text: "Cancelar", style: "cancel" },
      { text: "Desfazer", style: "destructive", onPress: () => onUndo(event) },
    ]);
  };

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: colors.background, borderColor: colors.border, paddingBottom: insets.bottom + space.lg }]}>
        <View style={[styles.handle, { backgroundColor: colors.border }]} />
        <Txt variant="footnote" tone="tertiary">
          Versão {event.version} · {new Date(event.createdAt).toLocaleString("pt-BR")}
        </Txt>
        <Txt variant="title">{title}</Txt>
        <Txt tone="secondary">{event.summary}</Txt>
        {canUndo ? (
          <Tap onPress={confirm} style={[styles.undo, { borderColor: accent.main }]}>
            <UiIcon name="undo-variant" size={18} color={accent.main} />
            <Txt variant="callout" tone="accent">
              {later > 0 ? "Voltar para antes desta mudança" : "Desfazer"}
            </Txt>
          </Tap>
        ) : (
          <Txt variant="footnote" tone="tertiary">
            Este é o começo do seu app.
          </Txt>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", paddingHorizontal: GUTTER - 8, gap: space.xs },
  back: { width: 40, height: 44, alignItems: "flex-start", justifyContent: "center" },
  segment: { flexDirection: "row", borderRadius: radius.md, padding: 3 },
  segmentItem: { flex: 1, alignItems: "center", paddingVertical: space.sm, borderRadius: radius.sm },
  item: { flexDirection: "row", gap: space.md },
  rail: { width: 16, alignItems: "center" },
  dot: { width: 12, height: 12, borderRadius: 6, marginTop: 3, shadowOpacity: 0.8, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } },
  line: { width: StyleSheet.hairlineWidth * 2, flex: 1, marginTop: space.xs },
  counts: { flexDirection: "row", gap: space.sm },
  count: { flex: 1, gap: 2, paddingVertical: space.md },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, padding: GUTTER, gap: space.md, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  handle: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, marginBottom: space.xs },
  undo: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm, height: 48, borderRadius: radius.md, borderWidth: 1, marginTop: space.sm },
});
