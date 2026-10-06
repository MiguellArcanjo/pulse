import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useState } from "react";
import { Alert, KeyboardAvoidingView, StyleSheet, TextInput, View } from "react-native";
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
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
      <ScreenScroll bottomInset={96} onRefresh={() => void morph.refresh()} refreshing={morph.sync === "syncing"}>
        <TopBar />
        <OfflineNote />
        <WithTools tools={tools} />
      </ScreenScroll>
      <View style={[styles.bottomComposer, { paddingBottom: insets.bottom + space.sm }]}>
        <Composer placeholder="Pergunte ou crie algo…" />
      </View>
    </KeyboardAvoidingView>
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

/** Abre a construção em tempo real com o pedido. */
function create(text: string) {
  const t = text.trim();
  if (t.length < 2) return;
  router.push(`/create?text=${encodeURIComponent(t)}`);
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

/**
 * Mockup 1: app vazio. Título por volta de 1/3 da altura e caixa de pedido logo abaixo;
 * em colunas flexíveis para que tudo suba junto quando o teclado abre.
 */
function EmptyHome() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ flex: 1, paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.xl, paddingHorizontal: GUTTER }}>
        <TopBar />
        <OfflineNote />
        <View style={{ flex: 0.9 }} />
        <Txt style={styles.bigTitle}>O que vamos{"\n"}criar hoje?</Txt>
        <View style={{ flex: 1 }} />
        <View style={{ gap: space.xl }}>
          <Composer placeholder="Fale ou digite algo…" />
          <View style={{ gap: space.sm }}>
            <Txt variant="footnote" tone="secondary">
              Exemplos
            </Txt>
            {EXAMPLES.map((e) => (
              <Tap key={e} onPress={() => create(e)} haptic={false} style={[styles.example, { backgroundColor: colors.surfaceStrong }]}>
                <Txt variant="footnote" style={{ color: colors.text, opacity: 0.82 }}>
                  {e}
                </Txt>
              </Tap>
            ))}
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
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
      <Tap onPress={() => router.push("/evolution")}>
        <Surface style={styles.evolution}>
          <UiIcon name="timeline-clock-outline" size={22} color={accents.violet.main} />
          <View style={{ flex: 1 }}>
            <Txt variant="callout">Evolução</Txt>
            <Txt variant="footnote" tone="secondary">
              Como o seu app mudou ao longo do tempo
            </Txt>
          </View>
          <UiIcon name="chevron-right" size={20} color="#777" />
        </Surface>
      </Tap>
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

/** Caixa de pedido (mockups 1 e 4): o que o usuário escreve vira um pedido à IA. */
function Composer({ placeholder }: { placeholder: string }) {
  const { colors, scheme } = useTheme();
  const [text, setText] = useState("");
  const send = () => {
    create(text);
    setText("");
  };
  const canSend = text.trim().length >= 2;
  return (
    <View style={[styles.composer, { backgroundColor: colors.surfaceStrong, borderColor: colors.border }]}>
      <View style={[styles.plus, { backgroundColor: scheme === "dark" ? "rgba(255,255,255,0.88)" : "#0B0B0F" }]}>
        <UiIcon name="plus" size={18} color={scheme === "dark" ? "#0B0B0F" : "#FFFFFF"} />
      </View>
      <TextInput
        value={text}
        onChangeText={setText}
        onSubmitEditing={send}
        returnKeyType="send"
        placeholder={placeholder}
        placeholderTextColor={colors.textSecondary}
        style={{ flex: 1, fontSize: 15, color: colors.text }}
      />
      {canSend ? (
        <Tap onPress={send} accessibilityLabel="Enviar">
          <UiIcon name="arrow-up-circle" size={30} color={colors.text} />
        </Tap>
      ) : (
        <Tap onPress={() => Alert.alert("Em breve", "Falar em vez de digitar ainda não existe. Por enquanto, escreva o pedido.")} accessibilityLabel="Falar">
          <UiIcon name="microphone-outline" size={20} color={colors.textSecondary} />
        </Tap>
      )}
    </View>
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
  evolution: { flexDirection: "row", alignItems: "center", gap: space.md },
  bottomComposer: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: GUTTER, paddingTop: space.sm },
  composer: { flexDirection: "row", alignItems: "center", gap: space.md, height: 56, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth, paddingLeft: 10, paddingRight: space.lg },
  plus: { width: 36, height: 36, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  bigTitle: { fontSize: 40, lineHeight: 46, fontWeight: "400", letterSpacing: -0.8 },
});
