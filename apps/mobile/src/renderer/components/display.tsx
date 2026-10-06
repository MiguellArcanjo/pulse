import { StyleSheet, View } from "react-native";
import { resolveValue, runQuery } from "@morph/engine";
import type { Node } from "@morph/protocol";
import { Icon } from "../../design/icons";
import { RoundButton, Surface, Tap, Txt } from "../../design/primitives";
import { useTheme } from "../../design/theme";
import { radius, space } from "../../design/tokens";
import { useRunAction } from "../actions";
import { useEvalContext, useValueText } from "../scope";

type N<T extends Node["type"]> = Extract<Node, { type: T }>;

/** Cabeçalho da ferramenta (mockup 3: ícone, título grande, subtítulo e botão redondo). */
export function HeaderNode({ node }: { node: N<"header"> }) {
  const run = useRunAction();
  const { accent } = useTheme();
  const title = useValueText(node.title);
  const subtitle = useValueText(node.subtitle);
  return (
    <View style={styles.header}>
      <View style={{ flex: 1, gap: space.xs }}>
        {node.icon && <Icon name={node.icon} size={34} color={accent.main} />}
        <Txt variant="largeTitle" numberOfLines={2}>
          {title}
        </Txt>
        {subtitle && <Txt tone="secondary">{subtitle}</Txt>}
      </View>
      {node.action && (
        <RoundButton label="Ação" onPress={() => run(node.action as string)}>
          <Icon name={node.actionIcon ?? "plus"} color="#FFFFFF" />
        </RoundButton>
      )}
    </View>
  );
}

/** Cartão de destaque (ex.: "Treino de hoje" com ▶). Mostra o primeiro resultado da consulta. */
export function HeroCardNode({ node }: { node: N<"hero_card"> }) {
  const run = useRunAction();
  const ctx = useEvalContext();
  const item = node.query ? runQuery(node.query, ctx)[0] : ctx.item;
  const title = useValueText(node.title, item);
  const subtitle = useValueText(node.subtitle, item);
  const meta = useValueText(node.meta, item);

  if (node.query && !item) {
    return (
      <Surface glow style={styles.hero}>
        <View style={{ flex: 1, gap: space.xs }}>
          <Txt variant="headline">{node.empty?.title ?? "Nada por aqui"}</Txt>
        </View>
        {node.empty?.action && (
          <RoundButton label={node.empty.title} onPress={() => run(node.empty?.action as string)}>
            <Icon name="plus" color="#FFFFFF" />
          </RoundButton>
        )}
      </Surface>
    );
  }
  return (
    <Tap onPress={node.action ? () => run(node.action as string, item) : undefined}>
      <Surface glow style={styles.hero}>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="headline">{title}</Txt>
          {subtitle && (
            <Txt variant="footnote" tone="secondary" style={{ marginTop: space.xs }}>
              {subtitle}
            </Txt>
          )}
          {meta && (
            <Txt variant="footnote" tone="tertiary">
              {meta}
            </Txt>
          )}
        </View>
        {node.action && (
          <RoundButton label="Abrir" onPress={() => run(node.action as string, item)}>
            <Icon name="play" color="#FFFFFF" />
          </RoundButton>
        )}
      </Surface>
    </Tap>
  );
}

export function HeadingNode({ node }: { node: N<"heading"> }) {
  return <Txt variant="headline">{useValueText(node.text)}</Txt>;
}

export function TextNode({ node }: { node: N<"text"> }) {
  const text = useValueText(node.text);
  const variant = node.variant === "caption" ? "footnote" : "body";
  return (
    <Txt variant={variant} tone={node.variant === "body" ? "primary" : "secondary"}>
      {text}
    </Txt>
  );
}

/** Número de resumo (ex.: "3 treinos", "12,4 t volume"). */
export function StatNode({ node }: { node: N<"stat"> }) {
  const value = useValueText(node.value);
  return (
    <Surface style={styles.stat}>
      <Txt variant="stat" numberOfLines={1}>
        {value}
      </Txt>
      <Txt variant="caption" tone="secondary" numberOfLines={1}>
        {node.label}
      </Txt>
    </Surface>
  );
}

export function BadgeNode({ node }: { node: N<"badge"> }) {
  const { accent, colors } = useTheme();
  const text = useValueText(node.text);
  const bg = node.tone === "accent" ? accent.soft : node.tone === "positive" ? "rgba(52,211,153,0.16)" : node.tone === "warning" ? "rgba(250,204,21,0.16)" : colors.surfaceStrong;
  const tone = node.tone === "accent" ? "accent" : node.tone === "positive" ? "positive" : "secondary";
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Txt variant="caption" tone={tone}>
        {text}
      </Txt>
    </View>
  );
}

export function ProgressNode({ node }: { node: N<"progress"> }) {
  const { accent, colors } = useTheme();
  const ctx = useEvalContext();
  const value = useValueText(node.value);
  const max = useValueText(node.max);
  const raw = (v: typeof node.value) => {
    const r = resolveValue(v, ctx);
    return r.kind === "number" || r.kind === "percent" ? r.value : 0;
  };
  const total = raw(node.max);
  const ratio = total > 0 ? Math.max(0, Math.min(1, raw(node.value) / total)) : 0;
  return (
    <View style={{ gap: space.xs }}>
      {node.label && (
        <View style={styles.progressHead}>
          <Txt variant="footnote" tone="secondary">
            {node.label}
          </Txt>
          <Txt variant="footnote" tone="secondary">
            {value} / {max}
          </Txt>
        </View>
      )}
      <View style={[styles.track, { backgroundColor: colors.surfaceStrong }]}>
        <View style={[styles.fill, { width: `${ratio * 100}%`, backgroundColor: accent.main }]} />
      </View>
    </View>
  );
}

export function EmptyStateNode({ node }: { node: N<"empty_state"> }) {
  const run = useRunAction();
  return (
    <Surface style={{ alignItems: "center", gap: space.sm, paddingVertical: space.xl }}>
      <Txt variant="headline">{node.title}</Txt>
      {node.text && (
        <Txt tone="secondary" style={{ textAlign: "center" }}>
          {node.text}
        </Txt>
      )}
      {node.action && (
        <Tap onPress={() => run(node.action as string)}>
          <Txt tone="accent">Começar</Txt>
        </Tap>
      )}
    </Surface>
  );
}

export function ButtonNode({ node }: { node: N<"button"> }) {
  const run = useRunAction();
  const { accent, colors } = useTheme();
  const primary = node.variant === "primary";
  const style =
    node.variant === "plain"
      ? styles.plainButton
      : [styles.button, { backgroundColor: primary ? accent.main : colors.surfaceStrong }];
  return (
    <Tap onPress={() => run(node.action)} style={style}>
      {node.icon && <Icon name={node.icon} size={18} color={primary ? "#FFFFFF" : accent.main} />}
      <Txt variant="callout" tone={primary ? "onAccent" : "accent"}>
        {node.label}
      </Txt>
    </Tap>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "flex-end", gap: space.md },
  hero: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.xl },
  stat: { alignItems: "center", gap: 2, paddingVertical: space.md, paddingHorizontal: space.sm },
  badge: { alignSelf: "flex-start", paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.pill },
  progressHead: { flexDirection: "row", justifyContent: "space-between" },
  track: { height: 6, borderRadius: radius.pill, overflow: "hidden" },
  fill: { height: "100%", borderRadius: radius.pill },
  button: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm, height: 50, borderRadius: radius.md },
  plainButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.xs, height: 40 },
});
