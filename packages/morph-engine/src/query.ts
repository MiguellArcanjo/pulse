import type { AggregateFn, AppSpec, Condition, Entity, Operand, Period, Query, Value, ValueFormat } from "@morph/protocol";
import { evaluate, type RecordData } from "./records.ts";

/**
 * Avaliação das consultas e valores declarados nas telas, sobre os registros que o app
 * tem localmente. Funções puras: "agora" e o fuso vêm de fora (o relógio do aparelho),
 * então os testes são determinísticos.
 */

export type StoredRecord = {
  id: string;
  entity: string;
  data: RecordData;
  createdAt: string;
  updatedAt: string;
};

/** Registros indexados por entidade e por id. */
export class RecordIndex {
  private readonly byEntity = new Map<string, StoredRecord[]>();
  private readonly byId = new Map<string, StoredRecord>();

  constructor(records: Iterable<StoredRecord>) {
    for (const r of records) {
      this.byId.set(r.id, r);
      const list = this.byEntity.get(r.entity);
      if (list) list.push(r);
      else this.byEntity.set(r.entity, [r]);
    }
  }

  of(entity: string): readonly StoredRecord[] {
    return this.byEntity.get(entity) ?? [];
  }

  get(id: string): StoredRecord | undefined {
    return this.byId.get(id);
  }
}

export type EvalContext = {
  spec: AppSpec;
  records: RecordIndex;
  /** Agora, no relógio do aparelho. */
  now: Date;
  /** Parâmetros da tela atual (ids de registros). */
  params: Readonly<Record<string, string>>;
  /** Registro do contexto (linha da lista, registro da tela...). */
  item?: StoredRecord | undefined;
};

/** A semana começa na segunda (S T Q Q S S D, como no mockup). */
const WEEK_START = 1;

// ---------------------------------------------------------------------------
// Datas (sempre no fuso local do aparelho)

