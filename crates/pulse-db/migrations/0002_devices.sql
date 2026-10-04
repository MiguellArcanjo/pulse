-- M2: dispositivos pareados e seus tokens.

CREATE TABLE devices (
    id             TEXT PRIMARY KEY NOT NULL,
    name           TEXT NOT NULL,
    model          TEXT NOT NULL DEFAULT '',
    status         TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
    grants_json    TEXT NOT NULL DEFAULT '["READ"]',
    paired_at      INTEGER NOT NULL,          -- unix ms
    last_seen_at   INTEGER,
    revoked_at     INTEGER,
    revoked_reason TEXT
) STRICT;

-- Só o hash SHA-256 do token é guardado; o token em si nunca toca o disco.
CREATE TABLE device_tokens (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id    TEXT NOT NULL REFERENCES devices (id),
    kind         TEXT NOT NULL CHECK (kind IN ('access', 'refresh')),
    token_hash   TEXT NOT NULL UNIQUE,
    created_at   INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL,
    rotated_at   INTEGER,                     -- refresh já trocado por um novo
    revoked_at   INTEGER
) STRICT;

CREATE INDEX idx_device_tokens_device ON device_tokens (device_id);
