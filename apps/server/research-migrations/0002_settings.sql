-- Preferências locais do workspace (ex.: nome exibido na saudação).
CREATE TABLE research_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
