//! Decide se uma ação pode rodar, precisa de confirmação ou é negada.
//!
//! Ordem (docs/ARCHITECTURE.md §24): Lockdown → permissão do dispositivo →
//! nível da ação. O Desktop é o administrador local: não passa por Lockdown nem
//! por confirmação aqui (a própria interface do Desktop confirma), mas tudo é auditado.

use std::collections::HashMap;

use pulse_protocol::control::{Action, Confirmation, Level, SecurityPolicy};

use crate::auth::{b64, random_bytes};

pub const CONFIRMATION_TTL_MS: u64 = 60_000;

pub enum Principal<'a> {
    Desktop,
    Device { grants: &'a [Level] },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Gate {
    Allow,
    Confirm { face_id: bool },
    Deny(Denied),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Denied {
    Lockdown,
    NotGranted(Level),
}

impl Denied {
    pub fn code(self) -> &'static str {
        match self {
            Self::Lockdown => "lockdown",
            Self::NotGranted(_) => "not_granted",
        }
    }

    pub fn message(self) -> String {
        match self {
            Self::Lockdown => {
                "Lockdown Mode ativo: o iPhone está em modo somente leitura. Desative no Pulse Desktop."
                    .into()
            }
            Self::NotGranted(level) => format!(
                "Este iPhone não tem permissão para ações {}. Libere no Pulse Desktop → Dispositivos.",
                level.as_str()
            ),
        }
    }
}

pub fn evaluate(action: &Action, who: &Principal<'_>, policy: &SecurityPolicy) -> Gate {
    let spec = action.spec();
    let Principal::Device { grants, .. } = who else {
        return Gate::Allow;
    };
    // Lockdown: só leitura, exceto o próprio pedido de lockdown.
    if policy.lockdown && spec.level > Level::Read && *action != Action::LockdownEnable {
        return Gate::Deny(Denied::Lockdown);
    }
    if !grants.contains(&spec.level) {
        return Gate::Deny(Denied::NotGranted(spec.level));
    }
    match spec.level {
        Level::Read | Level::SafeAction => Gate::Allow,
        Level::Confirm => Gate::Confirm {
            face_id: spec
                .face_id_scope
                .is_some_and(|s| policy.requires_face_id(s)),
        },
        // CRITICAL sempre exige Face ID, independentemente da configuração.
        Level::Critical => Gate::Confirm { face_id: true },
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfirmError {
    NotFound,
    Expired,
    /// Outro dispositivo ou outra ação: a confirmação não vale para isso.
    Mismatch,
    FaceIdRequired,
}

impl ConfirmError {
    pub fn code(self) -> &'static str {
        match self {
            Self::NotFound => "confirmation_not_found",
            Self::Expired => "confirmation_expired",
            Self::Mismatch => "confirmation_mismatch",
            Self::FaceIdRequired => "face_id_required",
        }
    }

    pub fn message(self) -> &'static str {
        match self {
            Self::NotFound => "Confirmação inválida ou já usada.",
            Self::Expired => "A confirmação expirou; tente de novo.",
            Self::Mismatch => "A confirmação não corresponde a esta ação.",
            Self::FaceIdRequired => "Esta ação exige Face ID.",
        }
    }
}

struct Pending {
    device_id: String,
    action: Action,
    face_id: bool,
    expires_at_ms: u64,
}

/// Confirmações de uso único, presas ao dispositivo e à ação exata (incluindo parâmetros).
#[derive(Default)]
pub struct Confirmations {
    pending: HashMap<String, Pending>,
}

impl Confirmations {
    pub fn create(
        &mut self,
        device_id: &str,
        action: &Action,
        face_id: bool,
        detail: Option<String>,
        now_ms: u64,
    ) -> Confirmation {
        self.pending.retain(|_, p| p.expires_at_ms > now_ms);
        let id = b64(&random_bytes::<16>());
        let spec = action.spec();
        let expires_at_ms = now_ms + CONFIRMATION_TTL_MS;
        self.pending.insert(
            id.clone(),
            Pending {
                device_id: device_id.to_owned(),
                action: action.clone(),
                face_id,
                expires_at_ms,
            },
        );
        Confirmation {
            id,
            level: spec.level,
            summary: spec.summary.into(),
            detail,
            face_id,
            expires_at_ms,
        }
    }

