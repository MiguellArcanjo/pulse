-- M3: apps que o iPhone pode abrir e novo padrão de permissões.

CREATE TABLE allowed_apps (
    id          TEXT PRIMARY KEY NOT NULL,
    name        TEXT NOT NULL,
    path        TEXT NOT NULL UNIQUE,      -- executável absoluto
    created_at  INTEGER NOT NULL
) STRICT;

-- Decisão D9: dispositivo pareado recebe READ + SAFE_ACTION + CONFIRM.
-- Quem foi pareado no M2 (só READ) passa para o novo padrão.
UPDATE devices
SET grants_json = '["READ","SAFE_ACTION","CONFIRM"]'
WHERE grants_json = '["READ"]';
