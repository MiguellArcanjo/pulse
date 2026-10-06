-- Observabilidade da IA: uma linha por chamada ao fornecedor.
-- Nunca guarda chaves, tokens de acesso nem o conteúdo enviado; só metadados técnicos.

CREATE TABLE ai_calls (
  id                  uuid PRIMARY KEY,
  user_id             uuid NOT NULL REFERENCES users(id),
  request_id          uuid NOT NULL,             -- o pedido do usuário (job) a que a chamada pertence
  provider            text NOT NULL,
  model               text NOT NULL,
  role                text NOT NULL,             -- classifier | builder
  prompt_version      text NOT NULL,             -- ex.: builder:v1
  attempt             integer NOT NULL,          -- 0 = primeira tentativa
  latency_ms          integer NOT NULL,
  input_tokens        integer NOT NULL,
  cached_tokens       integer NOT NULL,
  output_tokens       integer NOT NULL,
  reasoning_tokens    integer NOT NULL,
  estimated_cost_usd  numeric(12, 6),            -- null quando o preço do modelo não está configurado
  success             boolean NOT NULL,
  validation          text,                      -- ok | schema | operations | semantic | null (classificação)
  error               text,                      -- motivo curto, sem dados sensíveis
  context_categories  text[] NOT NULL DEFAULT '{}',
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_calls_by_user ON ai_calls (user_id, created_at DESC);
