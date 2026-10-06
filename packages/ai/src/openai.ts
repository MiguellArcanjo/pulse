import OpenAI from "openai";
import { EMPTY_USAGE, type AIProvider, type StructuredRequest, type StructuredResult, type Usage } from "./types.ts";

/**
 * Fornecedor OpenAI, pela Responses API com saída estruturada estrita
 * (https://developers.openai.com/api/docs/guides/structured-outputs).
 * Usa streaming para mostrar progresso real enquanto a resposta é gerada.
 */
export class OpenAIProvider implements AIProvider {
  readonly name = "openai";
  private readonly client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey, maxRetries: 2, timeout: 120_000 });
  }

  async generateStructured(req: StructuredRequest): Promise<StructuredResult> {
    const started = Date.now();
    let text = "";
    let usage: Usage = EMPTY_USAGE;
    try {
      const stream = await this.client.responses.create(
        {
          model: req.model,
          instructions: req.system,
          input: req.input,
          text: { format: { type: "json_schema", name: req.schemaName, schema: req.jsonSchema, strict: true } },
          stream: true,
        },
        req.signal ? { signal: req.signal } : undefined,
      );
      for await (const event of stream) {
        if (event.type === "response.output_text.delta") {
          text += event.delta;
          req.onPartial?.(text);
        } else if (event.type === "response.refusal.delta") {
          return { ok: false, reason: "refusal", message: "o modelo recusou o pedido", latencyMs: Date.now() - started };
        } else if (event.type === "response.completed" || event.type === "response.incomplete" || event.type === "response.failed") {
          const u = event.response.usage;
          if (u)
            usage = {
              inputTokens: u.input_tokens,
              cachedTokens: u.input_tokens_details?.cached_tokens ?? 0,
              outputTokens: u.output_tokens,
              reasoningTokens: u.output_tokens_details?.reasoning_tokens ?? 0,
            };
          if (event.type === "response.incomplete")
            return {
              ok: false,
              reason: "incomplete",
              message: `resposta incompleta (${event.response.incomplete_details?.reason ?? "?"})`,
              usage,
              latencyMs: Date.now() - started,
            };
          if (event.type === "response.failed")
            return { ok: false, reason: "error", message: event.response.error?.message ?? "falha no fornecedor", usage, latencyMs: Date.now() - started };
        }
      }
    } catch (err) {
      const status = err instanceof OpenAI.APIError ? err.status : undefined;
      const reason = status === undefined || status === 429 || (status ?? 0) >= 500 ? "unavailable" : "error";
      return { ok: false, reason, message: err instanceof Error ? err.message : "erro desconhecido", usage, latencyMs: Date.now() - started };
    }

    try {
      return { ok: true, json: JSON.parse(text), usage, model: req.model, latencyMs: Date.now() - started };
    } catch {
      return { ok: false, reason: "invalid_json", message: "resposta não é JSON válido", usage, latencyMs: Date.now() - started };
    }
  }
}
