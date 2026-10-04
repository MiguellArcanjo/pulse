//! Estado compartilhado do Core e as operações de domínio que o IPC (Desktop)
//! e a API remota (iPhone) usam. Nenhum dos dois acessa o banco diretamente.

use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

use pulse_db::{AuditEntry, AuditResult, AuditRow, Db, DeviceRow, DeviceStatus, PermissionLevel};
use pulse_protocol::ipc::Event;
use pulse_protocol::remote::{DeviceInfo, RemoteStatus};
use pulse_protocol::{AuditItem, CoreStatus, Heartbeat, PairingResolved, PairingTicket};
use serde_json::Value;
use tokio::sync::broadcast;

use crate::auth::{self, b64, random_bytes};
use crate::pairing::{PairingError, Pairings};
use crate::rate_limit::RateLimiter;
use crate::tailscale;

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub struct State {
    pub status: CoreStatus,
    pub remote_port: u16,
    db: Mutex<Db>,
    pub events: broadcast::Sender<Event>,
    /// Ids de dispositivos revogados agora; streams abertos desses dispositivos fecham.
    pub revocations: broadcast::Sender<String>,
    pub pairings: Mutex<Pairings>,
    pub rate_limit: RateLimiter,
    latest_heartbeat: Mutex<Option<Heartbeat>>,
    /// Streams abertos por dispositivo.
    online: Mutex<HashMap<String, usize>>,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

/// Detalhes opcionais de uma entrada de auditoria.
#[derive(Default)]
pub struct AuditExtra<'a> {
    pub device_id: Option<&'a str>,
    pub level: Option<PermissionLevel>,
    pub params: Option<Value>,
    pub error: Option<&'a str>,
}

pub fn audit_item(r: AuditRow) -> AuditItem {
    AuditItem {
        id: r.id,
        ts_ms: r.ts_ms,
        principal: r.principal,
        module: r.module,
        action: r.action,
        permission_level: r.permission_level,
        result: r.result,
    }
}

#[derive(Debug)]
pub enum OpError {
    Pairing(PairingError),
    NotFound,
    Db(pulse_db::DbError),
}

impl From<pulse_db::DbError> for OpError {
    fn from(e: pulse_db::DbError) -> Self {
        Self::Db(e)
    }
}

impl From<PairingError> for OpError {
    fn from(e: PairingError) -> Self {
        Self::Pairing(e)
    }
}

impl State {
    pub fn new(status: CoreStatus, remote_port: u16, db: Db) -> Self {
        let (events, _) = broadcast::channel(512);
        let (revocations, _) = broadcast::channel(32);
        Self {
            status,
            remote_port,
            db: Mutex::new(db),
            events,
            revocations,
            pairings: Mutex::new(Pairings::default()),
            rate_limit: RateLimiter::default(),
            latest_heartbeat: Mutex::new(None),
            online: Mutex::new(HashMap::new()),
        }
    }

