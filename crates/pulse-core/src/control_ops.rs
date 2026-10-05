//! Control: avalia permissão → confirmação → executa → audita.
//!
//! Toda ação do iPhone e do Desktop passa por `run_action`. Nada aqui recebe
//! comando livre: só as variantes de `Action`.

use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

use pulse_db::{AllowedAppRow, AuditResult, DeviceRow, PermissionLevel};
use pulse_protocol::control::{
    Action, ActionRequest, ActionResponse, ActionResult, AllowedApp, AppWindow, ControlSnapshot,
    Level, SecurityPolicy,
};
use pulse_protocol::ipc::Event;
use serde_json::json;

use crate::auth::{b64, random_bytes};
use crate::permissions::{evaluate, ConfirmError, Denied, Gate, Principal};
use crate::state::{now_ms, AuditExtra, State};

const POLICY_KEY: &str = "security.policy";
/// Dá tempo de a resposta HTTP chegar ao iPhone antes de o PC dormir.
const SUSPEND_DELAY: Duration = Duration::from_millis(1500);

/// Quem pede a ação.
pub enum Actor {
    Desktop,
    Device(DeviceRow),
}

impl Actor {
    fn principal(&self) -> String {
        match self {
            Actor::Desktop => "local:desktop".into(),
            Actor::Device(d) => format!("device:{}", d.id),
        }
    }

    fn device_id(&self) -> Option<&str> {
        match self {
            Actor::Desktop => None,
            Actor::Device(d) => Some(&d.id),
        }
    }
}

pub fn grants_of(device: &DeviceRow) -> Vec<Level> {
    device
        .grants
        .iter()
        .filter_map(|g| Level::parse(g))
        .collect()
}

#[derive(Debug, Clone, PartialEq)]
pub enum ActionError {
    Denied(Denied),
    Confirm(ConfirmError),
    NotFound(String),
    BadRequest(String),
    Failed(String),
}

impl ActionError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Denied(d) => d.code(),
            Self::Confirm(c) => c.code(),
            Self::NotFound(_) => "not_found",
            Self::BadRequest(_) => "bad_request",
            Self::Failed(_) => "action_failed",
        }
    }

    pub fn message(&self) -> String {
        match self {
            Self::Denied(d) => d.message(),
            Self::Confirm(c) => c.message().into(),
            Self::NotFound(m) | Self::BadRequest(m) | Self::Failed(m) => m.clone(),
        }
    }
}

fn to_db_level(level: Level) -> PermissionLevel {
    match level {
        Level::Read => PermissionLevel::Read,
        Level::SafeAction => PermissionLevel::SafeAction,
        Level::Confirm => PermissionLevel::Confirm,
        Level::Critical => PermissionLevel::Critical,
    }
}

fn allowed_app(row: AllowedAppRow) -> AllowedApp {
    AllowedApp {
        id: row.id,
        name: row.name,
        path: row.path,
    }
}

impl State {
    // ---------- política de segurança ----------

    pub fn load_policy(&self) {
        let stored = self
            .db()
            .get_setting(POLICY_KEY)
            .ok()
            .flatten()
            .and_then(|v| serde_json::from_value::<SecurityPolicy>(v).ok());
        if let Some(p) = stored {
            *self.policy_slot() = p;
        }
    }

    pub fn policy(&self) -> SecurityPolicy {
        self.policy_slot().clone()
    }

