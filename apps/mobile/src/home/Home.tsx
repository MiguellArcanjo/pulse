import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { Alert, StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Tool } from "@morph/protocol";
import { useReady } from "../data/MorphProvider";
import { HomeMotion, MotionNode } from "../motion/Motion";
import { openScreen } from "../renderer/navigation";
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
  const insets = useSafeAreaInsets();
  const tools = (morph.snapshot?.spec.navigation ?? [])
    .map((id) => morph.snapshot?.spec.tools.find((t) => t.id === id))
    .filter((t): t is Tool => t?.status === "active");

  if (tools.length === 0) return <EmptyHome />;
  return (
    <View style={{ flex: 1 }}>
      <ScreenScroll bottomInset={96} onRefresh={() => void morph.refresh()} refreshing={morph.sync === "syncing"}>
        <TopBar />
        <OfflineNote />
        <WithTools tools={tools} />
      </ScreenScroll>
      <View style={[styles.bottomComposer, { paddingBottom: insets.bottom + space.sm }]}>
        <Composer placeholder="Pergunte ou crie algo…" />
      </View>
    </View>
  );
}

function OfflineNote() {
  const morph = useReady();
  if (morph.sync !== "offline") return null;
  return (
    <Txt variant="footnote" tone="tertiary">
      Sem conexão: mostrando o que está salvo no aparelho.
    </Txt>
  );
}

/** A criação por IA ainda não existe: tocar explica quando chega. */
function soon() {
  Alert.alert("Em breve", "Criar e mudar ferramentas conversando com a IA chega no passo 6 do plano.");
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

/** Mockup 1: app vazio. Proporções medidas no mockup (título a ~33% da altura, caixa a ~64%). */
function EmptyHome() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top + space.lg, paddingHorizontal: GUTTER }}>
      <TopBar />
      <OfflineNote />
      <View style={{ position: "absolute", top: height * 0.31, left: GUTTER, right: GUTTER }}>
        <Txt style={styles.bigTitle}>O que vamos{"\n"}criar hoje?</Txt>
      </View>
      <View style={{ position: "absolute", top: height * 0.62, left: GUTTER, right: GUTTER, gap: space.xl }}>
        <Composer placeholder="Fale ou digite algo…" />
        <View style={{ gap: space.sm }}>
          <Txt variant="footnote" tone="secondary">
            Exemplos
          </Txt>
          {EXAMPLES.map((e) => (
            <Tap key={e} onPress={soon} haptic={false} style={[styles.example, { backgroundColor: colors.surfaceStrong }]}>
              <Txt variant="footnote" style={{ color: colors.text, opacity: 0.82 }}>
                {e}
              </Txt>
            </Tap>
          ))}
        </View>
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
        <Txt variant="title" style={{ fontSize: 26, fontWeight: "600" }}>
          {greeting(new Date())}
        </Txt>
        <Txt tone="secondary">Suas ferramentas</Txt>
      </View>
      <HomeMotion>
        <View style={styles.grid}>
          {tools.map((t) => (
            <View key={t.id} style={styles.cell}>
              <MotionNode id={`tool:${t.id}`}>
                <ToolCard tool={t} />
              </MotionNode>
            </View>
          ))}
        </View>
      </HomeMotion>
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
    <Tap onPress={() => openScreen(tool.home)}>
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

/** Caixa de pedido (mockups 1 e 4). Até a IA existir (passo 6), tocar só explica. */
function Composer({ placeholder }: { placeholder: string }) {
  const { colors, scheme } = useTheme();
  return (
    <Tap onPress={soon} haptic={false} style={[styles.composer, { backgroundColor: colors.surfaceStrong, borderColor: colors.border }]}>
      <View style={[styles.plus, { backgroundColor: scheme === "dark" ? "rgba(255,255,255,0.88)" : "#0B0B0F" }]}>
        <UiIcon name="plus" size={18} color={scheme === "dark" ? "#0B0B0F" : "#FFFFFF"} />
      </View>
      <Txt variant="callout" tone="secondary" style={{ flex: 1, fontWeight: "400" }}>
        {placeholder}
      </Txt>
      <UiIcon name="microphone-outline" size={20} color={colors.text} />
    </Tap>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  avatar: { width: 34, height: 34, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "rgba(255,255,255,0.18)" },
  example: { alignSelf: "flex-start", paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  cell: { width: "48.5%" },
  toolCard: { height: 150, borderRadius: radius.lg, overflow: "hidden", padding: space.lg, justifyContent: "space-between", borderWidth: StyleSheet.hairlineWidth },
  toolIcon: { width: 40, height: 40, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  soon: { flexDirection: "row", alignItems: "center", gap: space.md, opacity: 0.8 },
  bottomComposer: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: GUTTER, paddingTop: space.sm },
  composer: { flexDirection: "row", alignItems: "center", gap: space.md, height: 56, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth, paddingLeft: 10, paddingRight: space.lg },
  plus: { width: 36, height: 36, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  bigTitle: { fontSize: 40, lineHeight: 46, fontWeight: "400", letterSpacing: -0.8 },
});
