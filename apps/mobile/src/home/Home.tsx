import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { Alert, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Tool } from "@morph/protocol";
import { useReady } from "../data/MorphProvider";
import { Icon, UiIcon } from "../design/icons";
import { ScreenScroll, Surface, Tap, Txt } from "../design/primitives";
import { useTheme } from "../design/theme";
import { accents, GUTTER, radius, space } from "../design/tokens";

/**
 * Início. Sem ferramentas: o convite "O que vamos criar hoje?" (mockup 1).
 * Com ferramentas: saudação e as ferramentas do usuário.
 * A caixa de pedido aparece desativada: a criação por IA chega no passo 6.
 */
export function Home() {
  const morph = useReady();
  const tools = (morph.snapshot?.spec.navigation ?? [])
    .map((id) => morph.snapshot?.spec.tools.find((t) => t.id === id))
    .filter((t): t is Tool => t?.status === "active");

  return (
    <View style={{ flex: 1 }}>
      <ScreenScroll bottomInset={96}>
        <TopBar />
        {morph.sync === "offline" && (
          <Txt variant="footnote" tone="tertiary">
            Sem conexão: mostrando o que está salvo no aparelho.
          </Txt>
        )}
        {tools.length === 0 ? <Empty /> : <WithTools tools={tools} />}
      </ScreenScroll>
      <Composer placeholder={tools.length === 0 ? "Fale ou digite algo…" : "Pergunte ou crie algo…"} />
    </View>
  );
}

function TopBar() {
  const morph = useReady();
  const { colors } = useTheme();
  const menu = () =>
    Alert.alert("Servidor", morph.serverUrl, [
      { text: "Sincronizar agora", onPress: () => void morph.refresh() },
      { text: "Desconectar este iPhone", style: "destructive", onPress: () => void morph.unpair().then(() => router.replace("/pair")) },
      { text: "Fechar", style: "cancel" },
    ]);
  return (
    <View style={styles.topBar}>
      <Txt variant="title" style={{ letterSpacing: -0.5 }}>
        morph
      </Txt>
      <Tap onPress={menu} accessibilityLabel="Configurações" style={[styles.avatar, { backgroundColor: colors.surfaceStrong }]}>
        <UiIcon name={morph.sync === "syncing" ? "sync" : "account-outline"} size={20} color={colors.textSecondary} />
      </Tap>
    </View>
  );
}

const EXAMPLES = ["Quero controlar meus treinos", "Acompanhar meus projetos", "Organizar minha próxima viagem"];

function Empty() {
  const { colors } = useTheme();
  return (
    <View style={{ gap: space.xxl, marginTop: space.xxl * 2 }}>
      <Txt variant="largeTitle" style={{ fontSize: 34, fontWeight: "500", lineHeight: 40 }}>
        O que vamos{"\n"}criar hoje?
      </Txt>
      <View style={{ gap: space.sm }}>
        <Txt variant="footnote" tone="tertiary">
          Exemplos
        </Txt>
        {EXAMPLES.map((e) => (
          <View key={e} style={[styles.example, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Txt variant="footnote" tone="tertiary">
              {e}
            </Txt>
          </View>
        ))}
      </View>
    </View>
  );
}

function greeting(now: Date): string {
  const h = now.getHours();
  return h < 5 ? "Boa noite." : h < 12 ? "Bom dia." : h < 18 ? "Boa tarde." : "Boa noite.";
}

function WithTools({ tools }: { tools: Tool[] }) {
  return (
    <View style={{ gap: space.xl }}>
      <View style={{ gap: space.xs }}>
        <Txt variant="largeTitle">{greeting(new Date())}</Txt>
        <Txt tone="secondary">Suas ferramentas</Txt>
      </View>
      <View style={styles.grid}>
        {tools.map((t) => (
          <ToolCard key={t.id} tool={t} />
        ))}
      </View>
      <Surface style={styles.soon}>
        <UiIcon name="timeline-clock-outline" size={20} color="#888" />
        <View style={{ flex: 1 }}>
          <Txt variant="callout" tone="secondary">
            Evolução
          </Txt>
          <Txt variant="footnote" tone="tertiary">
            A linha do tempo do seu app chega no passo 5.
          </Txt>
        </View>
      </Surface>
    </View>
  );
}

function ToolCard({ tool }: { tool: Tool }) {
  const accent = accents[tool.accent];
  const { colors } = useTheme();
  return (
    <Tap onPress={() => router.push({ pathname: "/s/[screen]", params: { screen: tool.home } })} style={styles.cell}>
      <View style={[styles.toolCard, { borderColor: colors.border }]}>
        <LinearGradient colors={[accent.dark, accent.soft]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <View style={[styles.toolIcon, { backgroundColor: "rgba(255,255,255,0.14)" }]}>
          <Icon name={tool.icon} size={22} color="#FFFFFF" />
        </View>
        <View style={{ gap: 2 }}>
          <Txt variant="headline" style={{ color: "#FFFFFF" }}>
            {tool.name}
          </Txt>
          {tool.description && (
            <Txt variant="footnote" numberOfLines={2} style={{ color: "rgba(255,255,255,0.72)" }}>
              {tool.description}
            </Txt>
          )}
        </View>
      </View>
    </Tap>
  );
}

/** Caixa de pedido (mockups 1 e 4). Desativada até a IA existir (passo 6). */
function Composer({ placeholder }: { placeholder: string }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.composerWrap, { paddingBottom: insets.bottom + space.sm, backgroundColor: colors.background }]}>
      <View style={[styles.composer, { backgroundColor: colors.surfaceStrong, borderColor: colors.border }]}>
        <UiIcon name="plus" size={20} color={colors.textTertiary} />
        <TextInput editable={false} placeholder={placeholder} placeholderTextColor={colors.textTertiary} style={{ flex: 1, fontSize: 16 }} />
        <UiIcon name="microphone-outline" size={20} color={colors.textTertiary} />
      </View>
      <Txt variant="caption" tone="tertiary" style={{ textAlign: "center" }}>
        A criação com IA chega no passo 6.
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  avatar: { width: 36, height: 36, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  example: { alignSelf: "flex-start", paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  cell: { width: "48.5%" },
  toolCard: { height: 150, borderRadius: radius.lg, overflow: "hidden", padding: space.lg, justifyContent: "space-between", borderWidth: StyleSheet.hairlineWidth },
  toolIcon: { width: 40, height: 40, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  soon: { flexDirection: "row", alignItems: "center", gap: space.md, opacity: 0.8 },
  composerWrap: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: GUTTER, paddingTop: space.sm, gap: space.xs },
  composer: { flexDirection: "row", alignItems: "center", gap: space.md, height: 52, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.lg, opacity: 0.7 },
});
