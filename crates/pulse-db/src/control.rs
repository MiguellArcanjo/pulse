//! Apps permitidos, configurações (chave → JSON) e permissões de dispositivos.

use rusqlite::{params, OptionalExtension};

use crate::{Db, Result};

#[derive(Debug, Clone, PartialEq)]
pub struct AllowedAppRow {
    pub id: String,
    pub name: String,
    pub path: String,
    pub created_at_ms: i64,
}

impl Db {
    pub fn list_allowed_apps(&self) -> Result<Vec<AllowedAppRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, path, created_at FROM allowed_apps ORDER BY name COLLATE NOCASE",
        )?;
        let rows = stmt
            .query_map([], |r| {
                Ok(AllowedAppRow {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    path: r.get(2)?,
                    created_at_ms: r.get(3)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn get_allowed_app(&self, id: &str) -> Result<Option<AllowedAppRow>> {
        Ok(self
            .conn
            .query_row(
                "SELECT id, name, path, created_at FROM allowed_apps WHERE id = ?1",
                [id],
                |r| {
                    Ok(AllowedAppRow {
                        id: r.get(0)?,
                        name: r.get(1)?,
                        path: r.get(2)?,
                        created_at_ms: r.get(3)?,
                    })
                },
            )
            .optional()?)
    }

    /// Insere ou atualiza o nome de um app já cadastrado pelo mesmo caminho.
    pub fn upsert_allowed_app(&self, app: &AllowedAppRow) -> Result<()> {
        self.conn.execute(
            "INSERT INTO allowed_apps (id, name, path, created_at) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(path) DO UPDATE SET name = excluded.name",
            params![app.id, app.name, app.path, app.created_at_ms],
        )?;
        Ok(())
    }

    pub fn delete_allowed_app(&self, id: &str) -> Result<bool> {
        Ok(self
            .conn
            .execute("DELETE FROM allowed_apps WHERE id = ?1", [id])?
            > 0)
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<serde_json::Value>> {
        let raw: Option<String> = self
            .conn
            .query_row(
                "SELECT value_json FROM settings WHERE key = ?1",
                [key],
                |r| r.get(0),
            )
            .optional()?;
        Ok(raw.and_then(|s| serde_json::from_str(&s).ok()))
    }

    pub fn set_setting(&self, key: &str, value: &serde_json::Value, now_ms: i64) -> Result<()> {
        self.conn.execute(
            "INSERT INTO settings (key, value_json, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json,
                                            updated_at = excluded.updated_at",
            params![key, value.to_string(), now_ms],
        )?;
        Ok(())
    }

    pub fn set_device_grants(&self, device_id: &str, grants: &[String]) -> Result<bool> {
        Ok(self.conn.execute(
            "UPDATE devices SET grants_json = ?2 WHERE id = ?1 AND status = 'active'",
            params![
                device_id,
                serde_json::to_string(grants).unwrap_or_else(|_| "[]".into())
            ],
        )? > 0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{DeviceRow, DeviceStatus};

    #[test]
    fn allowed_apps_crud_and_unique_path() {
        let db = Db::open_in_memory().unwrap();
        let app = AllowedAppRow {
            id: "a1".into(),
            name: "VS Code".into(),
            path: r"C:\Code.exe".into(),
            created_at_ms: 1,
        };
        db.upsert_allowed_app(&app).unwrap();
        // Mesmo caminho com outro id só renomeia.
        db.upsert_allowed_app(&AllowedAppRow {
            id: "a2".into(),
            name: "Code".into(),
            ..app.clone()
        })
        .unwrap();
        let list = db.list_allowed_apps().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "Code");
        assert!(db.delete_allowed_app("a1").unwrap());
        assert!(db.get_allowed_app("a1").unwrap().is_none());
    }

    #[test]
    fn settings_roundtrip() {
        let db = Db::open_in_memory().unwrap();
        assert!(db.get_setting("x").unwrap().is_none());
        db.set_setting("x", &serde_json::json!({"a": 1}), 1)
            .unwrap();
        db.set_setting("x", &serde_json::json!({"a": 2}), 2)
            .unwrap();
        assert_eq!(db.get_setting("x").unwrap().unwrap()["a"], 2);
    }

    #[test]
    fn grants_update_only_active_devices() {
        let mut db = Db::open_in_memory().unwrap();
        db.insert_device(&DeviceRow {
            id: "d".into(),
            name: "iPhone".into(),
            model: "".into(),
            status: DeviceStatus::Active,
            grants: vec!["READ".into()],
            paired_at_ms: 0,
            last_seen_ms: None,
            revoked_at_ms: None,
        })
        .unwrap();
        assert!(db
            .set_device_grants("d", &["READ".into(), "CRITICAL".into()])
            .unwrap());
        assert_eq!(
            db.get_device("d").unwrap().unwrap().grants,
            vec!["READ", "CRITICAL"]
        );
        db.revoke_device("d", "x", 1).unwrap();
        assert!(!db.set_device_grants("d", &["READ".into()]).unwrap());
    }
}