/** "2026-10-06" → meia-noite local desse dia. */
function parseLocalDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Converte qualquer valor de data (date ou datetime) para Date. */
export function toDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const local = parseLocalDate(value);
  if (local) return local;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function localDateString(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function startOfWeek(d: Date): Date {
  const day = startOfDay(d);
  return addDays(day, -((day.getDay() - WEEK_START + 7) % 7));
}

/** Intervalo [início, fim) de um período relativo a `now`. */
export function periodRange(period: Period | "week" | "month", now: Date, offset = 0): [Date, Date] {
  const today = startOfDay(now);
  switch (period) {
    case "today":
      return [addDays(today, offset), addDays(today, offset + 1)];
    case "this_week":
    case "week": {
      const s = addDays(startOfWeek(now), offset * 7);
      return [s, addDays(s, 7)];
    }
    case "last_7_days":
      return [addDays(today, -6 + offset * 7), addDays(today, 1 + offset * 7)];
    case "this_month":
    case "month": {
      const s = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      return [s, new Date(s.getFullYear(), s.getMonth() + 1, 1)];
    }
    case "last_30_days":
      return [addDays(today, -29 + offset * 30), addDays(today, 1 + offset * 30)];
  }
}

// ---------------------------------------------------------------------------
// Campos e consultas

function entityOf(spec: AppSpec, id: string): Entity | undefined {
  return spec.entities.find((e) => e.id === id);
}

/** Valor de um campo de um registro: de sistema, calculado ou gravado. */
export function fieldValue(spec: AppSpec, record: StoredRecord, fieldId: string): unknown {
  if (fieldId === "id") return record.id;
  if (fieldId === "created_at") return record.createdAt;
  if (fieldId === "updated_at") return record.updatedAt;
  const field = entityOf(spec, record.entity)?.fields.find((f) => f.id === fieldId);
  if (field?.type === "computed") return evaluate(field.formula, record.data);
  return record.data[fieldId] ?? null;
}

export function resolveOperand(op: Operand, ctx: EvalContext): unknown {
  switch (op.kind) {
    case "literal":
      return op.value;
    case "param":
      return ctx.params[op.param] ?? null;
    case "item_id":
      return ctx.item?.id ?? null;
    case "item_field":
      return ctx.item ? fieldValue(ctx.spec, ctx.item, op.field) : null;
    case "today":
      return localDateString(ctx.now);
  }
}

function compare(a: unknown, b: unknown): number | null {
  if (typeof a === "number" && typeof b === "number") return a - b;
  const da = toDate(a);
  const db = toDate(b);
  if (da && db) return da.getTime() - db.getTime();
  if (typeof a === "string" && typeof b === "string") return a.localeCompare(b);
  return null;
}

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

function matches(cond: Condition, record: StoredRecord, ctx: EvalContext): boolean {
  const v = fieldValue(ctx.spec, record, cond.field);
  switch (cond.op) {
    case "within": {
      const d = toDate(v);
      if (!d) return false;
      const [start, end] = periodRange(cond.period, ctx.now);
      return d >= start && d < end;
    }
    case "is_empty":
      return isEmpty(v);
    case "not_empty":
      return !isEmpty(v);
    case "eq":
      return v === resolveOperand(cond.value, ctx);
    case "neq":
      return v !== resolveOperand(cond.value, ctx);
    default: {
      const c = compare(v, resolveOperand(cond.value, ctx));
      if (c === null) return false;
      return cond.op === "gt" ? c > 0 : cond.op === "gte" ? c >= 0 : cond.op === "lt" ? c < 0 : c <= 0;
    }
  }
}

export function runQuery(q: Query, ctx: EvalContext): StoredRecord[] {
  let rows = ctx.records.of(q.entity).filter((r) => (q.where ?? []).every((c) => matches(c, r, ctx)));
  if (q.sort) {
    const { field, dir } = q.sort;
    rows = [...rows].sort((a, b) => {
      const va = fieldValue(ctx.spec, a, field);
      const vb = fieldValue(ctx.spec, b, field);
      // Vazios sempre no fim.
      if (isEmpty(va) || isEmpty(vb)) return isEmpty(va) === isEmpty(vb) ? 0 : isEmpty(va) ? 1 : -1;
      const c = compare(va, vb) ?? 0;
      return dir === "asc" ? c : -c;
    });
  }
  return q.limit ? rows.slice(0, q.limit) : rows;
}

export function aggregate(fn: AggregateFn, rows: readonly StoredRecord[], field: string | undefined, spec: AppSpec): number | null {
  if (fn === "count") return rows.length;
  if (!field) return null;
  const values = rows.map((r) => fieldValue(spec, r, field));
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (nums.length > 0) {
    switch (fn) {
      case "sum":
        return nums.reduce((a, b) => a + b, 0);
      case "avg":
        return nums.reduce((a, b) => a + b, 0) / nums.length;
      case "min":
        return Math.min(...nums);
      case "max":
        return Math.max(...nums);
    }
  }
  if (fn === "sum") return 0;
  // min/max de datas: devolve o timestamp (formatado como data pelo app).
  const dates = values.map(toDate).filter((d): d is Date => d !== null).map((d) => d.getTime());
  if (dates.length > 0 && (fn === "min" || fn === "max")) return fn === "min" ? Math.min(...dates) : Math.max(...dates);
  return null;
}

// ---------------------------------------------------------------------------
// Valores exibíveis

/** Valor resolvido, ainda sem formatação de idioma (isso é do app). */
export type Resolved =
  | { kind: "empty" }
  | { kind: "text"; text: string }
  | { kind: "number"; value: number; unit?: string | undefined; format?: ValueFormat | undefined }
  | { kind: "percent"; value: number }
  | { kind: "date"; value: string; format?: ValueFormat | undefined }
  | { kind: "boolean"; value: boolean }
  | { kind: "join"; parts: Resolved[]; separator: string };

function fieldDef(spec: AppSpec, entity: string, fieldId: string) {
  return entityOf(spec, entity)?.fields.find((f) => f.id === fieldId);
}

function resolveRaw(raw: unknown, spec: AppSpec, entity: string, fieldId: string, format: ValueFormat | undefined): Resolved {
  if (isEmpty(raw)) return { kind: "empty" };
  const def = fieldDef(spec, entity, fieldId);
  const type = def?.type ?? (fieldId === "created_at" || fieldId === "updated_at" ? "datetime" : "text");
  switch (type) {
    case "number":
    case "integer":
    case "computed":
      return typeof raw === "number"
        ? { kind: "number", value: raw, unit: def && "unit" in def ? def.unit : undefined, format }
        : { kind: "empty" };
    case "duration":
      return typeof raw === "number" ? { kind: "number", value: raw, format: format ?? "duration" } : { kind: "empty" };
    case "date":
    case "datetime":
      return { kind: "date", value: String(raw), format };
    case "boolean":
      return { kind: "boolean", value: raw === true };
    case "select": {
      const label = def?.type === "select" ? def.options.find((o) => o.value === raw)?.label : undefined;
      return { kind: "text", text: label ?? String(raw) };
    }
    default:
      return { kind: "text", text: String(raw) };
  }
}

export function resolveValue(v: Value, ctx: EvalContext): Resolved {
  switch (v.kind) {
    case "text":
      return { kind: "text", text: v.text };
    case "param":
      return { kind: "text", text: ctx.params[v.param] ?? "" };
    case "field": {
      const item = ctx.item;
      if (!item) return { kind: "empty" };
      const [first, second] = v.path;
      const raw = fieldValue(ctx.spec, item, first);
      if (second === undefined) {
        // Referência sozinha: mostra o título do registro apontado.
        const def = fieldDef(ctx.spec, item.entity, first);
        if (def?.type === "reference" && typeof raw === "string") return titleOf(raw, ctx);
        return resolveRaw(raw, ctx.spec, item.entity, first, v.format);
      }
      const target = typeof raw === "string" ? ctx.records.get(raw) : undefined;
      if (!target) return { kind: "empty" };
      return resolveRaw(fieldValue(ctx.spec, target, second), ctx.spec, target.entity, second, v.format);
    }
    case "aggregate": {
      const value = aggregate(v.fn, runQuery(v.query, ctx), v.field, ctx.spec);
      if (value === null) return { kind: "empty" };
      const def = v.field ? fieldDef(ctx.spec, v.query.entity, v.field) : undefined;
      if (def && (def.type === "date" || def.type === "datetime"))
        return { kind: "date", value: new Date(value).toISOString(), format: v.format };
      return { kind: "number", value, unit: def && "unit" in def ? def.unit : undefined, format: v.format };
    }
    case "trend": {
      const base = { ...v.query, where: v.query.where ?? [] };
      const inPeriod = (offset: number) => {
        const [start, end] = periodRange(v.period, ctx.now, offset);
        const rows = runQuery(base, ctx).filter((r) => {
          const d = toDate(fieldValue(ctx.spec, r, v.dateField));
          return d !== null && d >= start && d < end;
        });
        return aggregate(v.fn, rows, v.field, ctx.spec);
      };
      const current = inPeriod(0);
      const previous = inPeriod(-1);
      if (current === null || previous === null || previous === 0) return { kind: "empty" };
      return { kind: "percent", value: (current - previous) / Math.abs(previous) };
    }
    case "join":
      return { kind: "join", parts: v.parts.map((p) => resolveValue(p, ctx)), separator: v.separator ?? " · " };
  }
}

/** Título de um registro (pelo campo de título da entidade). */
export function titleOf(id: string, ctx: EvalContext): Resolved {
  const record = ctx.records.get(id);
  if (!record) return { kind: "empty" };
  const entity = entityOf(ctx.spec, record.entity);
  if (!entity) return { kind: "empty" };
  return resolveValue({ kind: "field", path: [entity.titleField] }, { ...ctx, item: record });
}

// ---------------------------------------------------------------------------
// Gráficos

export type ChartBucket = { key: string; label: string; value: number; current: boolean };

const WEEKDAY_LABELS = ["D", "S", "T", "Q", "Q", "S", "S"]; // índice = getDay()
const MONTH_LABELS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function chartBuckets(
  rows: readonly StoredRecord[],
  groupBy: { field: string; bucket: "weekday" | "day" | "week" | "month" },
  measure: { fn: AggregateFn; field?: string | undefined },
  ctx: EvalContext,
): ChartBucket[] {
  const groups = new Map<string, StoredRecord[]>();
  for (const r of rows) {
    const d = toDate(fieldValue(ctx.spec, r, groupBy.field));
    if (!d) continue;
    const key = bucketKey(d, groupBy.bucket);
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }
  const value = (key: string) => aggregate(measure.fn, groups.get(key) ?? [], measure.field, ctx.spec) ?? 0;

  if (groupBy.bucket === "weekday") {
    // Sempre os 7 dias da semana atual, de segunda a domingo.
    const start = startOfWeek(ctx.now);
    return Array.from({ length: 7 }, (_, i) => {
      const day = addDays(start, i);
      const key = bucketKey(day, "weekday");
      return { key, label: WEEKDAY_LABELS[day.getDay()] ?? "", value: value(key), current: key === bucketKey(ctx.now, "weekday") };
    });
  }
  const bucket = groupBy.bucket;
  const nowKey = bucketKey(ctx.now, bucket);
  return [...groups.keys()].sort().map((key) => ({ key, label: bucketLabel(key, bucket), value: value(key), current: key === nowKey }));
}

function bucketKey(d: Date, bucket: "weekday" | "day" | "week" | "month"): string {
  switch (bucket) {
    case "weekday":
    case "day":
      return localDateString(d);
    case "week":
      return localDateString(startOfWeek(d));
    case "month":
      return localDateString(d).slice(0, 7);
  }
}

function bucketLabel(key: string, bucket: "day" | "week" | "month"): string {
  if (bucket === "month") return MONTH_LABELS[Number(key.slice(5, 7)) - 1] ?? key;
  return `${Number(key.slice(8, 10))}/${Number(key.slice(5, 7))}`;
}
