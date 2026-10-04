// Peças visuais compartilhadas pelas telas do Pulse Mobile.

import type { ComponentProps, ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import { colors, radius } from "./theme";

export type IconName = ComponentProps<typeof Ionicons>["name"];

export function Screen(props: { title?: string; subtitle?: string; children: ReactNode; header?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.screenContent, { paddingTop: insets.top + 12 }]}
      contentInsetAdjustmentBehavior="never"
      keyboardShouldPersistTaps="handled"
    >
      {props.title && <Text style={styles.title} accessibilityRole="header">{props.title}</Text>}
      {props.subtitle && <Text style={styles.subtitle}>{props.subtitle}</Text>}
      {props.header}
      {props.children}
    </ScrollView>
  );
}

export function Card(props: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, props.style]}>{props.children}</View>;
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text style={styles.section}>{children}</Text>;
}

export function Bar({ percent, color = colors.blue }: { percent: number; color?: string }) {
  return (
    <View style={styles.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(percent) }}>
      <View style={[styles.fill, { width: `${Math.min(100, Math.max(0, percent))}%`, backgroundColor: color }]} />
    </View>
  );
}

export function Pill(props: { label: string; tone: "ok" | "warn" | "bad" | "dim" }) {
  const fg = { ok: colors.green, warn: colors.amber, bad: colors.red, dim: colors.dim }[props.tone];
  const bg = { ok: colors.greenSoft, warn: colors.amberSoft, bad: colors.redSoft, dim: colors.track }[props.tone];
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <View style={[styles.dot, { backgroundColor: fg }]} />
      <Text style={[styles.pillText, { color: fg }]}>{props.label}</Text>
    </View>
  );
}

export function Button(props: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  busy?: boolean;
  icon?: IconName;
}) {
  const variant = props.variant ?? "primary";
  const bg = { primary: colors.blue, secondary: colors.card, danger: colors.redSoft }[variant];
  const fg = { primary: "#fff", secondary: colors.text, danger: colors.red }[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: props.disabled || props.busy }}
      disabled={props.disabled || props.busy}
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        props.onPress();
      }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg },
        variant === "secondary" && styles.buttonBorder,
        pressed && styles.pressed,
        (props.disabled || props.busy) && styles.disabled,
      ]}
    >
      {props.busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={styles.buttonInner}>
          {props.icon && <Ionicons name={props.icon} size={18} color={fg} />}
          <Text style={[styles.buttonText, { color: fg }]}>{props.label}</Text>
        </View>
      )}
    </Pressable>
  );
}

export function ListRow(props: {
  icon: IconName;
  label: string;
  detail?: string;
  badge?: string;
  onPress?: () => void;
}) {
  const disabled = !props.onPress;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={props.onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed, disabled && styles.rowDisabled]}
    >
      <Ionicons name={props.icon} size={20} color={disabled ? colors.faint : colors.blueSoft} />
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, disabled && { color: colors.dim }]}>{props.label}</Text>
        {props.detail && <Text style={styles.rowDetail}>{props.detail}</Text>}
      </View>
      {props.badge && <Text style={styles.badge}>{props.badge}</Text>}
      {!disabled && <Ionicons name="chevron-forward" size={18} color={colors.faint} />}
    </Pressable>
  );
}

/** Aba de um módulo que ainda não existe: deixa claro em que etapa chega. */
export function ComingSoon(props: { title: string; milestone: string; icon: IconName; items: string[] }) {
  return (
    <Screen title={props.title}>
      <Card style={styles.soon}>
        <Ionicons name={props.icon} size={36} color={colors.blueSoft} />
        <Text style={styles.soonTitle}>Chega no {props.milestone}</Text>
        {props.items.map((i) => (
          <Text key={i} style={styles.soonItem}>
            • {i}
          </Text>
        ))}
      </Card>
    </Screen>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  screenContent: { paddingHorizontal: 16, paddingBottom: 32, gap: 12 },
  title: { color: colors.text, fontSize: 32, fontWeight: "700" },
  subtitle: { color: colors.dim, fontSize: 15, marginTop: -6 },
  section: { color: colors.dim, fontSize: 13, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.6, marginTop: 8 },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.card,
    padding: 16,
    gap: 8,
  },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.track, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 3 },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, alignSelf: "flex-start" },
  dot: { width: 7, height: 7, borderRadius: 4 },
  pillText: { fontSize: 13, fontWeight: "600" },
  button: { borderRadius: radius.control, paddingVertical: 13, paddingHorizontal: 16, alignItems: "center", justifyContent: "center", minHeight: 48 },
  buttonBorder: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  buttonInner: { flexDirection: "row", alignItems: "center", gap: 8 },
  buttonText: { fontSize: 16, fontWeight: "600" },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.45 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, paddingHorizontal: 16, backgroundColor: colors.card },
  rowPressed: { backgroundColor: colors.cardPressed },
  rowDisabled: { opacity: 0.7 },
  rowText: { flex: 1 },
  rowLabel: { color: colors.text, fontSize: 16 },
  rowDetail: { color: colors.dim, fontSize: 13, marginTop: 2 },
  badge: { color: colors.faint, fontSize: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  soon: { alignItems: "center", paddingVertical: 28, gap: 10 },
  soonTitle: { color: colors.text, fontSize: 18, fontWeight: "600" },
  soonItem: { color: colors.dim, fontSize: 15, alignSelf: "stretch" },
});
