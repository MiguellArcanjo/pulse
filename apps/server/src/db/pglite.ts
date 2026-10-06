import { PGlite } from "@electric-sql/pglite";
import type { Db } from "./db.ts";

/**
 * Postgres rodando dentro do Node (https://pglite.dev/docs/api). Sem instalar nada no
 * Windows. `dataDir` = pasta onde os dados ficam; `memory://` = só na memória (testes).
 */
export async function pgliteDb(dataDir: string): Promise<Db> {
  const db = await PGlite.create(dataDir);
  return {
    query: async (sql, params) => (await db.query(sql, params)).rows as never[],
    transaction: (fn) =>
      db.transaction((tx) => fn({ query: async (sql, params) => (await tx.query(sql, params)).rows as never[] })),
    async exec(sql) {
      await db.exec(sql);
    },
    close: () => db.close(),
  };
}
