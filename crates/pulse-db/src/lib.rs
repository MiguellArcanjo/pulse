//! SQLite do Pulse.
//!
//! O banco vive fora do repositório (ver `pulse-core::paths`). Migrations são
//! embutidas no binário e aplicadas em ordem usando `PRAGMA user_version`.

mod devices;

use std::path::Path;

use rusqlite::{params, Connection, OpenFlags};

pub use devices::{DeviceRow, DeviceStatus, TokenKind, TokenRow};
pub use rusqlite;

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error(transparent)]
    Sqlite(#[from] rusqlite::Error),
    #[error(
        "o banco está na versão {found}, mais nova que a suportada ({supported}); atualize o Pulse"
    )]
    TooNew { found: u32, supported: u32 },
}

pub type Result<T> = std::result::Result<T, DbError>;

/// Migrations em ordem. O índice + 1 é a `user_version` resultante.
const MIGRATIONS: &[&str] = &[
    include_str!("../migrations/0001_init.sql"),
    include_str!("../migrations/0002_devices.sql"),
];

pub struct Db {
    conn: Connection,
}

impl Db {
    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_WRITE
                | OpenFlags::SQLITE_OPEN_CREATE
                | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        Self::init(conn)
    }

    pub fn open_in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> Result<Self> {
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        let mut db = Self { conn };
        db.migrate()?;
        Ok(db)
    }

    pub fn schema_version(&self) -> Result<u32> {
        Ok(self
            .conn
            .pragma_query_value(None, "user_version", |r| r.get(0))?)
    }

    fn migrate(&mut self) -> Result<()> {
        let current = self.schema_version()?;
        let supported = MIGRATIONS.len() as u32;
        if current > supported {
            return Err(DbError::TooNew {
                found: current,
                supported,
            });
        }
        for (i, sql) in MIGRATIONS.iter().enumerate().skip(current as usize) {
            let tx = self.conn.transaction()?;
            tx.execute_batch(sql)?;
            tx.pragma_update(None, "user_version", (i + 1) as u32)?;
            tx.commit()?;
        }
        Ok(())
    }

    pub fn audit(&self, entry: &AuditEntry<'_>) -> Result<i64> {
        self.conn.execute(
            "INSERT INTO audit_log
               (ts, principal, device_id, module, action, params_json,
                permission_level, result, error, duration_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                entry.ts_ms as i64,
                entry.principal,
                entry.device_id,
                entry.module,
                entry.action,
                entry.params.to_string(),
                entry.permission_level.as_str(),
                entry.result.as_str(),
                entry.error,
                entry.duration_ms as i64,
            ],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn recent_audit(&self, limit: u32) -> Result<Vec<AuditRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, ts, principal, module, action, permission_level, result
             FROM audit_log ORDER BY id DESC LIMIT ?1",
        )?;
        let rows = stmt
            .query_map([limit], |r| {
                Ok(AuditRow {
                    id: r.get(0)?,
                    ts_ms: r.get(1)?,
                    principal: r.get(2)?,
                    module: r.get(3)?,
                    action: r.get(4)?,
                    permission_level: r.get(5)?,
                    result: r.get(6)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Entradas com id maior que `after_id`, mais antiga primeiro (retomada de stream).
    pub fn audit_since(&self, after_id: i64, limit: u32) -> Result<Vec<AuditRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, ts, principal, module, action, permission_level, result
             FROM audit_log WHERE id > ?1 ORDER BY id ASC LIMIT ?2",
        )?;
        let rows = stmt
            .query_map(params![after_id, limit], |r| {
                Ok(AuditRow {
                    id: r.get(0)?,
                    ts_ms: r.get(1)?,
                    principal: r.get(2)?,
                    module: r.get(3)?,
                    action: r.get(4)?,
                    permission_level: r.get(5)?,
                    result: r.get(6)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PermissionLevel {
    Read,
    SafeAction,
    Confirm,
    Critical,
}

impl PermissionLevel {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Read => "READ",
            Self::SafeAction => "SAFE_ACTION",
            Self::Confirm => "CONFIRM",
            Self::Critical => "CRITICAL",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuditResult {
    Ok,
    Error,
    Denied,
}

impl AuditResult {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ok => "ok",
            Self::Error => "error",
            Self::Denied => "denied",
        }
    }
}

pub struct AuditEntry<'a> {
    pub ts_ms: u64,
    pub principal: &'a str,
    pub device_id: Option<&'a str>,
    pub module: &'a str,
    pub action: &'a str,
    pub params: serde_json::Value,
    pub permission_level: PermissionLevel,
    pub result: AuditResult,
    pub error: Option<&'a str>,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AuditRow {
    pub id: i64,
    pub ts_ms: i64,
    pub principal: String,
    pub module: String,
    pub action: String,
    pub permission_level: String,
    pub result: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_to_latest() {
        let db = Db::open_in_memory().unwrap();
        assert_eq!(db.schema_version().unwrap(), MIGRATIONS.len() as u32);
    }

    #[test]
    fn migration_is_idempotent_on_reopen() {
        let dir = std::env::temp_dir().join(format!("pulse-db-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("t.db");
        drop(Db::open(&path).unwrap());
        let db = Db::open(&path).unwrap();
        assert_eq!(db.schema_version().unwrap(), MIGRATIONS.len() as u32);
        drop(db);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn audit_insert_and_read() {
        let db = Db::open_in_memory().unwrap();
        db.audit(&AuditEntry {
            ts_ms: 42,
            principal: "system",
            device_id: None,
            module: "core",
            action: "core.started",
            params: serde_json::json!({}),
            permission_level: PermissionLevel::Read,
            result: AuditResult::Ok,
            error: None,
            duration_ms: 0,
        })
        .unwrap();
        let rows = db.recent_audit(10).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].action, "core.started");
        assert_eq!(rows[0].permission_level, "READ");
    }
}
