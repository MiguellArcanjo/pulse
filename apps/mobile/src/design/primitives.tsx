import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "./theme";
import { GUTTER, radius, space, type as typeScale } from "./tokens";

type TextVariant = keyof typeof typeScale;
type TextTone = "primary" | "secondary" | "tertiary" | "accent" | "danger" | "positive" | "onAccent";

export function Txt({
  variant = "body",
  tone = "primary",
  style,
  numberOfLines,
  children,
}: {
  variant?: TextVariant;
  tone?: TextTone;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  children: ReactNode;
}) {
  const { colors, accent } = useTheme();
  const color = {
    primary: colors.text,
    secondary: colors.textSecondary,
    tertiary: colors.textTertiary,
    accent: accent.main,
    danger: colors.danger,
    positive: colors.positive,
    onAccent: "#FFFFFF",
  }[tone];
  return (
    <Text style={[typeScale[variant], { color }, style]} numberOfLines={numberOfLines}>
      {children}
    </Text>
  );
}

/** Superfície translúcida (cartões). `glow` adiciona o brilho suave da cor da ferramenta. */
export function Surface({
  children,
  style,
  glow = false,
  padded = true,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  glow?: boolean;
  padded?: boolean;
}) {
  const { colors, accent, scheme } = useTheme();
  return (
    <View style={[styles.surface, { backgroundColor: colors.surface, borderColor: colors.border }, padded && styles.padded, style]}>
      {glow && (
        <LinearGradient
          colors={[accent.soft, scheme === "dark" ? "rgba(0,0,0,0)" : "rgba(255,255,255,0)"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      )}
      {children}
    </View>
  );
}

/** Área tocável com leve retorno visual e tátil. */
export function Tap({
  onPress,
  children,
  style,
  disabled,
  haptic = true,
  accessibilityLabel,
}: {
  onPress?: (() => void) | undefined;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  haptic?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled || !onPress}
      onPress={() => {
        if (haptic) void Haptics.selectionAsync();
        onPress?.();
      }}
      style={({ pressed }) => [style, pressed && { opacity: 0.7, transform: [{ scale: 0.98 }] }, disabled && { opacity: 0.4 }]}
    >
      {children}
    </Pressable>
  );
}

/** Botão redondo na cor da ferramenta (ex.: + e ▶ dos mockups). */
export function RoundButton({ children, onPress, size = 44, label }: { children: ReactNode; onPress?: () => void; size?: number; label: string }) {
  const { accent } = useTheme();
  return (
    <Tap onPress={onPress} accessibilityLabel={label} style={[styles.round, { width: size, height: size, backgroundColor: accent.main }]}>
      {children}
    </Tap>
  );
}

/** Tela padrão: fundo, margens seguras e rolagem. */
export function ScreenScroll({
  children,
  bottomInset = 0,
  topInset = true,
}: {
  children: ReactNode;
  bottomInset?: number;
  /** false quando já existe uma barra no topo cuidando da área segura. */
  topInset?: boolean;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ paddingTop: (topInset ? insets.top : 0) + space.lg, paddingBottom: insets.bottom + space.xxl + bottomInset, paddingHorizontal: GUTTER, gap: space.xl }}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  surface: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  padded: { padding: space.lg },
  round: { borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
});