    /// Regras: o Desktop muda tudo. O iPhone só pode **apertar** a política;
    /// afrouxar o Face ID exige Face ID, e desligar o Lockdown só no Desktop (D10).
    pub fn set_policy(
        &self,
        next: SecurityPolicy,
        actor: &Actor,
        face_id_verified: bool,
    ) -> Result<SecurityPolicy, ActionError> {
        let current = self.policy();
        if let Actor::Device(_) = actor {
            if current.lockdown && !next.lockdown {
                return Err(ActionError::Denied(Denied::Lockdown));
            }
            let mut without_lockdown = next.clone();
            without_lockdown.lockdown = current.lockdown;
            if !current.is_stricter_or_equal(&without_lockdown) && !face_id_verified {
                return Err(ActionError::Confirm(ConfirmError::FaceIdRequired));
            }
        }
        if next == current {
            return Ok(current);
        }
        self.db()
            .set_setting(
                POLICY_KEY,
                &serde_json::to_value(&next).expect("política serializável"),
                now_ms() as i64,
            )
            .map_err(|e| ActionError::Failed(e.to_string()))?;
        *self.policy_slot() = next.clone();
        self.audit_ext(
            &actor.principal(),
            "security",
            "security.policy_changed",
            AuditResult::Ok,
            AuditExtra {
                device_id: actor.device_id(),
                level: Some(PermissionLevel::Confirm),
                params: Some(json!({ "from": current, "to": next })),
                ..Default::default()
            },
        );
        let _ = self.events.send(Event::PolicyChanged(next.clone()));
        Ok(next)
    }

    // ---------- foto do PC ----------

    /// `include_paths`: só o Desktop recebe os caminhos dos executáveis.
    pub fn control_snapshot(&self, grants: Vec<Level>, include_paths: bool) -> ControlSnapshot {
        let processes = self.processes();
        let apps = self
            .ops
            .app_windows()
            .into_iter()
            .map(|(pid, title)| {
                let p = processes.iter().find(|p| p.pid == pid);
                AppWindow {
                    pid,
                    process: p.map(|p| p.name.clone()).unwrap_or_default(),
                    title,
                    mem_bytes: p.map(|p| p.mem_bytes).unwrap_or(0),
                    cpu_percent: p.map(|p| p.cpu_percent).unwrap_or(0.0),
                    exe_path: include_paths.then(|| self.process_exe(pid)).flatten(),
                }
            })
            .collect();
        let mut top = processes;
        top.sort_by(|a, b| b.cpu_percent.total_cmp(&a.cpu_percent));
        top.truncate(40);
        ControlSnapshot {
            apps,
            processes: top,
            running_services: self.ops.running_services(),
            allowed_apps: self
                .db()
                .list_allowed_apps()
                .unwrap_or_default()
                .into_iter()
                .map(allowed_app)
                .collect(),
            policy: self.policy(),
            grants,
        }
    }

    /// Nome do processo: da última amostra (5 s) ou, se for mais novo que ela,
    /// consultado na hora — o usuário precisa ver o que vai fechar.
    fn process_name(&self, pid: u32) -> Option<String> {
        if let Some(p) = self.processes().into_iter().find(|p| p.pid == pid) {
            return Some(p.name);
        }
        let mut sys = sysinfo::System::new();
        let id = sysinfo::Pid::from_u32(pid);
        sys.refresh_processes_specifics(
            sysinfo::ProcessesToUpdate::Some(&[id]),
            true,
            sysinfo::ProcessRefreshKind::nothing(),
        );
        sys.process(id)
            .map(|p| p.name().to_string_lossy().into_owned())
    }

    /// Texto para o usuário conferir na confirmação.
    fn describe(&self, action: &Action) -> Option<String> {
        match action {
            Action::AppClose { pid } | Action::ProcessKill { pid } => Some(format!(
                "{} (PID {pid})",
                self.process_name(*pid).unwrap_or_else(|| "processo".into())
            )),
            Action::AppLaunch { app_id } => self
                .db()
                .get_allowed_app(app_id)
                .ok()
                .flatten()
                .map(|a| a.name),
            _ => None,
        }
    }

    // ---------- execução ----------

