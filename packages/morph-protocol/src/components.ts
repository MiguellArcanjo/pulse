import * as z from "zod";
import { Description, IconName, Id, Label } from "./common.ts";
import { AggregateFn, Operand, Query, Value } from "./data.ts";

/**
 * Catálogo de componentes. A IA escolhe componente, variante, prioridade, dados e ação;
 * cor, espaçamento, tipografia e animação são do Design System do app.
 *
 * Todo nó tem um `id` estável dentro da tela: é por ele que o Motion Engine sabe que um
 * componente "é o mesmo" antes e depois de uma mudança.
 */

export const Priority = z.enum(["high", "normal", "low"]);
export type Priority = z.infer<typeof Priority>;

/** Referência a uma ação declarada em `AppSpec.actions`. */
const ActionId = Id;

type Base = { id: Id; priority?: Priority | undefined };

export type Node =
  | (Base & { type: "stack"; children: Node[] })
  | (Base & { type: "row"; children: Node[] })
  | (Base & { type: "section"; title: string; action?: Id | undefined; actionLabel?: string | undefined; children: Node[] })
  | (Base & { type: "card"; action?: Id | undefined; children: Node[] })
  | (Base & {
      type: "header";
      title: Value;
      subtitle?: Value | undefined;
      icon?: IconName | undefined;
      action?: Id | undefined;
      actionIcon?: IconName | undefined;
    })
  | (Base & {
      type: "hero_card";
      query?: Query | undefined;
      title: Value;
      subtitle?: Value | undefined;
      meta?: Value | undefined;
      action?: Id | undefined;
      empty?: { title: string; action?: Id | undefined } | undefined;
    })
  | (Base & { type: "heading"; text: Value })
  | (Base & { type: "text"; text: Value; variant: "body" | "secondary" | "caption" })
  | (Base & { type: "stat"; label: string; value: Value })
  | (Base & {
      type: "chart";
      variant: "bar";
      query: Query;
      groupBy: { field: Id; bucket: "weekday" | "day" | "week" | "month" };
      measure: { fn: AggregateFn; field?: Id | undefined };
    })
  | (Base & {
      type: "list";
      query: Query;
      item: { title: Value; subtitle?: Value | undefined; trailing?: Value | undefined; icon?: IconName | undefined };
      action?: Id | undefined;
      empty: string;
    })
  | (Base & { type: "repeat"; query: Query; inlineEdit: boolean; empty: string; children: Node[] })
  | (Base & { type: "badge"; text: Value; tone: "accent" | "neutral" | "positive" | "warning" })
  | (Base & { type: "progress"; value: Value; max: Value; label?: string | undefined })
  | (Base & { type: "divider" })
  | (Base & { type: "empty_state"; title: string; text?: string | undefined; action?: Id | undefined })
  | (Base & {
      type: "button";
      label: string;
      action: Id;
      variant: "primary" | "secondary" | "plain";
      icon?: IconName | undefined;
    })
  | (Base & {
      type: "form";
      entity: Id;
      mode: "create" | "edit";
      record?: Operand | undefined;
      defaults?: { field: Id; value: Operand }[] | undefined;
      submitLabel: string;
      onSaved?: Id | undefined;
      children: Node[];
    })
  | (Base & { type: "field_input"; field: Id; variant?: "default" | "stepper" | undefined });

export type ComponentType = Node["type"];

const base = { id: Id, priority: Priority.optional() };

export const Node: z.ZodType<Node> = z.lazy(() => {
  const children = z.array(Node).max(40);
  return z.discriminatedUnion("type", [
    z.object({ ...base, type: z.literal("stack"), children }).strict(),
    z.object({ ...base, type: z.literal("row"), children: z.array(Node).min(1).max(4) }).strict(),
    z
      .object({ ...base, type: z.literal("section"), title: Label, action: ActionId.optional(), actionLabel: Label.optional(), children })
      .strict(),
    z.object({ ...base, type: z.literal("card"), action: ActionId.optional(), children }).strict(),
    z
      .object({
        ...base,
        type: z.literal("header"),
        title: Value,
        subtitle: Value.optional(),
        icon: IconName.optional(),
        action: ActionId.optional(),
        actionIcon: IconName.optional(),
      })
      .strict(),
    z
      .object({
        ...base,
        type: z.literal("hero_card"),
        query: Query.optional(),
        title: Value,
        subtitle: Value.optional(),
        meta: Value.optional(),
        action: ActionId.optional(),
        empty: z.object({ title: Label, action: ActionId.optional() }).strict().optional(),
      })
      .strict(),
    z.object({ ...base, type: z.literal("heading"), text: Value }).strict(),
    z.object({ ...base, type: z.literal("text"), text: Value, variant: z.enum(["body", "secondary", "caption"]) }).strict(),
    z.object({ ...base, type: z.literal("stat"), label: Label, value: Value }).strict(),
    z
      .object({
        ...base,
        type: z.literal("chart"),
        variant: z.literal("bar"),
        query: Query,
        groupBy: z.object({ field: Id, bucket: z.enum(["weekday", "day", "week", "month"]) }).strict(),
        measure: z.object({ fn: AggregateFn, field: Id.optional() }).strict(),
      })
      .strict(),
    z
      .object({
        ...base,
        type: z.literal("list"),
        query: Query,
        item: z
          .object({ title: Value, subtitle: Value.optional(), trailing: Value.optional(), icon: IconName.optional() })
          .strict(),
        action: ActionId.optional(),
        empty: Label,
      })
      .strict(),
    z.object({ ...base, type: z.literal("repeat"), query: Query, inlineEdit: z.boolean(), empty: Label, children }).strict(),
    z
      .object({ ...base, type: z.literal("badge"), text: Value, tone: z.enum(["accent", "neutral", "positive", "warning"]) })
      .strict(),
    z.object({ ...base, type: z.literal("progress"), value: Value, max: Value, label: Label.optional() }).strict(),
    z.object({ ...base, type: z.literal("divider") }).strict(),
    z
      .object({ ...base, type: z.literal("empty_state"), title: Label, text: Description.optional(), action: ActionId.optional() })
      .strict(),
    z
      .object({
        ...base,
        type: z.literal("button"),
        label: Label,
        action: ActionId,
        variant: z.enum(["primary", "secondary", "plain"]),
        icon: IconName.optional(),
      })
      .strict(),
    z
      .object({
        ...base,
        type: z.literal("form"),
        entity: Id,
        mode: z.enum(["create", "edit"]),
        record: Operand.optional(),
        defaults: z.array(z.object({ field: Id, value: Operand }).strict()).max(20).optional(),
        submitLabel: Label,
        onSaved: ActionId.optional(),
        children,
      })
      .strict(),
    z
      .object({ ...base, type: z.literal("field_input"), field: Id, variant: z.enum(["default", "stepper"]).optional() })
      .strict(),
  ]);
});

/** Lista de componentes que existem. Qualquer outro `type` é rejeitado. */
export const COMPONENT_TYPES = [
  "stack",
  "row",
  "section",
  "card",
  "header",
  "hero_card",
  "heading",
  "text",
  "stat",
  "chart",
  "list",
  "repeat",
  "badge",
  "progress",
  "divider",
  "empty_state",
  "button",
  "form",
  "field_input",
] as const satisfies readonly ComponentType[];

/** Filhos diretos de um nó (vazio para componentes sem filhos). */
export function childrenOf(node: Node): readonly Node[] {
  return "children" in node ? node.children : [];
}
