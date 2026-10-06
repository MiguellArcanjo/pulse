import { router, useLocalSearchParams } from "expo-router";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMorph } from "../../data/MorphProvider";
import { UiIcon } from "../../design/icons";
import { ScreenScroll, Tap, Txt } from "../../design/primitives";
import { ThemeProvider, useTheme } from "../../design/theme";
import { GUTTER, space } from "../../design/tokens";
import { ScreenRenderer } from "../../renderer/RenderNode";

/** Qualquer tela da spec: /s/<id da tela>?<parâmetros>. */
export default function SpecScreen() {
  const { screen: screenId, ...rest } = useLocalSearchParams<Record<string, string>>();
  const morph = useMorph();
  if (morph.status !== "ready" || !morph.snapshot) return <Missing />;
  const spec = morph.snapshot.spec;
  const screen = spec.screens.find((s) => s.id === screenId);
  const tool = spec.tools.find((t) => t.id === screen?.toolId);
  if (!screen || !tool || tool.status !== "active") return <Missing />;

  const params: Record<string, string> = {};
  for (const p of screen.params ?? []) {
    const v = rest[p.id];
    if (typeof v === "string") params[p.id] = v;
  }
  return (
    <ThemeProvider accent={tool.accent}>
      <BackBar title={tool.home === screen.id ? null : screen.title} />
      <ScreenScroll>
        <ScreenRenderer screen={screen} params={params} />
      </ScreenScroll>
    </ThemeProvider>
  );
}

function BackBar({ title }: { title: string | null }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingTop: insets.top, backgroundColor: colors.background }]}>
      <Tap onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} style={styles.back} accessibilityLabel="Voltar">
        <UiIcon name="chevron-left" size={28} color={colors.text} />
      </Tap>
      {title && (
        <Txt variant="headline" numberOfLines={1} style={{ flex: 1, textAlign: "center", marginRight: 44 }}>
          {title}
        </Txt>
      )}
    </View>
  );
}

/** A tela pode ter sumido (mudança desfeita, ferramenta arquivada). */
function Missing() {
  const { colors } = useTheme();
  return (
    <View style={[styles.missing, { backgroundColor: colors.background }]}>
      <Txt variant="headline">Esta tela não existe mais</Txt>
      <Tap onPress={() => router.replace("/")}>
        <Txt tone="accent">Voltar ao início</Txt>
      </Tap>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", paddingHorizontal: GUTTER - 8, paddingBottom: space.xs },
  back: { width: 44, height: 44, alignItems: "flex-start", justifyContent: "center" },
  missing: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.md },
});