    /// Consome a confirmação (uso único, mesmo que falhe por Face ID ausente).
    pub fn consume(
        &mut self,
        id: &str,
        device_id: &str,
        action: &Action,
        face_id_verified: bool,
        now_ms: u64,
    ) -> Result<(), ConfirmError> {
        let p = self.pending.remove(id).ok_or(ConfirmError::NotFound)?;
        if p.expires_at_ms <= now_ms {
            return Err(ConfirmError::Expired);
        }
        if p.device_id != device_id || p.action != *action {
            return Err(ConfirmError::Mismatch);
        }
        if p.face_id && !face_id_verified {
            return Err(ConfirmError::FaceIdRequired);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DEFAULT_GRANTS: [Level; 3] = [Level::Read, Level::SafeAction, Level::Confirm];

    fn device(grants: &[Level]) -> Principal<'_> {
        Principal::Device { grants }
    }

    #[test]
    fn levels_map_to_gates() {
        let p = SecurityPolicy::default();
        let d = device(&DEFAULT_GRANTS);
        assert_eq!(evaluate(&Action::Lock, &d, &p), Gate::Allow);
        assert_eq!(
            evaluate(&Action::AppClose { pid: 1 }, &d, &p),
            Gate::Confirm { face_id: false }
        );
        assert_eq!(
            evaluate(&Action::Restart, &d, &p),
            Gate::Confirm { face_id: true },
            "energia exige Face ID por padrão"
        );
        let mut relaxed = p.clone();
        relaxed.require_face_id_power = false;
        assert_eq!(
            evaluate(&Action::Shutdown, &d, &relaxed),
            Gate::Confirm { face_id: false }
        );
    }

    #[test]
    fn missing_grant_is_denied() {
        let p = SecurityPolicy::default();
        let read_only = device(&[Level::Read]);
        assert_eq!(
            evaluate(&Action::Lock, &read_only, &p),
            Gate::Deny(Denied::NotGranted(Level::SafeAction))
        );
    }

    #[test]
    fn lockdown_blocks_everything_but_lockdown() {
        let p = SecurityPolicy {
            lockdown: true,
            ..Default::default()
        };
        let d = device(&DEFAULT_GRANTS);
        assert_eq!(
            evaluate(&Action::Lock, &d, &p),
            Gate::Deny(Denied::Lockdown)
        );
        assert_eq!(
            evaluate(&Action::Screenshot, &d, &p),
            Gate::Deny(Denied::Lockdown)
        );
        assert_eq!(evaluate(&Action::LockdownEnable, &d, &p), Gate::Allow);
        // O Desktop não é afetado pelo Lockdown.
        assert_eq!(
            evaluate(&Action::Restart, &Principal::Desktop, &p),
            Gate::Allow
        );
    }

    #[test]
    fn confirmation_is_single_use_and_bound() {
        let mut c = Confirmations::default();
        let conf = c.create("d1", &Action::AppClose { pid: 7 }, false, None, 0);

        // Outra ação (outro pid) não serve.
        assert_eq!(
            c.consume(&conf.id, "d1", &Action::AppClose { pid: 8 }, false, 1),
            Err(ConfirmError::Mismatch)
        );
        // Já foi consumida pela tentativa errada.
        assert_eq!(
            c.consume(&conf.id, "d1", &Action::AppClose { pid: 7 }, false, 1),
            Err(ConfirmError::NotFound)
        );

        let conf = c.create("d1", &Action::AppClose { pid: 7 }, false, None, 0);
        assert_eq!(
            c.consume(&conf.id, "outro", &Action::AppClose { pid: 7 }, false, 1),
            Err(ConfirmError::Mismatch)
        );

        let conf = c.create("d1", &Action::Restart, true, None, 0);
        assert_eq!(
            c.consume(&conf.id, "d1", &Action::Restart, false, 1),
            Err(ConfirmError::FaceIdRequired)
        );

        let conf = c.create("d1", &Action::Restart, true, None, 0);
        assert_eq!(
            c.consume(&conf.id, "d1", &Action::Restart, true, CONFIRMATION_TTL_MS),
            Err(ConfirmError::Expired)
        );

        let conf = c.create("d1", &Action::Restart, true, None, 0);
        assert_eq!(c.consume(&conf.id, "d1", &Action::Restart, true, 1), Ok(()));
    }
}
