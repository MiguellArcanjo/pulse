import type { Price } from "./config.ts";
import type { Usage } from "./types.ts";

/**
 * Custo estimado de uma chamada em US$, a partir da tabela de preços configurada.
 * Tokens em cache são cobrados no preço de cache; o resto da entrada no preço cheio.
 * Tokens de raciocínio já estão contados na saída. `null` = preço não configurado.
 */
export function estimateCost(usage: Usage, price: Price | undefined): number | null {
  if (!price) return null;
  const uncached = Math.max(0, usage.inputTokens - usage.cachedTokens);
  return (uncached * price.input + usage.cachedTokens * price.cached + usage.outputTokens * price.output) / 1_000_000;
}
