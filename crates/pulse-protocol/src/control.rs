//! Control: ações sobre o PC, níveis de permissão, confirmação e política de segurança.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Níveis de permissão (docs/ARCHITECTURE.md §24), em ordem crescente.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(export)]
pub enum Level {
    Read,
    SafeAction,
    Confirm,
    Critical,
}

impl Level {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Read => "READ",
            Self::SafeAction => "SAFE_ACTION",
            Self::Confirm => "CONFIRM",
            Self::Critical => "CRITICAL",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "READ" => Self::Read,
            "SAFE_ACTION" => Self::SafeAction,
            "CONFIRM" => Self::Confirm,
            "CRITICAL" => Self::Critical,
            _ => return None,
        })
    }
}

/// Ações estruturadas que o Control executa. Nada de comando livre.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "action", content = "params", rename_all = "camelCase")]
#[ts(export)]
pub enum Action {
    /// Abre um app da lista permitida (cadastrada no Desktop).
    #[serde(rename_all = "camelCase")]
    AppLaunch {
        app_id: String,
    },
    /// Pede para o app fechar as janelas (como clicar no X).
    AppClose {
        pid: u32,
    },
    /// Encerra o processo à força.
    ProcessKill {
        pid: u32,
    },
    Screenshot,
    Lock,
    Suspend,
    Restart,
    Shutdown,
    LockdownEnable,
}

/// Escopos em que o Face ID pode ser exigido (configuráveis em `SecurityPolicy`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum FaceIdScope {
    Power,
    Terminal,
    FileDeletion,
    EchoCritical,
}

pub struct ActionSpec {
    /// Nome estável usado na auditoria, ex.: `control.power.restart`.
    pub id: &'static str,
    pub level: Level,
    pub face_id_scope: Option<FaceIdScope>,
    /// Frase curta para a confirmação: "Reiniciar o PC".
    pub summary: &'static str,
}

impl Action {
    pub fn spec(&self) -> ActionSpec {
        use Level::*;
        let (id, level, face_id_scope, summary) = match self {
            Action::AppLaunch { .. } => ("control.app.launch", SafeAction, None, "Abrir app"),
            Action::AppClose { .. } => ("control.app.close", Confirm, None, "Fechar app"),
            Action::ProcessKill { .. } => (
                "control.process.kill",
                Confirm,
                None,
                "Encerrar processo à força",
            ),
            Action::Screenshot => ("control.screenshot", Confirm, None, "Capturar a tela do PC"),
            Action::Lock => ("control.power.lock", SafeAction, None, "Bloquear o PC"),
            Action::Suspend => (
                "control.power.suspend",
                Confirm,
                Some(FaceIdScope::Power),
                "Suspender o PC",
            ),
            Action::Restart => (
                "control.power.restart",
                Confirm,
                Some(FaceIdScope::Power),
                "Reiniciar o PC",
            ),
            Action::Shutdown => (
                "control.power.shutdown",
                Confirm,
                Some(FaceIdScope::Power),
                "Desligar o PC",
            ),
            Action::LockdownEnable => (
                "security.lockdown.enable",
                SafeAction,
                None,
                "Ativar o Lockdown Mode",
            ),
        };
        ActionSpec {
            id,
            level,
            face_id_scope,
            summary,
        }
    }
}

/// Política de segurança, guardada **no Core** para que um app adulterado não
/// consiga simplesmente ignorá-la.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SecurityPolicy {
    /// iPhone vira somente leitura; terminal, ações críticas e Echo bloqueados.
    pub lockdown: bool,
    pub require_face_id_terminal: bool,
    pub require_face_id_power: bool,
    pub require_face_id_file_deletion: bool,
    pub require_face_id_echo_critical: bool,
}

impl Default for SecurityPolicy {
    fn default() -> Self {
        Self {
            lockdown: false,
            require_face_id_terminal: true,
            require_face_id_power: true,
            require_face_id_file_deletion: true,
            require_face_id_echo_critical: true,
        }
    }
}

impl SecurityPolicy {
    pub fn requires_face_id(&self, scope: FaceIdScope) -> bool {
        match scope {
            FaceIdScope::Power => self.require_face_id_power,
            FaceIdScope::Terminal => self.require_face_id_terminal,
            FaceIdScope::FileDeletion => self.require_face_id_file_deletion,
            FaceIdScope::EchoCritical => self.require_face_id_echo_critical,
        }
    }

