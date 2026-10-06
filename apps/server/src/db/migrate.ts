import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Db } from "./db.ts";

const DIR = fileURLToPath(new URL("../../migrations/", import.meta.url));

/**
 * Aplica, em ordem, as migrations `NNNN_nome.sql` que ainda não rodaram. Cada uma roda
 * numa transação junto com o registro em `schema_migrations`.
 */
export async function migrate(db: Db): Promise<number[]> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version integer PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const done = new Set((await db.query<{ version: number }>("SELECT version FROM schema_migrations")).map((r) => r.version));

  const files = (await readdir(DIR)).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
  const applied: number[] = [];
  for (const file of files) {
    const version = Number(file.slice(0, 4));
    if (done.has(version)) continue;
    const sql = await readFile(DIR + file, "utf8");
    await db.exec(`BEGIN;\n${sql}\nINSERT INTO schema_migrations (version) VALUES (${version});\nCOMMIT;`);
    applied.push(version);
  }
  return applied;
}
