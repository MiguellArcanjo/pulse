import * as z from "zod";
import { Description, Id, Label } from "./common.ts";

/**
 * Campos que todo registro tem e que nenhuma entidade pode declarar.
 * Podem ser usados em filtros, ordenação e gráficos.
 */
export const SYSTEM_FIELDS = ["id", "created_at", "updated_at"] as const;
export type SystemField = (typeof SYSTEM_FIELDS)[number];

export const FieldStatus = z.enum(["active", "archived"]);

/**
 * Fórmula de um campo calculado: só as quatro operações sobre campos numéricos e
 * constantes. Não é código: é uma árvore que o engine avalia.
 */
export type Formula =
  | { op: "field"; field: Id }
  | { op: "const"; value: number }
  | { op: "add" | "sub" | "mul" | "div"; args: [Formula, Formula] };

export const Formula: z.ZodType<Formula> = z.lazy(() =>
  z.discriminatedUnion("op", [
    z.object({ op: z.literal("field"), field: Id }).strict(),
    z.object({ op: z.literal("const"), value: z.number() }).strict(),
    z
      .object({
        op: z.enum(["add", "sub", "mul", "div"]),
        args: z.tuple([Formula, Formula]),
      })
      .strict(),
  ]),
);

const fieldBase = {
  id: Id,
  label: Label,
  description: Description.optional(),
  required: z.boolean(),
  status: FieldStatus,
};

const Unit = z.string().trim().min(1).max(12);

export const SelectOption = z.object({ value: Id, label: Label }).strict();

export const Field = z.discriminatedUnion("type", [
  z.object({ ...fieldBase, type: z.literal("text"), maxLength: z.number().int().min(1).max(500).optional() }).strict(),
  z.object({ ...fieldBase, type: z.literal("long_text") }).strict(),
  z
    .object({
      ...fieldBase,
      type: z.literal("number"),
      unit: Unit.optional(),
      min: z.number().optional(),
      max: z.number().optional(),
      step: z.number().positive().optional(),
    })
    .strict(),
  z
    .object({
      ...fieldBase,
      type: z.literal("integer"),
      unit: Unit.optional(),
      min: z.number().int().optional(),
      max: z.number().int().optional(),
    })
    .strict(),
  z.object({ ...fieldBase, type: z.literal("boolean") }).strict(),
  z.object({ ...fieldBase, type: z.literal("date") }).strict(),
  z.object({ ...fieldBase, type: z.literal("datetime") }).strict(),
  /** Duração em minutos. */
  z.object({ ...fieldBase, type: z.literal("duration") }).strict(),
  z
    .object({ ...fieldBase, type: z.literal("select"), options: z.array(SelectOption).min(1).max(50) })
    .strict(),
  /** Aponta para um registro de outra entidade (ex.: Série → Exercício). */
  z.object({ ...fieldBase, type: z.literal("reference"), entity: Id }).strict(),
  /** Calculado a partir de outros campos do mesmo registro; nunca é digitado. */
  z.object({ ...fieldBase, type: z.literal("computed"), formula: Formula, unit: Unit.optional() }).strict(),
]);
export type Field = z.infer<typeof Field>;
export type FieldType = Field["type"];

export const Entity = z
  .object({
    id: Id,
    toolId: Id,
    label: Label,
    labelPlural: Label,
    /** Campo usado como título do registro em listas e seletores. */
    titleField: Id,
    fields: z.array(Field).min(1).max(60),
  })
  .strict();
export type Entity = z.infer<typeof Entity>;

/** Tipos de campo que guardam número (podem ser somados, ter média etc.). */
export const NUMERIC_FIELD_TYPES: readonly FieldType[] = ["number", "integer", "duration", "computed"];
/** Tipos de campo que guardam data. */
export const DATE_FIELD_TYPES: readonly FieldType[] = ["date", "datetime"];