    pub fn run_action(
        self: &Arc<Self>,
        actor: &Actor,
        req: ActionRequest,
    ) -> Result<ActionResponse, ActionError> {
        let spec = req.action.spec();
        let policy = self.policy();
        let grants = match actor {
            Actor::Device(d) => grants_of(d),
            Actor::Desktop => vec![],
        };
        let principal = match actor {
            Actor::Desktop => Principal::Desktop,
            Actor::Device(_) => Principal::Device { grants: &grants },
        };
        let detail = self.describe(&req.action);
        let audit = |result: AuditResult, error: Option<&str>, duration_ms: u64| {
            self.audit_ext(
                &actor.principal(),
                spec.id.split('.').next().unwrap_or("control"),
                spec.id,
                result,
                AuditExtra {
                    device_id: actor.device_id(),
                    level: Some(to_db_level(spec.level)),
                    params: Some(json!({ "action": req.action, "detail": detail })),
                    error,
                    duration_ms,
                },
            );
        };

        match evaluate(&req.action, &principal, &policy) {
            Gate::Deny(d) => {
                audit(AuditResult::Denied, Some(d.code()), 0);
                return Err(ActionError::Denied(d));
            }
            Gate::Confirm { face_id } => {
                let Actor::Device(device) = actor else {
                    unreachable!("o Desktop nunca recebe Confirm")
                };
                match &req.confirmation_id {
                    None => {
                        let confirmation = self.confirmations().create(
                            &device.id,
                            &req.action,
                            face_id,
                            detail.clone(),
                            now_ms(),
                        );
                        return Ok(ActionResponse::ConfirmationRequired { confirmation });
                    }
                    Some(id) => {
                        if let Err(e) = self.confirmations().consume(
                            id,
                            &device.id,
                            &req.action,
                            req.face_id_verified,
                            now_ms(),
                        ) {
                            audit(AuditResult::Denied, Some(e.code()), 0);
                            return Err(ActionError::Confirm(e));
                        }
                    }
                }
            }
            Gate::Allow => {}
        }

        let started = Instant::now();
        let outcome = self.execute(&req.action, actor);
        let elapsed = started.elapsed().as_millis() as u64;
        match outcome {
            Ok(result) => {
                audit(AuditResult::Ok, None, elapsed);
                Ok(ActionResponse::Done { result })
            }
            Err(e) => {
                audit(AuditResult::Error, Some(e.code()), elapsed);
                Err(e)
            }
        }
    }

