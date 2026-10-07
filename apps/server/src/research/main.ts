import { fileURLToPath } from "node:url";
import { startResearch } from "./start.ts";

// Sem DATABASE_URL: esta entrada nunca abre o banco do Morph ou da Heroku.
try {
  const server = await startResearch({
    dataDir: fileURLToPath(new URL("../../.data/research/", import.meta.url)),
    migrationsDir: fileURLToPath(new URL("../../research-migrations/", import.meta.url)),
    uiDir: fileURLToPath(new URL("../../../workspace/dist/", import.meta.url)),
    port: 47710,
  });
  console.log(`Security Research Workspace: ${server.origin}`);
  process.once("SIGINT", () => void server.close());
  process.once("SIGTERM", () => void server.close());
} catch {
  console.error("Não foi possível abrir o workspace. Confira se ele (ou o app desktop) já está em execução na porta 47710.");
  process.exitCode = 1;
}
