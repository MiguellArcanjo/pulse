import DateTimePicker from "@react-native-community/datetimepicker";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Switch, TextInput, View } from "react-native";
import { formatDuration, formatNumber, localDateString, toDate, type RecordIndex } from "@morph/engine";
import type { AppSpec, Field } from "@morph/protocol";
import { UiIcon } from "../../design/icons";
import { Tap, Txt } from "../../design/primitives";
import { useTheme } from "../../design/theme";
import { radius, space } from "../../design/tokens";

/**
 * Um controle por tipo de campo. O renderer escolhe o controle pelo tipo; a IA só
 * escolhe a variante ("stepper" para números).
 */

type InputProps = {
  field: Field;
  value: unknown;
  onChange(value: unknown): void;
  /** Fim da edição (sair do campo, tocar em −/+): hora de gravar na edição direta. */
  onCommit?: () => void;
  variant?: "default" | "stepper" | undefined;
  spec: AppSpec;
  records: RecordIndex;
};

export function FieldControl(props: InputProps) {
  const { field } = props;
  const unit = "unit" in field && field.unit ? ` (${field.unit})` : "";
  const label = `${field.label}${unit}`;
  switch (field.type) {
    case "text":
    case "long_text":
      return (
        <Stacked label={label}>
          <TextField {...props} multiline={field.type === "long_text"} />
        </Stacked>
      );
    case "number":
    case "integer":
    case "duration":
      return (
        <Inline label={label}>
          <NumberField {...props} />
        </Inline>
      );
    case "boolean":
      return (
        <Inline label={label}>
          <BoolField {...props} />
        </Inline>
      );
    case "date":
    case "datetime":
      return (
        <Inline label={label}>
          <DateField {...props} />
        </Inline>
      );
    case "select":
      return (
        <Stacked label={label}>
          <Chips
            options={field.options.map((o) => ({ value: o.value, label: o.label }))}
            value={props.value}
            onChange={(v) => {
              props.onChange(v);
              props.onCommit?.();
            }}
          />
        </Stacked>
      );
    case "reference":
      return (
        <Stacked label={label}>
          <ReferenceField {...props} />
        </Stacked>
      );
    case "computed":
      return null;
  }
}

function Inline({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.inline}>
      <Txt variant="callout" tone="secondary" style={{ flex: 1 }}>
        {label}
      </Txt>
      {children}
    </View>
  );
}

function Stacked({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <Txt variant="footnote" tone="secondary">
        {label}
      </Txt>
      {children}
    </View>
  );
}

function useBox() {
  const { colors } = useTheme();
  return { backgroundColor: colors.surfaceStrong, color: colors.text, borderColor: colors.border };
}

function TextField({ value, onChange, onCommit, multiline }: InputProps & { multiline: boolean }) {
  const box = useBox();
  const { colors } = useTheme();
  return (
    <TextInput
      value={typeof value === "string" ? value : ""}
      onChangeText={(t) => onChange(t === "" ? null : t)}
      onEndEditing={onCommit}
      multiline={multiline}
      placeholderTextColor={colors.textTertiary}
      style={[styles.box, box, multiline && { minHeight: 90, textAlignVertical: "top" }]}
    />
  );
}

function parseNumber(text: string): number | null {
  const n = Number(text.replace(/\./g, "").replace(",", "."));
  return text.trim() === "" || Number.isNaN(n) ? null : n;
}

function NumberField({ field, value, onChange, onCommit, variant }: InputProps) {
  const box = useBox();
  const { accent } = useTheme();
  const num = typeof value === "number" ? value : null;
  const [text, setText] = useState(num === null ? "" : formatNumber(num));
  useEffect(() => setText(num === null ? "" : formatNumber(num)), [num]);

  const step = field.type === "number" ? (field.step ?? 1) : field.type === "duration" ? 5 : 1;
  const min = (field.type === "number" || field.type === "integer") && field.min !== undefined ? field.min : 0;
  const max = (field.type === "number" || field.type === "integer") && field.max !== undefined ? field.max : Infinity;
  const clamp = (n: number) => Math.min(max, Math.max(min, field.type === "number" ? n : Math.round(n)));

  const bump = (dir: 1 | -1) => {
    const next = clamp((num ?? (dir === 1 ? min - step : min)) + dir * step);
    onChange(next);
    onCommit?.();
  };

  const input = (
    <TextInput
      value={field.type === "duration" && num !== null ? formatDuration(num) : text}
      editable={field.type !== "duration"}
      keyboardType={field.type === "integer" ? "number-pad" : "decimal-pad"}
      onChangeText={(t) => {
        setText(t);
        const n = parseNumber(t);
        onChange(n === null ? null : clamp(n));
      }}
      onEndEditing={onCommit}
      style={[styles.box, box, styles.numberBox]}
    />
  );
  if (variant !== "stepper" && field.type !== "duration") return input;
  return (
    <View style={styles.stepper}>
      <Tap onPress={() => bump(-1)} style={styles.stepButton} accessibilityLabel="Diminuir">
        <UiIcon name="minus" size={18} color={accent.main} />
      </Tap>
      {input}
      <Tap onPress={() => bump(1)} style={styles.stepButton} accessibilityLabel="Aumentar">
        <UiIcon name="plus" size={18} color={accent.main} />
      </Tap>
    </View>
  );
}

function BoolField({ value, onChange, onCommit }: InputProps) {
  const { accent } = useTheme();
  return (
    <Switch
      value={value === true}
      trackColor={{ true: accent.main }}
      onValueChange={(v) => {
        onChange(v);
        onCommit?.();
      }}
    />
  );
}

function DateField({ field, value, onChange, onCommit }: InputProps) {
  const { accent, scheme } = useTheme();
  const date = toDate(value) ?? new Date();
  return (
    <DateTimePicker
      value={date}
      mode={field.type === "datetime" ? "datetime" : "date"}
      display="compact"
      locale="pt-BR"
      accentColor={accent.main}
      themeVariant={scheme}
      onValueChange={(_e, d) => {
        onChange(field.type === "datetime" ? d.toISOString() : localDateString(d));
        onCommit?.();
      }}
    />
  );
}

function ReferenceField({ field, value, onChange, onCommit, spec, records }: InputProps) {
  if (field.type !== "reference") return null;
  const target = spec.entities.find((e) => e.id === field.entity);
  const options = records.of(field.entity).map((r) => ({ value: r.id, label: String(r.data[target?.titleField ?? ""] ?? "—") }));
  if (options.length === 0)
    return (
      <Txt variant="footnote" tone="tertiary">
        Nenhum {target?.label.toLowerCase() ?? "registro"} cadastrado ainda.
      </Txt>
    );
  return (
    <Chips
      options={options}
      value={value}
      onChange={(v) => {
        onChange(v);
        onCommit?.();
      }}
    />
  );
}

function Chips({ options, value, onChange }: { options: { value: string; label: string }[]; value: unknown; onChange(v: string): void }) {
  const { accent, colors } = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Tap
            key={o.value}
            onPress={() => onChange(o.value)}
            style={[styles.chip, { backgroundColor: on ? accent.main : colors.surfaceStrong, borderColor: on ? accent.main : colors.border }]}
          >
            <Txt variant="footnote" tone={on ? "onAccent" : "primary"}>
              {o.label}
            </Txt>
          </Tap>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  inline: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 44 },
  box: { borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.md, paddingVertical: 10, fontSize: 16 },
  numberBox: { minWidth: 72, textAlign: "center", fontWeight: "600" },
  stepper: { flexDirection: "row", alignItems: "center", gap: space.xs },
  stepButton: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  chip: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth },
});