    fn execute(
        self: &Arc<Self>,
        action: &Action,
        actor: &Actor,
    ) -> Result<ActionResult, ActionError> {
        let done = |message: String| ActionResult {
            message,
            screenshot: None,
        };
        match action {
            Action::AppLaunch { app_id } => {
                let app = self
                    .db()
                    .get_allowed_app(app_id)
                    .map_err(|e| ActionError::Failed(e.to_string()))?
                    .ok_or_else(|| {
                        ActionError::NotFound("App não está na lista permitida.".into())
                    })?;
                self.ops
                    .launch(Path::new(&app.path))
                    .map_err(ActionError::Failed)?;
                Ok(done(format!("Abrindo {}.", app.name)))
            }
            Action::AppClose { pid } => {
                let name = self
                    .process_name(*pid)
                    .unwrap_or_else(|| format!("PID {pid}"));
                self.ops.close_app(*pid).map_err(ActionError::Failed)?;
                Ok(done(format!("Pedido de fechar enviado para {name}.")))
            }
            Action::ProcessKill { pid } => {
                let name = self
                    .process_name(*pid)
                    .unwrap_or_else(|| format!("PID {pid}"));
                self.ops.kill(*pid).map_err(ActionError::Failed)?;
                Ok(done(format!("{name} encerrado.")))
            }
            Action::Screenshot => {
                let shot = self.ops.screenshot().map_err(ActionError::Failed)?;
                Ok(ActionResult {
                    message: "Tela capturada.".into(),
                    screenshot: Some(shot),
                })
            }
            Action::Lock => {
                self.ops.lock().map_err(ActionError::Failed)?;
                Ok(done("PC bloqueado.".into()))
            }
            Action::Suspend => {
                let me = self.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(SUSPEND_DELAY);
                    if let Err(e) = me.ops.suspend() {
                        tracing::error!("suspensão falhou: {e}");
                    }
                });
                Ok(done("Suspendendo o PC…".into()))
            }
            Action::Restart => {
                self.ops.restart().map_err(ActionError::Failed)?;
                Ok(done("O PC vai reiniciar em 10 segundos.".into()))
            }
            Action::Shutdown => {
                self.ops.shutdown().map_err(ActionError::Failed)?;
                Ok(done("O PC vai desligar em 10 segundos.".into()))
            }
            Action::LockdownEnable => {
                let mut next = self.policy();
                next.lockdown = true;
                self.set_policy(next, actor, false)?;
                Ok(done(
                    "Lockdown Mode ativado. Desative no Pulse Desktop.".into(),
                ))
            }
        }
    }

    // ---------- administração (somente Desktop) ----------

    pub fn allowed_app_add(&self, name: &str, path: &str) -> Result<AllowedApp, ActionError> {
        let p = Path::new(path.trim());
        let is_exe = p.extension().is_some_and(|e| e.eq_ignore_ascii_case("exe"));
        if !p.is_absolute() || !is_exe || !p.is_file() {
            return Err(ActionError::BadRequest(
                "Informe o caminho completo de um arquivo .exe existente.".into(),
            ));
        }
        let name = name.trim();
        let row = AllowedAppRow {
            id: b64(&random_bytes::<9>()),
            name: if name.is_empty() {
                p.file_stem()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_default()
            } else {
                name.to_owned()
            },
            // App da Store: guarda o ID estável, não o caminho com a versão
            // (que muda a cada atualização e não pode ser executado direto).
            path: crate::system::packaged::aumid_for(p)
                .map(|id| format!("{}{id}", crate::system::packaged::SHELL_PREFIX))
                .unwrap_or_else(|| p.display().to_string()),
            created_at_ms: now_ms() as i64,
        };
        self.db()
            .upsert_allowed_app(&row)
            .map_err(|e| ActionError::Failed(e.to_string()))?;
        self.audit_ext(
            "local:desktop",
            "control",
            "control.allowed_app.added",
            AuditResult::Ok,
            AuditExtra {
                level: Some(PermissionLevel::Confirm),
                params: Some(json!({ "name": row.name, "path": row.path })),
                ..Default::default()
            },
        );
        Ok(allowed_app(row))
    }

    pub fn allowed_app_remove(&self, id: &str) -> Result<(), ActionError> {
        if !self
            .db()
            .delete_allowed_app(id)
            .map_err(|e| ActionError::Failed(e.to_string()))?
        {
            return Err(ActionError::NotFound("App não encontrado.".into()));
        }
        self.audit_ext(
            "local:desktop",
            "control",
            "control.allowed_app.removed",
            AuditResult::Ok,
            AuditExtra {
                level: Some(PermissionLevel::Confirm),
                params: Some(json!({ "id": id })),
                ..Default::default()
            },
        );
        Ok(())
    }

    /// READ é sempre mantido: um dispositivo pareado sempre pode ver o PC.
    pub fn device_set_grants(&self, device_id: &str, grants: &[Level]) -> Result<(), ActionError> {
        let mut list: Vec<Level> = grants.to_vec();
        list.push(Level::Read);
        list.sort();
        list.dedup();
        let names: Vec<String> = list.iter().map(|l| l.as_str().to_owned()).collect();
        if !self
            .db()
            .set_device_grants(device_id, &names)
            .map_err(|e| ActionError::Failed(e.to_string()))?
        {
            return Err(ActionError::NotFound("Dispositivo não encontrado.".into()));
        }
        self.audit_ext(
            "local:desktop",
            "devices",
            "device.grants_changed",
            AuditResult::Ok,
            AuditExtra {
                device_id: Some(device_id),
                level: Some(PermissionLevel::Confirm),
                params: Some(json!({ "grants": names })),
                ..Default::default()
            },
        );
        self.publish_devices();
        Ok(())
    }
}
