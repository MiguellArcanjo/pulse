//! Dispositivos pareados e tokens (somente hashes).

use rusqlite::{params, OptionalExtension, Row};

use crate::{Db, Result};

#[derive(Debug, Clone, PartialEq)]
pub struct DeviceRow {
    pub id: String,
    pub name: String,
    pub model: String,
    pub status: DeviceStatus,
    pub grants: Vec<String>,
    pub paired_at_ms: i64,
    pub last_seen_ms: Option<i64>,
    pub revoked_at_ms: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeviceStatus {
    Active,
    Revoked,
}

impl DeviceStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Revoked => "revoked",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TokenKind {
    Access,
    Refresh,
}

impl TokenKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Access => "access",
            Self::Refresh => "refresh",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct TokenRow {
    pub id: i64,
    pub device_id: String,
    pub kind: TokenKind,
    pub expires_at_ms: i64,
    pub rotated_at_ms: Option<i64>,
    pub revoked_at_ms: Option<i64>,
}

fn device_from_row(r: &Row<'_>) -> rusqlite::Result<DeviceRow> {
    let status: String = r.get(3)?;
    let grants: String = r.get(4)?;
    Ok(DeviceRow {
        id: r.get(0)?,
        name: r.get(1)?,
        model: r.get(2)?,
        status: if status == "active" {
            DeviceStatus::Active
        } else {
            DeviceStatus::Revoked
        },
        grants: serde_json::from_str(&grants).unwrap_or_default(),
        paired_at_ms: r.get(5)?,
        last_seen_ms: r.get(6)?,
        revoked_at_ms: r.get(7)?,
    })
}

const DEVICE_COLS: &str =
    "id, name, model, status, grants_json, paired_at, last_seen_at, revoked_at";

impl Db {
    pub fn insert_device(&self, d: &DeviceRow) -> Result<()> {
        self.conn.execute(
            "INSERT INTO devices (id, name, model, status, grants_json, paired_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                d.id,
                d.name,
                d.model,
                d.status.as_str(),
                serde_json::to_string(&d.grants).unwrap_or_else(|_| "[]".into()),
                d.paired_at_ms,
            ],
        )?;
        Ok(())
    }

    pub fn list_devices(&self) -> Result<Vec<DeviceRow>> {
        let mut stmt = self.conn.prepare(&format!(
            "SELECT {DEVICE_COLS} FROM devices ORDER BY status = 'revoked', paired_at DESC"
        ))?;
        let rows = stmt
            .query_map([], device_from_row)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn get_device(&self, id: &str) -> Result<Option<DeviceRow>> {
        Ok(self
            .conn
            .query_row(
                &format!("SELECT {DEVICE_COLS} FROM devices WHERE id = ?1"),
                [id],
                device_from_row,
            )
            .optional()?)
    }

    pub fn touch_device(&self, id: &str, now_ms: i64) -> Result<()> {
        self.conn.execute(
            "UPDATE devices SET last_seen_at = ?2 WHERE id = ?1",
            params![id, now_ms],
        )?;
        Ok(())
    }

    /// Revoga o dispositivo e todos os seus tokens. Retorna `false` se ele não
    /// existia ou já estava revogado.
    pub fn revoke_device(&mut self, id: &str, reason: &str, now_ms: i64) -> Result<bool> {
        let tx = self.conn.transaction()?;
        let changed = tx.execute(
            "UPDATE devices SET status = 'revoked', revoked_at = ?2, revoked_reason = ?3
             WHERE id = ?1 AND status = 'active'",
            params![id, now_ms, reason],
        )?;
        tx.execute(
            "UPDATE device_tokens SET revoked_at = ?2 WHERE device_id = ?1 AND revoked_at IS NULL",
            params![id, now_ms],
        )?;
        tx.commit()?;
        Ok(changed > 0)
    }

    pub fn insert_token(
        &self,
        device_id: &str,
        kind: TokenKind,
        token_hash: &str,
        now_ms: i64,
        expires_at_ms: i64,
    ) -> Result<()> {
        self.conn.execute(
            "INSERT INTO device_tokens (device_id, kind, token_hash, created_at, expires_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![device_id, kind.as_str(), token_hash, now_ms, expires_at_ms],
        )?;
        Ok(())
    }

    pub fn find_token(&self, token_hash: &str) -> Result<Option<TokenRow>> {
        Ok(self
            .conn
            .query_row(
                "SELECT id, device_id, kind, expires_at, rotated_at, revoked_at
                 FROM device_tokens WHERE token_hash = ?1",
                [token_hash],
                |r| {
                    let kind: String = r.get(2)?;
                    Ok(TokenRow {
                        id: r.get(0)?,
                        device_id: r.get(1)?,
                        kind: if kind == "access" {
                            TokenKind::Access
                        } else {
                            TokenKind::Refresh
                        },
                        expires_at_ms: r.get(3)?,
                        rotated_at_ms: r.get(4)?,
                        revoked_at_ms: r.get(5)?,
                    })
                },
            )
            .optional()?)
    }

    pub fn mark_token_rotated(&self, token_id: i64, now_ms: i64) -> Result<()> {
        self.conn.execute(
            "UPDATE device_tokens SET rotated_at = ?2 WHERE id = ?1",
            params![token_id, now_ms],
        )?;
        Ok(())
    }

    /// Remove tokens expirados há mais de um dia (limpeza periódica).
    pub fn prune_tokens(&self, now_ms: i64) -> Result<usize> {
        Ok(self.conn.execute(
            "DELETE FROM device_tokens WHERE expires_at < ?1",
            [now_ms - 86_400_000],
        )?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn device(id: &str) -> DeviceRow {
        DeviceRow {
            id: id.into(),
            name: "iPhone de Teste".into(),
            model: "iPhone15,4".into(),
            status: DeviceStatus::Active,
            grants: vec!["READ".into()],
            paired_at_ms: 1,
            last_seen_ms: None,
            revoked_at_ms: None,
        }
    }

    #[test]
    fn device_and_token_lifecycle() {
        let mut db = Db::open_in_memory().unwrap();
        db.insert_device(&device("d1")).unwrap();
        db.insert_token("d1", TokenKind::Refresh, "h1", 10, 1000)
            .unwrap();

        let t = db.find_token("h1").unwrap().unwrap();
        assert_eq!(t.device_id, "d1");
        assert_eq!(t.kind, TokenKind::Refresh);
        assert!(t.revoked_at_ms.is_none());

        db.mark_token_rotated(t.id, 20).unwrap();
        assert_eq!(
            db.find_token("h1").unwrap().unwrap().rotated_at_ms,
            Some(20)
        );

        assert!(db.revoke_device("d1", "teste", 30).unwrap());
        assert!(!db.revoke_device("d1", "teste", 31).unwrap(), "já revogado");
        let d = db.get_device("d1").unwrap().unwrap();
        assert_eq!(d.status, DeviceStatus::Revoked);
        assert_eq!(
            db.find_token("h1").unwrap().unwrap().revoked_at_ms,
            Some(30)
        );
    }

    #[test]
    fn token_hash_is_unique() {
        let db = Db::open_in_memory().unwrap();
        db.insert_device(&device("d1")).unwrap();
        db.insert_token("d1", TokenKind::Access, "same", 0, 1)
            .unwrap();
        assert!(db
            .insert_token("d1", TokenKind::Access, "same", 0, 1)
            .is_err());
    }
}
