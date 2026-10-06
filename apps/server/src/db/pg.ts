import pg from "pg";
import type { Db, Queryable } from "./db.ts";

/**
 * Postgres de verdade (Heroku). SSL conforme a documentação da Heroku:
 * https://devcenter.heroku.com/articles/connecting-heroku-postgres
 */
export function pgDb(connectionString: string, opts: { ssl: boolean }): Db {
  const pool = new pg.Pool({
    connectionString,
    ssl: opts.ssl ? { rejectUnauthorized: false } : false,
    // Essential-0 aceita 20 conexões; deixa folga para scripts e o console.
    max: 8,
  });

  const run = async <T extends object>(client: pg.Pool | pg.PoolClient, sql: string, params?: unknown[]) =>
    (await client.query(sql, params as unknown[])).rows as T[];

  return {
    query: (sql, params) => run(pool, sql, params),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const tx: Queryable = { query: (sql, params) => run(client, sql, params) };
        const result = await fn(tx);
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },
    async exec(sql) {
      await pool.query(sql);
    },
    close: () => pool.end(),
  };
}
