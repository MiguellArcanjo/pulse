import { randomUUID } from "node:crypto";
import { recordSchema, type Issue, type RecordData } from "@morph/engine";
import type { AppSpec, Entity } from "@morph/protocol";
import type { Queryable } from "./db/db.ts";

/**
 * Registros das ferramentas. Toda escrita é validada contra a spec atual: só entidades
 * e campos que existem e estão ativos, com o tipo certo, e referências que apontam para
 * registros reais da entidade certa.
 */

export type RecordRow = {
  id: string;
  entity: string;
  data: RecordData;
  createdAt: string;
  updatedAt: string;
  deleted: boolean;
};

export type RecordResult = { ok: true; record: RecordRow } | { ok: false; status: 400 | 404; issues: Issue[] };

type DbRow = { id: string; entity: string; data: RecordData; created_at: Date | string; updated_at: Date | string; deleted_at: Date | string | null };

function toRow(r: DbRow): RecordRow {
  return {
    id: r.id,
    entity: r.entity,
    data: r.data,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
    deleted: r.deleted_at !== null,
  };
}

const bad = (message: string, path: (string | number)[] = []): RecordResult => ({
  ok: false,
  status: 400,
  issues: [{ code: "schema", message, path }],
});

function activeEntity(spec: AppSpec, id: string): Entity | undefined {
  const entity = spec.entities.find((e) => e.id === id);
  if (!entity) return undefined;
  const tool = spec.tools.find((t) => t.id === entity.toolId);
  return tool?.status === "active" ? entity : undefined;
}

/** Confere se cada referência aponta para um registro existente da entidade certa. */
async function checkReferences(db: Queryable, userId: string, entity: Entity, data: RecordData): Promise<Issue[]> {
  const issues: Issue[] = [];
  for (const field of entity.fields) {
    if (field.type !== "reference" || field.status !== "active") continue;
    const value = data[field.id];
    if (typeof value !== "string") continue;
    const rows = await db.query<{ entity: string }>(
      "SELECT entity FROM records WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
      [value, userId],
    );
    if (rows[0]?.entity !== field.entity)
      issues.push({ code: "not_found", message: `"${field.id}" não aponta para um registro de "${field.entity}"`, path: [field.id] });
  }
  return issues;
}

function zodIssues(error: { issues: { message: string; path: PropertyKey[] }[] }): Issue[] {
  return error.issues.map((i) => ({
    code: "schema" as const,
    message: i.message,
    path: i.path.map((p) => (typeof p === "symbol" ? String(p) : p)),
  }));
}

export async function createRecord(db: Queryable, userId: string, spec: AppSpec, entityId: string, input: unknown): Promise<RecordResult> {
  const entity = activeEntity(spec, entityId);
  if (!entity) return bad(`entidade "${entityId}" não existe`, ["entity"]);
  const parsed = recordSchema(entity, "create").safeParse(input);
  if (!parsed.success) return { ok: false, status: 400, issues: zodIssues(parsed.error) };
  const refIssues = await checkReferences(db, userId, entity, parsed.data);
  if (refIssues.length > 0) return { ok: false, status: 400, issues: refIssues };

  // Horário com precisão de milissegundos vindo do Node: é o cursor da sincronização.
  const now = new Date();
  const rows = await db.query<DbRow>(
    `INSERT INTO records (id, user_id, entity, data, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5)
     RETURNING id, entity, data, created_at, updated_at, deleted_at`,
    [randomUUID(), userId, entity.id, JSON.stringify(parsed.data), now],
  );
  return { ok: true, record: toRow(rows[0] as DbRow) };
}

export async function updateRecord(db: Queryable, userId: string, spec: AppSpec, id: string, input: unknown): Promise<RecordResult> {
  const current = await getRecord(db, userId, id);
  if (!current || current.deleted) return { ok: false, status: 404, issues: [{ code: "not_found", message: "registro não existe", path: [] }] };
  const entity = activeEntity(spec, current.entity);
  if (!entity) return bad(`entidade "${current.entity}" não está mais ativa`);
  const parsed = recordSchema(entity, "update").safeParse(input);
  if (!parsed.success) return { ok: false, status: 400, issues: zodIssues(parsed.error) };
  const refIssues = await checkReferences(db, userId, entity, parsed.data);
  if (refIssues.length > 0) return { ok: false, status: 400, issues: refIssues };

  // Junta com o que já existe (inclusive valores de campos arquivados, que ficam guardados).
  const merged: RecordData = { ...current.data };
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v === null) delete merged[k];
    else merged[k] = v;
  }
  const rows = await db.query<DbRow>(
    `UPDATE records SET data = $1, updated_at = $2 WHERE id = $3 AND user_id = $4
     RETURNING id, entity, data, created_at, updated_at, deleted_at`,
    [JSON.stringify(merged), new Date(), id, userId],
  );
  return { ok: true, record: toRow(rows[0] as DbRow) };
}

/** Apagar = marcar como apagado (o app recebe a remoção na sincronização). */
export async function deleteRecord(db: Queryable, userId: string, id: string): Promise<boolean> {
  const now = new Date();
  const rows = await db.query(
    "UPDATE records SET deleted_at = $1, updated_at = $1 WHERE id = $2 AND user_id = $3 AND deleted_at IS NULL RETURNING id",
    [now, id, userId],
  );
  return rows.length > 0;
}

export async function getRecord(db: Queryable, userId: string, id: string): Promise<RecordRow | null> {
  const rows = await db.query<DbRow>(
    "SELECT id, entity, data, created_at, updated_at, deleted_at FROM records WHERE id = $1 AND user_id = $2",
    [id, userId],
  );
  return rows[0] ? toRow(rows[0]) : null;
}

/**
 * Sincronização: registros alterados depois do cursor, em ordem. O cursor é
 * "updated_at|id" do último registro recebido. Inclui os apagados (deleted: true).
 */
export async function listChanges(
  db: Queryable,
  userId: string,
  cursor: string | null,
  limit: number,
): Promise<{ records: RecordRow[]; cursor: string | null; hasMore: boolean }> {
  const [ts, lastId] = cursor ? cursor.split("|") : [];
  const rows = await db.query<DbRow>(
    `SELECT id, entity, data, created_at, updated_at, deleted_at FROM records
      WHERE user_id = $1 AND ($2::timestamptz IS NULL OR (updated_at, id) > ($2::timestamptz, $3::uuid))
      ORDER BY updated_at, id LIMIT $4`,
    [userId, ts ?? null, lastId ?? null, limit + 1],
  );
  const page = rows.slice(0, limit).map(toRow);
  const last = page.at(-1);
  return { records: page, cursor: last ? `${last.updatedAt}|${last.id}` : cursor, hasMore: rows.length > limit };
}
