import { createContext, useContext, useEffect, type ReactNode } from "react";
import { StyleSheet } from "react-native";
import Animated, {
  FadeOut,
  LayoutAnimationConfig,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useMorph } from "../data/MorphProvider";
import { useTheme } from "../design/theme";
import { radius } from "../design/tokens";

/**
 * Motion Engine: "a interface não apenas troca, ela se transforma".
 *
 * Cada componente da spec fica dentro de uma camada animada com o mesmo id do protocolo.
 * Quando a spec muda, o React mantém o que tem o mesmo id e:
 * - o que surgiu entra crescendo e brilha por um instante na cor da ferramenta;
 * - o que sumiu sai esmaecendo;
 * - o resto desliza até o novo lugar;
 * - o que mudou de conteúdo brilha.
 * Ao abrir uma tela nada anima (LayoutAnimationConfig skipEntering): movimento só
 * quando ele significa uma mudança.
 * Docs: https://docs.swmansion.com/react-native-reanimated/docs/layout-animations/entering-exiting-animations/
 */

/** Por quanto tempo uma mudança recebida ainda é destacada ao abrir a tela. */
const HIGHLIGHT_WINDOW_MS = 10_000;

type Mark = "added" | "updated" | "moved";
const MarksContext = createContext<ReadonlyMap<string, Mark>>(new Map());

/** Marcas da tela atual, a partir da última mudança recebida. */
export function ScreenMotion({ screenId, children }: { screenId: string; children: ReactNode }) {
  const { lastChange } = useMorph();
  const marks = new Map<string, Mark>();
  const d = lastChange && Date.now() - lastChange.at < HIGHLIGHT_WINDOW_MS ? lastChange.diff.screens[screenId] : undefined;
  if (d) {
    for (const id of d.moved) marks.set(id, "moved");
    for (const id of d.updated) marks.set(id, "updated");
    for (const id of d.added) marks.set(id, "added");
  }
  return (
    <LayoutAnimationConfig skipEntering>
      <MarksContext.Provider value={marks}>{children}</MarksContext.Provider>
    </LayoutAnimationConfig>
  );
}

/** Início: ferramentas novas surgem e brilham. */
export function HomeMotion({ children }: { children: ReactNode }) {
  const { lastChange } = useMorph();
  const marks = new Map<string, Mark>();
  if (lastChange && Date.now() - lastChange.at < HIGHLIGHT_WINDOW_MS)
    for (const id of lastChange.diff.tools.added) marks.set(`tool:${id}`, "added");
  return (
    <LayoutAnimationConfig skipEntering>
      <MarksContext.Provider value={marks}>{children}</MarksContext.Provider>
    </LayoutAnimationConfig>
  );
}

/** Entrada: cresce de 94% e sobe 8 pontos, com mola; opacidade em tempo fixo. */
function appear() {
  "worklet";
  return {
    initialValues: { opacity: 0, transform: [{ scale: 0.94 }, { translateY: 8 }] },
    animations: {
      opacity: withTiming(1, { duration: 260 }),
      transform: [{ scale: withSpring(1, { damping: 16, stiffness: 180 }) }, { translateY: withSpring(0, { damping: 16, stiffness: 180 }) }],
    },
  };
}

const exit = FadeOut.duration(180);
const move = LinearTransition.duration(280);

export function MotionNode({ id, children }: { id: string; children: ReactNode }) {
  const mark = useContext(MarksContext).get(id);
  return (
    <Animated.View entering={appear} exiting={exit} layout={move}>
      {children}
      {(mark === "added" || mark === "updated") && <Glow />}
    </Animated.View>
  );
}

/** Brilho breve na cor da ferramenta: "isto acabou de mudar". */
function Glow() {
  const { accent } = useTheme();
  const opacity = useSharedValue(0);
  useEffect(() => {
    opacity.value = withSequence(withDelay(120, withTiming(0.9, { duration: 220 })), withDelay(700, withTiming(0, { duration: 900 })));
  }, [opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, styles.glow, { borderColor: accent.main, backgroundColor: accent.soft }, style]}
    />
  );
}

const styles = StyleSheet.create({
  glow: { borderRadius: radius.md, borderWidth: 1.5, margin: -4 },
});
