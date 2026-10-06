import * as z from "zod";
import type { Entity, Field, Formula } from "@morph/protocol";

/**
 * Registros: os dados que o usuário guarda nas ferramentas (um treino, uma série...).
 * São gravados como JSON, com o id de cada campo como chave. O schema de validação é
 * montado a partir da Entity em tempo de execução, então muda junto com a spec.
 */
export type RecordData = Record<string, unknown>;

/** Ids de registro são UUIDs gerados pelo servidor. */
export const RecordId = z.uuid();

function fieldSchema(field: Field): z.ZodType | undefined {
  switch (field.type) {
    case "text":
      return z.string().trim().min(1).max(field.maxLength ?? 500);
    case "long_text":
      return z.string().trim().min(1).max(10_000);
    case "number": {
      let s = z.number();
      if (field.min !== undefined) s = s.min(field.min);
      if (field.max !== undefined) s = s.max(field.max);
      return s;
    }
    case "integer": {
      let s = z.number().int();
      if (field.min !== undefined) s = s.min(field.min);
      if (field.max !== undefined) s = s.max(field.max);
      return s;
    }
    case "boolean":
      return z.boolean();
    case "date":
      return z.iso.date();
    case "datetime":
      return z.iso.datetime({ offset: true });
    case "duration":
      return z.number().int().min(0).max(60 * 24 * 365);
    case "select":
      return z.enum(field.options.map((o) => o.value) as [string, ...string[]]);
    case "reference":
      return RecordId;
    case "computed":
      return undefined; // nunca é digitado
  }
}

/**
 * Schema dos dados que o usuário pode gravar numa entidade.
 * - `create`: campos obrigatórios precisam vir; `null` não é aceito neles.
 * - `update`: tudo opcional (só o que mudou); `null` limpa um campo opcional.
 * Campos arquivados e calculados são rejeitados (não podem ser escritos).
 */
export function recordSchema(entity: Entity, mode: "create" | "update"): z.ZodType<RecordData> {
  const shape: Record<string, z.ZodType> = {};
  for (const field of entity.fields) {
    if (field.status !== "active") continue;
    const s = fieldSchema(field);
    if (!s) continue;
    shape[field.id] = mode === "create" && field.required ? s : field.required ? s.optional() : s.nullable().optional();
  }
  return z.strictObject(shape) as unknown as z.ZodType<RecordData>;
}

/** Calcula os campos `computed` de um registro (null quando falta algum valor). */
export function computeFields(entity: Entity, data: RecordData): RecordData {
  const out: RecordData = {};
  for (const field of entity.fields) {
    if (field.type === "computed" && field.status === "active") out[field.id] = evaluate(field.formula, data);
  }
  return out;
}

export function evaluate(f: Formula, data: RecordData): number | null {
  switch (f.op) {
    case "const":
      return f.value;
    case "field": {
      const v = data[f.field];
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    }
    default: {
      const a = evaluate(f.args[0], data);
      const b = evaluate(f.args[1], data);
      if (a === null || b === null) return null;
      const r = f.op === "add" ? a + b : f.op === "sub" ? a - b : f.op === "mul" ? a * b : b === 0 ? null : a / b;
      return r === null || !Number.isFinite(r) ? null : r;
    }
  }
}
