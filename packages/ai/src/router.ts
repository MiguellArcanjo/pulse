import type { Classification } from "./prompts/classifier.ts";
import type { Tier } from "./types.ts";

/**
 * Model Router: escolhe o nível do modelo pela complexidade, para não usar o modelo mais
 * caro em tudo. Se a proposta for recusada pelo validador, a nova tentativa sobe um nível.
 *
 *   FAST       entender o pedido; mudanças pequenas (um campo, um componente)
 *   MAIN       ferramenta nova; várias mudanças numa ferramenta
 *   REASONING  reorganizações grandes, arquivar, mudanças que mexem em várias ferramentas
 */
const ORDER: Tier[] = ["fast", "main", "reasoning"];

export function chooseTier(c: Classification, attempt: number): Tier {
  let base: Tier;
  if (c.complexity === "complex" || c.intent === "archive") base = "reasoning";
  else if (c.intent === "modify_tool" && c.complexity === "simple") base = "fast";
  else base = "main";
  const i = Math.min(ORDER.length - 1, ORDER.indexOf(base) + attempt);
  return ORDER[i] as Tier;
}
