import * as z from "zod";
import { Id } from "./common.ts";

/**
 * Consultas e valores declarativos. É assim que uma tela diz "quais dados mostrar"
 * sem escrever código: o app (e o servidor) interpretam estas estruturas.
 *
 * "Item" é o registro do contexto atual: a linha de uma lista, o registro de uma tela
 * de detalhe ou o registro recém-salvo por um formulário.
 */

/** Intervalos de tempo relativos a "agora". */
export const Period = z.enum(["today", "this_week", "last_7_days", "this_month", "last_30_days"]);
export type Period = z.infer<typeof Period>;

/** De onde vem o valor de um filtro ou de um parâmetro. */
export const Operand = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("literal"), value: z.union([z.string().max(200), z.number(), z.boolean(), z.null()]) }).strict(),
  /** Parâmetro da tela atual (ex.: o id do treino aberto). */
  z.object({ kind: z.literal("param"), param: Id }).strict(),
  /** Id do item do contexto. */
  z.object({ kind: z.literal("item_id") }).strict(),
  /** Valor de um campo do item do contexto. */
  z.object({ kind: z.literal("item_field"), field: Id }).strict(),
  /** Data de hoje (ex.: valor inicial do campo "data" de um treino novo). */
  z.object({ kind: z.literal("today") }).strict(),
]);
export type Operand = z.infer<typeof Operand>;

export const Condition = z.discriminatedUnion("op", [
  z.object({ op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte"]), field: Id, value: Operand }).strict(),
  /** Campo de data dentro de um período. */
  z.object({ op: z.literal("within"), field: Id, period: Period }).strict(),
  z.object({ op: z.enum(["is_empty", "not_empty"]), field: Id }).strict(),
]);
export type Condition = z.infer<typeof Condition>;

export const Query = z
  .object({
    entity: Id,
    where: z.array(Condition).max(8).optional(),
    sort: z.object({ field: Id, dir: z.enum(["asc", "desc"]) }).strict().optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();
export type Query = z.infer<typeof Query>;

export const AggregateFn = z.enum(["count", "sum", "avg", "min", "max"]);
export type AggregateFn = z.infer<typeof AggregateFn>;

/** Como exibir um valor. O formato exato (casas decimais, idioma) é do app. */
export const ValueFormat = z.enum(["plain", "number", "compact", "percent", "date", "relative_date", "duration"]);
export type ValueFormat = z.infer<typeof ValueFormat>;

/**
 * Um valor exibível. Caminho de campo: `["nome"]` lê o campo do item;
 * `["exercicio", "nome"]` segue a referência `exercicio` e lê `nome` do outro registro.
 */
export type Value =
  | { kind: "text"; text: string }
  | { kind: "field"; path: [Id] | [Id, Id]; format?: ValueFormat | undefined }
  | { kind: "param"; param: Id }
  /** `noun` dá nome ao número com singular e plural: 1 série, 3 séries. */
  | {
      kind: "aggregate";
      fn: AggregateFn;
      query: Query;
      field?: Id | undefined;
      format?: ValueFormat | undefined;
      noun?: { one: string; other: string } | undefined;
    }
  /** Variação percentual do agregado entre o período atual e o anterior. */
  | { kind: "trend"; fn: AggregateFn; query: Query; field?: Id | undefined; dateField: Id; period: "week" | "month" }
  | { kind: "join"; parts: Value[]; separator?: string | undefined };

export const Value: z.ZodType<Value> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("text"), text: z.string().min(1).max(120) }).strict(),
    z
      .object({
        kind: z.literal("field"),
        path: z.union([z.tuple([Id]), z.tuple([Id, Id])]),
        format: ValueFormat.optional(),
      })
      .strict(),
    z.object({ kind: z.literal("param"), param: Id }).strict(),
    z
      .object({
        kind: z.literal("aggregate"),
        fn: AggregateFn,
        query: Query,
        field: Id.optional(),
        format: ValueFormat.optional(),
        noun: z.object({ one: z.string().min(1).max(30), other: z.string().min(1).max(30) }).strict().optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("trend"),
        fn: AggregateFn,
        query: Query,
        field: Id.optional(),
        dateField: Id,
        period: z.enum(["week", "month"]),
      })
      .strict(),
    z
      .object({
        kind: z.literal("join"),
        parts: z.array(Value).min(1).max(6),
        separator: z.string().max(5).optional(),
      })
      .strict(),
  ]),
);
