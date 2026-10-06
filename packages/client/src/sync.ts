import type { StoredRecord } from "@morph/engine";
import type { AppSpec } from "@morph/protocol";
import type { MorphApi, RecordRow } from "./api.ts";

/**
 * O que o app guarda localmente para abrir sem servidor e sem IA: a última spec e
 * todos os registros, mais o cursor da sincronização.
 */
export type Snapshot = {
  version: number;
  spec: AppSpec;
  cursor: string | null;
  records: StoredRecord[];
};

function toStored(r: RecordRow): StoredRecord {
  return { id: r.id, entity: r.entity, data: r.data, createdAt: r.createdAt, updatedAt: r.updatedAt };
}

/** Aplica alterações vindas do servidor sobre a lista local (apagados saem). */
export function mergeRecords(current: readonly StoredRecord[], changes: readonly RecordRow[]): StoredRecord[] {
  const byId = new Map(current.map((r) => [r.id, r]));
  for (const c of changes) {
    if (c.deleted) byId.delete(c.id);
    else byId.set(c.id, toStored(c));
  }
  return [...byId.values()];
}

/**
 * Busca a spec atual e tudo que mudou desde o último cursor. Se a rede cair no meio,
 * o erro sobe e o snapshot anterior continua válido (nada é gravado pela metade).
 */
export async function pull(api: MorphApi, previous: Snapshot | null): Promise<Snapshot> {
  const { version, spec } = await api.spec();
  let cursor = previous?.cursor ?? null;
  let records = previous?.records ?? [];
  for (;;) {
    const page = await api.changes(cursor);
    records = mergeRecords(records, page.records);
    cursor = page.cursor;
    if (!page.hasMore) break;
  }
  return { version, spec, cursor, records };
}

/** Atualiza o snapshot com um registro que o próprio app acabou de gravar. */
export function upsertLocal(snapshot: Snapshot, row: RecordRow): Snapshot {
  return { ...snapshot, records: mergeRecords(snapshot.records, [row]) };
}
