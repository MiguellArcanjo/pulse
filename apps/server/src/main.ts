import { mkdir } from "node:fs/promises";
import { loadAIConfig, OpenAIProvider } from "@morph/ai";
import { AiOrchestrator } from "./ai/orchestrator.ts";
import { buildApp } from "./app.ts";
import { createPairingCode } from "./auth.ts";
import { loadConfig } from "./config.ts";
import type { Db } from "./db/db.ts";
import { migrate } from "./db/migrate.ts";

const config = loadConfig();

let db: Db;
if (config.database.kind === "pg") {
  const { pgDb } = await import("./db/pg.ts");
  db = pgDb(config.database.url, { ssl: config.database.ssl });
} else {
  const { pgliteDb } = await import("./db/pglite.ts");
  await mkdir(config.database.dir, { recursive: true });
  db = await pgliteDb(config.database.dir);
}

const applied = await migrate(db);

// IA: opcional. Sem AI_PROVIDER o app funciona normalmente, só sem criação por IA.
const aiConfig = loadAIConfig(process.env);
const ai = aiConfig ? new AiOrchestrator(db, new OpenAIProvider(aiConfig.apiKey), aiConfig) : null;

const app = buildApp({ db, logger: true, ai });
app.log.info(aiConfig ? `IA ligada: ${aiConfig.provider} (fast=${aiConfig.models.fast}, main=${aiConfig.models.main}, reasoning=${aiConfig.models.reasoning})` : "IA desligada (sem AI_PROVIDER)");
if (applied.length > 0) app.log.info({ migrations: applied }, "migrations aplicadas");

// Primeiro uso: nenhum aparelho pareado ainda → mostra um código no log.
const devices = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM devices WHERE revoked_at IS NULL");
if ((devices[0]?.n ?? 0) === 0) {
  const { code, expiresAt } = await createPairingCode(db);
  app.log.info(`Nenhum aparelho pareado. Código de pareamento: ${code} (vale até ${expiresAt.toLocaleTimeString("pt-BR")})`);
}

const shutdown = async () => {
  await app.close();
  await db.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port: config.port, host: config.host });