    /// Acesso ao banco. Chamadas são curtas; não segure o guard através de `.await`.
    pub fn db(&self) -> MutexGuard<'_, Db> {
        lock(&self.db)
    }

    pub fn set_heartbeat(&self, hb: Heartbeat) {
        *lock(&self.latest_heartbeat) = Some(hb);
    }

    pub fn remote_status(&self) -> RemoteStatus {
        RemoteStatus {
            hostname: self.status.hostname.clone(),
            os_version: self.status.os_version.clone(),
            core_version: self.status.version.clone(),
            core_started_at_ms: self.status.started_at_ms,
            heartbeat: lock(&self.latest_heartbeat).clone(),
        }
    }

    // ---------- auditoria ----------

    pub fn audit(&self, principal: &str, module: &str, action: &str, result: AuditResult) {
        self.audit_ext(principal, module, action, result, AuditExtra::default());
    }

    pub fn audit_ext(
        &self,
        principal: &str,
        module: &str,
        action: &str,
        result: AuditResult,
        extra: AuditExtra<'_>,
    ) {
        let entry = AuditEntry {
            ts_ms: now_ms(),
            principal,
            device_id: extra.device_id,
            module,
            action,
            params: extra.params.unwrap_or_else(|| serde_json::json!({})),
            permission_level: extra.level.unwrap_or(PermissionLevel::Read),
            result,
            error: extra.error,
            duration_ms: 0,
        };
        let inserted = self.db().audit(&entry);
        match inserted {
            Ok(id) => {
                let _ = self.events.send(Event::Audit(AuditItem {
                    id,
                    ts_ms: entry.ts_ms as i64,
                    principal: principal.to_owned(),
                    module: module.to_owned(),
                    action: action.to_owned(),
                    permission_level: entry.permission_level.as_str().to_owned(),
                    result: result.as_str().to_owned(),
                }));
            }
            Err(e) => tracing::error!("falha ao gravar auditoria ({action}): {e}"),
        }
    }

    // ---------- dispositivos ----------

    pub fn devices(&self) -> Result<Vec<DeviceInfo>, OpError> {
        let rows = self.db().list_devices()?;
        let online = lock(&self.online);
        Ok(rows
            .into_iter()
            .map(|d| DeviceInfo {
                online: online.get(&d.id).copied().unwrap_or(0) > 0,
                status: match d.status {
                    DeviceStatus::Active => "active".into(),
                    DeviceStatus::Revoked => "revoked".into(),
                },
                id: d.id,
                name: d.name,
                model: d.model,
                grants: d.grants,
                paired_at_ms: d.paired_at_ms,
                last_seen_ms: d.last_seen_ms,
            })
            .collect())
    }

    pub fn publish_devices(&self) {
        match self.devices() {
            Ok(list) => {
                let _ = self.events.send(Event::DevicesChanged(list));
            }
            Err(e) => tracing::error!("falha ao listar dispositivos: {e:?}"),
        }
    }

    pub fn stream_opened(&self, device_id: &str) {
        *lock(&self.online).entry(device_id.to_owned()).or_default() += 1;
        let _ = self.db().touch_device(device_id, now_ms() as i64);
        self.publish_devices();
    }

    pub fn stream_closed(&self, device_id: &str) {
        {
            let mut online = lock(&self.online);
            if let Some(n) = online.get_mut(device_id) {
                *n = n.saturating_sub(1);
                if *n == 0 {
                    online.remove(device_id);
                }
            }
        }
        let _ = self.db().touch_device(device_id, now_ms() as i64);
        self.publish_devices();
    }

    /// Revoga um dispositivo. `principal` é quem pediu (Desktop ou o próprio iPhone).
    pub fn revoke_device(
        &self,
        device_id: &str,
        principal: &str,
        reason: &str,
    ) -> Result<(), OpError> {
        let changed = self
            .db()
            .revoke_device(device_id, reason, now_ms() as i64)?;
        if !changed {
            return Err(OpError::NotFound);
        }
        self.after_revocation(device_id, principal, reason);
        Ok(())
    }

    /// Efeitos de uma revogação já gravada no banco: auditoria, fechar streams, avisar o Desktop.
    pub fn after_revocation(&self, device_id: &str, principal: &str, reason: &str) {
        self.audit_ext(
            principal,
            "devices",
            "device.revoked",
            AuditResult::Ok,
            AuditExtra {
                device_id: Some(device_id),
                level: Some(PermissionLevel::Confirm),
                params: Some(serde_json::json!({ "reason": reason })),
                ..Default::default()
            },
        );
        let _ = self.revocations.send(device_id.to_owned());
        self.publish_devices();
    }

    // ---------- pareamento ----------

    pub async fn create_pairing(&self) -> PairingTicket {
        let detection = tailscale::detect(self.remote_port).await;
        let ticket = lock(&self.pairings).create(now_ms());
        let core_url = detection.core_url.unwrap_or_default();
        let mut warnings = detection.warnings;
        if core_url.is_empty() {
            warnings.push("Sem endereço do Core: o iPhone não vai conseguir conectar.".into());
        }
        let qr_payload = format!(
            "pulse://pair?v=1&u={}&p={}&s={}&e={}",
            percent_encode(&core_url),
            ticket.pairing_id,
            ticket.secret_b64,
            ticket.expires_at_ms
        );
        self.audit_ext(
            "local:desktop",
            "devices",
            "pairing.created",
            AuditResult::Ok,
            AuditExtra {
                level: Some(PermissionLevel::Confirm),
                ..Default::default()
            },
        );
        PairingTicket {
            pairing_id: ticket.pairing_id,
            qr_payload,
            core_url,
            expires_at_ms: ticket.expires_at_ms,
            warnings,
        }
    }

    /// Aprovação no Desktop: cria o dispositivo, emite os tokens e os deixa
    /// prontos para o iPhone buscar.
    pub fn approve_pairing(&self, pairing_id: &str) -> Result<(), OpError> {
        let now = now_ms();
        let request = lock(&self.pairings).pending_request(pairing_id, now)?;
        let device_id = b64(&random_bytes::<12>());
        let tokens = {
            let db = self.db();
            db.insert_device(&DeviceRow {
                id: device_id.clone(),
                name: request.device_name.clone(),
                model: request.device_model.clone(),
                status: DeviceStatus::Active,
                grants: vec!["READ".into()],
                paired_at_ms: now as i64,
                last_seen_ms: None,
                revoked_at_ms: None,
            })?;
            auth::issue_tokens(&db, &device_id, now)?
        };
        if let Err(e) = lock(&self.pairings).approve(pairing_id, device_id.clone(), tokens, now) {
            // A sessão venceu entre a leitura e a aprovação: desfaz o dispositivo.
            let _ = self
                .db()
                .revoke_device(&device_id, "pairing_expired", now as i64);
            return Err(e.into());
        }
        self.audit_ext(
            "local:desktop",
            "devices",
            "device.paired",
            AuditResult::Ok,
            AuditExtra {
                device_id: Some(&device_id),
                level: Some(PermissionLevel::Confirm),
                params: Some(serde_json::json!({
                    "name": request.device_name,
                    "model": request.device_model,
                })),
                ..Default::default()
            },
        );
        self.resolve_pairing(pairing_id, "approved");
        self.publish_devices();
        Ok(())
    }

    pub fn deny_pairing(&self, pairing_id: &str) -> Result<(), OpError> {
        lock(&self.pairings).deny(pairing_id, now_ms())?;
        self.audit_ext(
            "local:desktop",
            "devices",
            "pairing.denied",
            AuditResult::Denied,
            AuditExtra {
                level: Some(PermissionLevel::Confirm),
                ..Default::default()
            },
        );
        self.resolve_pairing(pairing_id, "denied");
        Ok(())
    }

    pub fn resolve_pairing(&self, pairing_id: &str, outcome: &str) {
        let _ = self.events.send(Event::PairingResolved(PairingResolved {
            pairing_id: pairing_id.to_owned(),
            outcome: outcome.to_owned(),
        }));
    }

    /// Limpeza periódica: sessões de pareamento e tokens vencidos.
    pub fn sweep(&self) {
        let expired = lock(&self.pairings).sweep(now_ms());
        for id in expired {
            self.resolve_pairing(&id, "expired");
        }
    }

    pub fn prune_tokens(&self) {
        match self.db().prune_tokens(now_ms() as i64) {
            Ok(n) if n > 0 => tracing::info!("{n} tokens vencidos removidos"),
            Ok(_) => {}
            Err(e) => tracing::warn!("falha ao limpar tokens: {e}"),
        }
    }
}

/// Codificação de URL para valores de query (RFC 3986, só não reservados ficam).
fn percent_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percent_encode_url() {
        assert_eq!(
            percent_encode("https://pc.tail1.ts.net"),
            "https%3A%2F%2Fpc.tail1.ts.net"
        );
    }
}
