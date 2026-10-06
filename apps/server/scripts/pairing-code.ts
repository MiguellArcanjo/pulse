/**
 * Gera um código de pareamento novo (vale 15 minutos, uso único).
 *   Local:   pnpm --filter @morph/server pair
 *   Heroku:  heroku run "pnpm --filter @morph/server pair"
 */
import { mkdir } from "node:fs/promises";
import { createPairingCode } from "../src/auth.ts";
import { loadConfig } from "../src/config.ts";
import type { Db } from "../src/db/db.ts";
import { migrate } from "../src/db/migrate.ts";

const config = loadConfig();
let db: Db;
if (config.database.kind === "pg") {
  const { pgDb } = await import("../src/db/pg.ts");
  db = pgDb(config.database.url, { ssl: config.database.ssl });
} else {
  const { pgliteDb } = await import("../src/db/pglite.ts");
  await mkdir(config.database.dir, { recursive: true });
  db = await pgliteDb(config.database.dir);
}

await migrate(db);
const { code, expiresAt } = await createPairingCode(db);
console.log(`Código de pareamento: ${code}`);
console.log(`Vale até ${expiresAt.toLocaleTimeString("pt-BR")} e só pode ser usado uma vez.`);
await db.close();
