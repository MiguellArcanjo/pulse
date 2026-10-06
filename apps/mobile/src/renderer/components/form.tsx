import { useMemo, useRef, useState } from "react";
import { Alert, StyleSheet } from "react-native";
import { recordSchema, resolveOperand, type RecordData, type StoredRecord } from "@morph/engine";
import type { Node } from "@morph/protocol";
import { Surface, Tap, Txt } from "../../design/primitives";
import { useTheme } from "../../design/theme";
import { radius, space } from "../../design/tokens";
import { describeError, useReady } from "../../data/MorphProvider";
import { useRunAction } from "../actions";
import { Children } from "../render-context";
import { ScopeProvider, useEvalContext, useScope, type FormApi } from "../scope";
import { FieldControl } from "./inputs";

type N<T extends Node["type"]> = Extract<Node, { type: T }>;

/** Remove vazios antes de validar (campo opcional em branco = não informado). */
function clean(values: RecordData): RecordData {
  return Object.fromEntries(Object.entries(values).filter(([, v]) => v !== null && v !== undefined && v !== ""));
}

export function FormNode({ node }: { node: N<"form"> }) {
  const scope = useScope();
  const ctx = useEvalContext();
  const run = useRunAction();
  const { snapshot, createRecord, updateRecord } = useReady();
  const { accent } = useTheme();
  const entity = snapshot?.spec.entities.find((e) => e.id === node.entity);

  const editing = node.mode === "edit" && node.record ? ctx.records.get(String(resolveOperand(node.record, ctx))) : undefined;
  const initial = useMemo<RecordData>(() => {
    if (editing) return { ...editing.data };
    const v: RecordData = {};
    for (const d of node.defaults ?? []) v[d.field] = resolveOperand(d.value, ctx);
    return v;
    // Valores iniciais só na abertura do formulário.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [values, setValues] = useState<RecordData>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const form: FormApi = {
    entity: node.entity,
    values,
    set: (field, value) => setValues((v) => ({ ...v, [field]: value })),
  };

  if (!entity) return null;

  const submit = async () => {
    setError(null);
    const data = clean(values);
    const check = recordSchema(entity, editing ? "update" : "create").safeParse(data);
    if (!check.success) {
      const issue = check.error.issues[0];
      const field = entity.fields.find((f) => f.id === issue?.path[0]);
      setError(field ? `Confira "${field.label}".` : "Confira os campos.");
      return;
    }
    setSaving(true);
    try {
      const row = editing ? await updateRecord(editing.id, data) : await createRecord(entity.id, data);
      const saved: StoredRecord = { id: row.id, entity: row.entity, data: row.data, createdAt: row.createdAt, updatedAt: row.updatedAt };
      if (node.onSaved) run(node.onSaved, saved);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScopeProvider value={{ ...scope, form }}>
      <Surface style={{ gap: space.lg }}>
        <Children nodes={node.children} />
      </Surface>
      {error && (
        <Txt variant="footnote" tone="danger">
          {error}
        </Txt>
      )}
      <Tap onPress={saving ? undefined : () => void submit()} style={[styles.submit, { backgroundColor: accent.main }]}>
        <Txt variant="headline" tone="onAccent">
          {saving ? "Salvando…" : node.submitLabel}
        </Txt>
      </Tap>
    </ScopeProvider>
  );
}

/** Campo de entrada: dentro de formulário ou editando direto o item de uma lista editável. */
export function FieldInputNode({ node }: { node: N<"field_input"> }) {
  const scope = useScope();
  const { snapshot, index, updateRecord } = useReady();
  const item = scope.item;
  const entityId = scope.form?.entity ?? (scope.inlineEdit ? item?.entity : undefined);
  const field = snapshot?.spec.entities.find((e) => e.id === entityId)?.fields.find((f) => f.id === node.field);
  const [draft, setDraft] = useState<unknown>(undefined);
  const pending = useRef<unknown>(undefined);

  if (!snapshot || !field || field.status !== "active") return null;

  if (scope.form) {
    const form = scope.form;
    return (
      <FieldControl
        field={field}
        value={form.values[field.id] ?? null}
        onChange={(v) => form.set(field.id, v)}
        variant={node.variant}
        spec={snapshot.spec}
        records={index}
      />
    );
  }

  if (!item) return null;
  // Edição direta: mostra o rascunho enquanto edita e grava ao terminar.
  const value = draft !== undefined ? draft : (item.data[field.id] ?? null);
  return (
    <FieldControl
      field={field}
      value={value}
      onChange={(v) => {
        pending.current = v;
        setDraft(v);
      }}
      onCommit={() => {
        const v = pending.current;
        if (v === undefined) return;
        pending.current = undefined;
        updateRecord(item.id, { [field.id]: v })
          .then(() => setDraft(undefined))
          .catch((err: unknown) => {
            setDraft(undefined);
            Alert.alert("Não salvo", describeError(err));
          });
      }}
      variant={node.variant}
      spec={snapshot.spec}
      records={index}
    />
  );
}

const styles = StyleSheet.create({
  submit: { height: 52, borderRadius: radius.md, alignItems: "center", justifyContent: "center", marginTop: space.sm },
});