    /// `true` se `next` não afrouxa nada em relação a `self`.
    pub fn is_stricter_or_equal(&self, next: &Self) -> bool {
        (next.lockdown || !self.lockdown)
            && (next.require_face_id_terminal || !self.require_face_id_terminal)
            && (next.require_face_id_power || !self.require_face_id_power)
            && (next.require_face_id_file_deletion || !self.require_face_id_file_deletion)
            && (next.require_face_id_echo_critical || !self.require_face_id_echo_critical)
    }
}

// ---------- pedido e resposta de ação (API remota) ----------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ActionRequest {
    #[serde(flatten)]
    pub action: Action,
    /// Segunda chamada, depois de o usuário confirmar no iPhone.
    #[serde(default)]
    pub confirmation_id: Option<String>,
    /// O app declara que o Face ID foi aprovado agora (verificado no iPhone).
    #[serde(default)]
    pub face_id_verified: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Confirmation {
    pub id: String,
    pub level: Level,
    pub summary: String,
    /// Ex.: "Fechar Spotify" — detalhes da ação para o usuário conferir.
    pub detail: Option<String>,
    pub face_id: bool,
    #[ts(type = "number")]
    pub expires_at_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Screenshot {
    pub mime: String,
    pub base64: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ActionResult {
    pub message: String,
    pub screenshot: Option<Screenshot>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "status", rename_all = "camelCase")]
#[ts(export)]
pub enum ActionResponse {
    Done {
        result: ActionResult,
    },
    /// O Core precisa que o usuário confirme (e talvez faça Face ID) antes.
    ConfirmationRequired {
        confirmation: Confirmation,
    },
}

// ---------- foto do PC para a tela Control ----------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AppWindow {
    pub pid: u32,
    /// Nome do executável, ex.: `Code.exe`.
    pub process: String,
    pub title: String,
    #[ts(type = "number")]
    pub mem_bytes: u64,
    pub cpu_percent: f32,
    /// Caminho do executável. Só preenchido para o Desktop (permitir o app).
    pub exe_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
    pub cpu_percent: f32,
    #[ts(type = "number")]
    pub mem_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ServiceInfo {
    pub name: String,
    pub display_name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AllowedApp {
    pub id: String,
    pub name: String,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ControlSnapshot {
    /// Apps com janela visível.
    pub apps: Vec<AppWindow>,
    /// Processos que mais usam CPU/RAM.
    pub processes: Vec<ProcessInfo>,
    pub running_services: Vec<ServiceInfo>,
    pub allowed_apps: Vec<AllowedApp>,
    pub policy: SecurityPolicy,
    /// Permissões de quem pediu (no Desktop: todas).
    pub grants: Vec<Level>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn action_request_shape() {
        let json = r#"{"action":"appClose","params":{"pid":42},"confirmationId":"c1","faceIdVerified":false}"#;
        let req: ActionRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.action, Action::AppClose { pid: 42 });
        assert_eq!(req.confirmation_id.as_deref(), Some("c1"));

        let unit: ActionRequest = serde_json::from_str(r#"{"action":"restart"}"#).unwrap();
        assert_eq!(unit.action, Action::Restart);
        assert!(!unit.face_id_verified);

        let launch: ActionRequest =
            serde_json::from_str(r#"{"action":"appLaunch","params":{"appId":"x"}}"#).unwrap();
        assert_eq!(launch.action, Action::AppLaunch { app_id: "x".into() });
    }

    #[test]
    fn levels_are_ordered() {
        assert!(Level::Read < Level::SafeAction);
        assert!(Level::Confirm < Level::Critical);
        assert_eq!(Level::parse("CONFIRM"), Some(Level::Confirm));
        assert_eq!(
            serde_json::to_string(&Level::SafeAction).unwrap(),
            r#""SAFE_ACTION""#
        );
    }

    #[test]
    fn policy_strictness() {
        let base = SecurityPolicy::default();
        let mut lock = base.clone();
        lock.lockdown = true;
        assert!(base.is_stricter_or_equal(&lock));
        assert!(
            !lock.is_stricter_or_equal(&base),
            "desligar lockdown afrouxa"
        );
        let mut no_face = base.clone();
        no_face.require_face_id_power = false;
        assert!(!base.is_stricter_or_equal(&no_face));
    }
}
