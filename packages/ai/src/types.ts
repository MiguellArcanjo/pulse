/**
 * Contrato de um fornecedor de IA. O resto do Morph só conhece esta interface: trocar de
 * fornecedor é escrever outra implementação, sem mexer no orquestrador.
 *
 * Por enquanto o Morph só precisa de saída estruturada (generateStructured). Chamadas de
 * ferramenta e imagem entram quando houver funcionalidade que use (Skills, Vision).
 */

export type Tier = "fast" | "main" | "reasoning";

export type Usage = {
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  reasoningTokens: number;
};

export type StructuredRequest = {
  model: string;
  /** Instruções do sistema (regras + papel). Parte estável primeiro, para o cache funcionar. */
  system: string;
  /** Mensagem com o estado do app e o pedido do usuário. */
  input: string;
  schemaName: string;
  /** JSON Schema no subconjunto estrito (ver strict-schema.ts). */
  jsonSchema: Record<string, unknown>;
  /** Texto parcial da resposta, à medida que chega (progresso real na tela). */
  onPartial?: (textSoFar: string) => void;
  signal?: AbortSignal;
};

export type StructuredResult =
  | { ok: true; json: unknown; usage: Usage; model: string; latencyMs: number }
  | {
      ok: false;
      reason: "refusal" | "incomplete" | "invalid_json" | "unavailable" | "error";
      message: string;
      usage?: Usage | undefined;
      latencyMs: number;
    };

export interface AIProvider {
  readonly name: string;
  generateStructured(req: StructuredRequest): Promise<StructuredResult>;
}

export const EMPTY_USAGE: Usage = { inputTokens: 0, cachedTokens: 0, outputTokens: 0, reasoningTokens: 0 };
