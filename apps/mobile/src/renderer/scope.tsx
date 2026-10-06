import { createContext, useContext, type ReactNode } from "react";
import { formatResolved, resolveValue, type EvalContext, type RecordData, type StoredRecord } from "@morph/engine";
import type { Screen, Value } from "@morph/protocol";
import { useReady } from "../data/MorphProvider";

/**
 * Contexto de renderização de um nó: tela, parâmetros, item atual e, se houver,
 * o formulário em volta ou a edição direta (lista editável).
 */

export type FormApi = {
  entity: string;
  values: RecordData;
  set(field: string, value: unknown): void;
};

export type Scope = {
  screen: Screen;
  params: Readonly<Record<string, string>>;
  item?: StoredRecord | undefined;
  form?: FormApi | undefined;
  /** Item editável direto na tela (repeat com inlineEdit). */
  inlineEdit?: boolean;
};

const ScopeContext = createContext<Scope | null>(null);

export function ScopeProvider({ value, children }: { value: Scope; children: ReactNode }) {
  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

export function useScope(): Scope {
  const s = useContext(ScopeContext);
  if (!s) throw new Error("ScopeProvider ausente");
  return s;
}

/** Contexto de avaliação (engine) para o escopo atual. */
export function useEvalContext(item?: StoredRecord): EvalContext {
  const scope = useScope();
  const { snapshot, index } = useReady();
  if (!snapshot) throw new Error("sem spec");
  return { spec: snapshot.spec, records: index, now: new Date(), params: scope.params, item: item ?? scope.item };
}

/** Texto final de um valor declarado na spec. */
export function useValueText(value: Value | undefined, item?: StoredRecord): string | null {
  const ctx = useEvalContext(item);
  if (!value) return null;
  return formatResolved(resolveValue(value, ctx), ctx.now);
}
