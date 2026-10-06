import { StyleSheet, View } from "react-native";
import type { Node } from "@morph/protocol";
import { UiIcon } from "../../design/icons";
import { Surface, Tap, Txt } from "../../design/primitives";
import { useTheme } from "../../design/theme";
import { space } from "../../design/tokens";
import { useRunAction } from "../actions";
import { Children } from "../render-context";

type N<T extends Node["type"]> = Extract<Node, { type: T }>;

export function StackNode({ node }: { node: N<"stack"> }) {
  return (
    <View style={styles.stack}>
      <Children nodes={node.children} />
    </View>
  );
}

/** Lado a lado, larguras iguais (ex.: os três números do resumo). */
export function RowNode({ node }: { node: N<"row"> }) {
  return (
    <View style={styles.row}>
      {node.children.map((c) => (
        <View key={c.id} style={styles.rowCell}>
          <Children nodes={[c]} />
        </View>
      ))}
    </View>
  );
}

export function SectionNode({ node }: { node: N<"section"> }) {
  const run = useRunAction();
  const { colors } = useTheme();
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Txt variant="callout" style={{ fontWeight: "600" }}>
          {node.title}
        </Txt>
        {node.action && (
          <Tap onPress={() => run(node.action as string)} style={styles.sectionLink}>
            <Txt variant="footnote" tone="secondary">
              {node.actionLabel ?? "Ver todos"}
            </Txt>
            <UiIcon name="chevron-right" size={16} color={colors.textSecondary} />
          </Tap>
        )}
      </View>
      <Children nodes={node.children} />
    </View>
  );
}

export function CardNode({ node }: { node: N<"card"> }) {
  const run = useRunAction();
  const body = (
    <Surface style={styles.card}>
      <Children nodes={node.children} />
    </Surface>
  );
  return node.action ? <Tap onPress={() => run(node.action as string)}>{body}</Tap> : body;
}

export function DividerNode() {
  const { colors } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />;
}

const styles = StyleSheet.create({
  stack: { gap: space.md },
  row: { flexDirection: "row", gap: space.sm },
  rowCell: { flex: 1 },
  section: { gap: space.md },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionLink: { flexDirection: "row", alignItems: "center", gap: 2 },
  card: { gap: space.md },
});
