import * as z from "zod";

/**
 * Configuração vinda de variáveis de ambiente. Segredos (DATABASE_URL) só existem
 * aqui e nunca vão para o log.
 */
const Env = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(47700),
  /** Padrão: todas as interfaces na Heroku (variável DYNO existe), só o loopback no PC. */
  HOST: z.string().optional(),
  /** Postgres de verdade (Heroku). Sem ela, usa PGlite em MORPH_DATA_DIR. */
  DATABASE_URL: z.url().optional(),
  /** SSL no Postgres: ligado por padrão quando há DATABASE_URL (exigido pela Heroku). */
  DATABASE_SSL: z.enum(["on", "off"]).default("on"),
  MORPH_DATA_DIR: z.string().default(".data/pglite"),
});

export type Config = {
  port: number;
  host: string;
  database: { kind: "pg"; url: string; ssl: boolean } | { kind: "pglite"; dir: string };
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const e = Env.parse(env);
  return {
    port: e.PORT,
    host: e.HOST ?? (env["DYNO"] ? "0.0.0.0" : "127.0.0.1"),
    database: e.DATABASE_URL
      ? { kind: "pg", url: e.DATABASE_URL, ssl: e.DATABASE_SSL === "on" }
      : { kind: "pglite", dir: e.MORPH_DATA_DIR },
  };
}
