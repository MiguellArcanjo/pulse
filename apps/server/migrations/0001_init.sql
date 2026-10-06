-- Morph: esquema inicial.
-- Nunca edite uma migration já aplicada: crie a próxima (0002_...).
-- Todas as tabelas de dados têm user_id desde o início (MVP de um usuário, pronto para vários).

CREATE TABLE users (
  id          uuid PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Aparelhos com acesso. O token nunca é guardado: só o hash SHA-256 dele.
CREATE TABLE devices (
  id            uuid PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users(id),
  name          text NOT NULL,
  token_hash    text NOT NULL UNIQUE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz,
  revoked_at    timestamptz
);

-- Códigos de pareamento de uso único (também só o hash).
CREATE TABLE pairing_codes (
  code_hash   text PRIMARY KEY,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Cada versão do app de um usuário. Versão 0 = app vazio. Nunca é reescrita:
-- desfazer cria uma versão nova com o conteúdo antigo.
CREATE TABLE app_versions (
  user_id        uuid NOT NULL REFERENCES users(id),
  version        integer NOT NULL,
  spec           jsonb NOT NULL,
  changeset      jsonb,
  source         text NOT NULL CHECK (source IN ('system', 'dev', 'ai', 'restore')),
  level          text NOT NULL CHECK (level IN ('READ', 'SAFE_ACTION', 'CONFIRM', 'CRITICAL')),
  restored_from  integer,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, version)
);

-- Dados das ferramentas. `data` usa o id de cada campo como chave.
-- Apagar = marcar deleted_at (o app sincroniza a remoção).
CREATE TABLE records (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id),
  entity      text NOT NULL,
  data        jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE INDEX records_sync ON records (user_id, updated_at, id);

-- Linha do tempo do Evolution: uma entrada por mudança estrutural.
CREATE TABLE evolution_events (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id),
  version     integer NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('app_started', 'tool_created', 'tool_modified', 'reorganized', 'archived', 'restored')),
  summary     text NOT NULL,
  target      text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (user_id, version) REFERENCES app_versions (user_id, version)
);
CREATE INDEX evolution_by_user ON evolution_events (user_id, created_at DESC);
