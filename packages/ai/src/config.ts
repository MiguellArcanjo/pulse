import * as z from "zod";
import type { Tier } from "./types.ts";

/**
 * Configuração da IA, toda vinda de variáveis de ambiente. Nomes de modelos e preços
 * nunca ficam no código (regra da especificação).
 *
 *   AI_PROVIDER=openai
 *   AI_MODEL_FAST / AI_MODEL_MAIN / AI_MODEL_REASONING
 *   OPENAI_API_KEY (segredo: só no servidor)
 *   AI_PRICES={"modelo":{"input":2,"cached":0.1,"output":10}}  (US$ por 1M tokens; opcional)
 */

const Price = z.object({ input: z.number().min(0), cached: z.number().min(0), output: z.number().min(0) });
export type Price = z.infer<typeof Price>;

export type AIConfig = {
  provider: "openai";
  apiKey: string;
  models: Record<Tier, string>;
  prices: Record<string, Price>;
};

/** `null` = IA desligada (sem configuração). O app continua funcionando sem ela. */
export function loadAIConfig(env: Record<string, string | undefined>): AIConfig | null {
  const provider = env["AI_PROVIDER"];
  if (!provider) return null;
  if (provider !== "openai") throw new Error(`AI_PROVIDER desconhecido: ${provider}`);
  const apiKey = env["OPENAI_API_KEY"];
  const fast = env["AI_MODEL_FAST"];
  const main = env["AI_MODEL_MAIN"];
  const reasoning = env["AI_MODEL_REASONING"];
  if (!apiKey || !fast || !main || !reasoning)
    throw new Error("IA configurada pela metade: faltam OPENAI_API_KEY ou AI_MODEL_FAST/MAIN/REASONING");
  let prices: Record<string, Price> = {};
  if (env["AI_PRICES"]) prices = z.record(z.string(), Price).parse(JSON.parse(env["AI_PRICES"]));
  return { provider, apiKey, models: { fast, main, reasoning }, prices };
}
