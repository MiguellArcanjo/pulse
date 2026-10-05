//! Lado Rust do Pulse Desktop.
//!
//! Fino de propósito: mantém a conexão com o Pulse Core pelo named pipe e
//! repassa estado, eventos e pedidos entre ele e o React. Nenhuma regra de
//! negócio aqui: aprovação, revogação e tokens são decididos no Core.

mod core_link;

use std::sync::Mutex;

use pulse_protocol::control::{Action, ActionResult, ControlSnapshot, Level, SecurityPolicy};
use pulse_protocol::ipc::{Request, ResponseData};
use pulse_protocol::remote::DeviceInfo;
use pulse_protocol::{AuditItem, CoreConnection, Heartbeat, PairingTicket};
use tauri::AppHandle;
use tokio::sync::mpsc;

#[derive(Default)]
pub struct Shared {
    connection: Mutex<Option<CoreConnection>>,
    heartbeat: Mutex<Option<Heartbeat>>,
    /// Auditoria recente, mais nova primeiro.
    audit: Mutex<Vec<AuditItem>>,
    devices: Mutex<Vec<DeviceInfo>>,
    /// Canal para pedidos ao Core; `None` quando desconectado.
    requests: Mutex<Option<mpsc::Sender<core_link::Pending>>>,
}

#[tauri::command]
fn core_connection(shared: tauri::State<'_, Shared>) -> CoreConnection {
    shared
        .connection
        .lock()
        .unwrap()
        .clone()
        .unwrap_or(CoreConnection::Connecting)
}

#[tauri::command]
fn last_heartbeat(shared: tauri::State<'_, Shared>) -> Option<Heartbeat> {
    shared.heartbeat.lock().unwrap().clone()
}

#[tauri::command]
fn recent_audit(shared: tauri::State<'_, Shared>) -> Vec<AuditItem> {
    shared.audit.lock().unwrap().clone()
}

#[tauri::command]
fn devices(shared: tauri::State<'_, Shared>) -> Vec<DeviceInfo> {
    shared.devices.lock().unwrap().clone()
}

#[tauri::command]
async fn pairing_create(app: AppHandle) -> Result<PairingTicket, String> {
    match core_link::request(&app, Request::PairingCreate).await? {
        ResponseData::Pairing(ticket) => Ok(ticket),
        _ => Err("Resposta inesperada do Pulse Core.".into()),
    }
}

#[tauri::command]
async fn pairing_approve(app: AppHandle, pairing_id: String, code: String) -> Result<(), String> {
    core_link::request(&app, Request::PairingApprove { pairing_id, code })
        .await
        .map(|_| ())
}

#[tauri::command]
async fn pairing_deny(app: AppHandle, pairing_id: String) -> Result<(), String> {
    core_link::request(&app, Request::PairingDeny { pairing_id })
        .await
        .map(|_| ())
}

#[tauri::command]
async fn device_revoke(app: AppHandle, device_id: String) -> Result<(), String> {
    core_link::request(&app, Request::DeviceRevoke { device_id })
        .await
        .map(|_| ())
}

fn unexpected<T>() -> Result<T, String> {
    Err("Resposta inesperada do Pulse Core.".into())
}

#[tauri::command]
async fn control_snapshot(app: AppHandle) -> Result<ControlSnapshot, String> {
    match core_link::request(&app, Request::ControlSnapshot).await? {
        ResponseData::Control(s) => Ok(s),
        _ => unexpected(),
    }
}

/// A interface do Desktop confirma com o usuário antes de chamar isto.
#[tauri::command]
async fn run_action(app: AppHandle, action: Action) -> Result<ActionResult, String> {
    match core_link::request(&app, Request::RunAction { action }).await? {
        ResponseData::ActionDone(r) => Ok(r),
        _ => unexpected(),
    }
}

#[tauri::command]
async fn allowed_app_add(app: AppHandle, name: String, path: String) -> Result<(), String> {
    core_link::request(&app, Request::AllowedAppAdd { name, path })
        .await
        .map(|_| ())
}

#[tauri::command]
async fn allowed_app_remove(app: AppHandle, id: String) -> Result<(), String> {
    core_link::request(&app, Request::AllowedAppRemove { id })
        .await
        .map(|_| ())
}

#[tauri::command]
async fn device_set_grants(
    app: AppHandle,
    device_id: String,
    grants: Vec<Level>,
) -> Result<(), String> {
    core_link::request(&app, Request::DeviceSetGrants { device_id, grants })
        .await
        .map(|_| ())
}

#[tauri::command]
async fn security_get(app: AppHandle) -> Result<SecurityPolicy, String> {
    match core_link::request(&app, Request::SecurityGet).await? {
        ResponseData::Security(p) => Ok(p),
        _ => unexpected(),
    }
}

#[tauri::command]
async fn security_set(app: AppHandle, policy: SecurityPolicy) -> Result<SecurityPolicy, String> {
    match core_link::request(&app, Request::SecuritySet { policy }).await? {
        ResponseData::Security(p) => Ok(p),
        _ => unexpected(),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Shared::default())
        .setup(|app| {
            tauri::async_runtime::spawn(core_link::run(app.handle().clone()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            core_connection,
            last_heartbeat,
            recent_audit,
            devices,
            pairing_create,
            pairing_approve,
            pairing_deny,
            device_revoke,
            control_snapshot,
            run_action,
            allowed_app_add,
            allowed_app_remove,
            device_set_grants,
            security_get,
            security_set,
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Pulse Desktop");
}
