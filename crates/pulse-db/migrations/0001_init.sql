-- M0: tabelas de base. Entidades de domínio entram nos milestones seguintes.

CREATE TABLE settings (
    key         TEXT PRIMARY KEY NOT NULL,
    value_json  TEXT NOT NULL,
    updated_at  INTEGER NOT NULL
) STRICT;

-- Log de auditoria: append-only. Nunca guardar segredos em params_json.
CREATE TABLE audit_log (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    ts                INTEGER NOT NULL,          -- unix ms
    principal         TEXT NOT NULL,             -- ex.: system, local:desktop, device:<id>
    device_id         TEXT,
    module            TEXT NOT NULL,
    action            TEXT NOT NULL,
    params_json       TEXT NOT NULL DEFAULT '{}',
    permission_level  TEXT NOT NULL,             -- READ | SAFE_ACTION | CONFIRM | CRITICAL
    result            TEXT NOT NULL,             -- ok | error | denied
    error             TEXT,
    duration_ms       INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE INDEX idx_audit_log_ts ON audit_log (ts);

-- Eventos persistidos do Event Bus. `seq` é o cursor de reconexão.
CREATE TABLE events (
    seq             INTEGER PRIMARY KEY AUTOINCREMENT,
    ts              INTEGER NOT NULL,
    topic           TEXT NOT NULL,
    source          TEXT NOT NULL,
    severity        TEXT NOT NULL DEFAULT 'info',
    payload_json    TEXT NOT NULL DEFAULT '{}',
    correlation_id  TEXT
) STRICT;

CREATE INDEX idx_events_topic_ts ON events (topic, ts);
