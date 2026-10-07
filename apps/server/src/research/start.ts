import { mkdir } from "node:fs/promises";
import { migrate } from "../db/migrate.ts";
import { pgliteDb } from "../db/pglite.ts";
import { buildResearchApp } from "./app.ts";

/**
 * Sobe o workspace local: banco PGlite próprio, migrations e servidor só em 127.0.0.1.
 * Usado pelo `pnpm research` (navegador) e pelo app desktop (Electron). Os caminhos vêm
 * de fora porque, empacotado, o app não roda a partir das pastas do repositório.
 */
export type StartOptions = { dataDir: string; migrationsDir: string; uiDir?: string | undefined; port: number };

export async function startResearch({ dataDir, migrationsDir, uiDir, port }: StartOptions) {
  await mkdir(dataDir, { recursive: true });
  const db = await pgliteDb(dataDir);
  try {
    await migrate(db, migrationsDir);
  } catch (err) {
    await db.close();
    throw err;
  }
  const origin = `http://127.0.0.1:${port}`;
  const app = buildResearchApp(db, origin, uiDir);
  try {
    await app.listen({ host: "127.0.0.1", port });
  } catch (err) {
    await app.close();
    await db.close();
    throw err;
  }
  let closed = false;
  return {
    origin,
    async close() {
      if (closed) return;
      closed = true;
      await app.close();
      await db.close();
    },
  };
}
