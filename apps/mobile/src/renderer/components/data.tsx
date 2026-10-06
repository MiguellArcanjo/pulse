import { StyleSheet, View } from "react-native";
import { chartBuckets, runQuery, type StoredRecord } from "@morph/engine";
import type { Node } from "@morph/protocol";
import { Icon, UiIcon } from "../../design/icons";
import { Surface, Tap, Txt } from "../../design/primitives";
import { useTheme } from "../../design/theme";
import { radius, space } from "../../design/tokens";
import { useRunAction } from "../actions";
import { Children } from "../render-context";
import { ScopeProvider, useEvalContext, useScope, useValueText } from "../scope";

type N<T extends Node["type"]> = Extract<Node, { type: T }>;

const CHART_HEIGHT = 44;
const STUB = 4;

/**
 * Barras (mockup 3, "Semana"): barras soltas, sem cartão. Dia sem registro vira um
 * tracinho; o dia atual fica na cor cheia da ferramenta.
 */
export function ChartNode({ node }: { node: N<"chart"> }) {
  const ctx = useEvalContext();
  const { accent, colors } = useTheme();
  const buckets = chartBuckets(runQuery(node.query, ctx), node.groupBy, node.measure, ctx);
  const max = Math.max(1, ...buckets.map((b) => b.value));
  return (
    <View style={styles.chart}>
      {buckets.map((b) => (
        <View key={b.key} style={styles.barCol}>
          <View style={styles.barArea}>
            <View
              style={[
                styles.bar,
                b.value > 0
                  ? { height: Math.max(STUB * 2, (b.value / max) * CHART_HEIGHT), backgroundColor: accent.main, opacity: b.current ? 1 : 0.55 }
                  : { height: STUB, backgroundColor: colors.surfaceStrong },
              ]}
            />
          </View>
          <Txt variant="caption" tone={b.current ? "primary" : "tertiary"}>
            {b.label}
          </Txt>
        </View>
      ))}
    </View>
  );
}

function ListRow({ node, item }: { node: N<"list">; item: StoredRecord }) {
  const run = useRunAction();
  const { accent, colors } = useTheme();
  const title = useValueText(node.item.title, item);
  const subtitle = useValueText(node.item.subtitle, item);
  const trailing = useValueText(node.item.trailing, item);
  return (
    <Tap onPress={node.action ? () => run(node.action as string, item) : undefined}>
      <Surface style={styles.listRow}>
        {node.item.icon && (
          <View style={[styles.listIcon, { backgroundColor: accent.soft }]}>
            <Icon name={node.item.icon} size={20} color={accent.main} />
          </View>
        )}
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="callout" numberOfLines={1}>
            {title}
          </Txt>
          {subtitle && (
            <Txt variant="footnote" tone="secondary" numberOfLines={1}>
              {subtitle}
            </Txt>
          )}
        </View>
        {trailing && (
          <Txt variant="footnote" tone="secondary">
            {trailing}
          </Txt>
        )}
        {node.action && <UiIcon name="chevron-right" size={20} color={colors.textTertiary} />}
      </Surface>
    </Tap>
  );
}

export function ListNode({ node }: { node: N<"list"> }) {
  const rows = runQuery(node.query, useEvalContext());
  if (rows.length === 0) return <EmptyLine text={node.empty} />;
  return (
    <View style={{ gap: space.sm }}>
      {rows.map((r) => (
        <ListRow key={r.id} node={node} item={r} />
      ))}
    </View>
  );
}

/** Repete os filhos para cada registro; com `inlineEdit`, os campos editam o registro direto. */
export function RepeatNode({ node }: { node: N<"repeat"> }) {
  const scope = useScope();
  const rows = runQuery(node.query, useEvalContext());
  if (rows.length === 0) return <EmptyLine text={node.empty} />;
  return (
    <View style={{ gap: space.md }}>
      {rows.map((r) => (
        <ScopeProvider key={r.id} value={{ ...scope, item: r, form: undefined, inlineEdit: node.inlineEdit }}>
          <Children nodes={node.children} />
        </ScopeProvider>
      ))}
    </View>
  );
}

function EmptyLine({ text }: { text: string }) {
  return (
    <Txt variant="footnote" tone="tertiary" style={{ paddingVertical: space.sm }}>
      {text}
    </Txt>
  );
}

const styles = StyleSheet.create({
  chart: { flexDirection: "row", justifyContent: "space-between" },
  barCol: { alignItems: "center", gap: space.sm, flex: 1 },
  barArea: { height: CHART_HEIGHT, justifyContent: "flex-end" },
  bar: { width: 8, borderRadius: radius.pill },
  listRow: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md },
  listIcon: { width: 38, height: 38, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
});
