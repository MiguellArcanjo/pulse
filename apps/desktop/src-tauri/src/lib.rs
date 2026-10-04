//! Lado Rust do Pulse Desktop.
//!
//! Fino de propósito: mantém a conexão com o Pulse Core pelo named pipe e
//! repassa estado e eventos para o React. Nenhuma regra de negócio aqui.

mod core_link;

use std::sync::Mutex;

use pulse_protocol::{AuditItem, CoreConnection, Heartbeat};

#[derive(Default)]
pub struct Shared {
    connection: Mutex<Option<CoreConnection>>,
    heartbeat: Mutex<Option<Heartbeat>>,
    /// Auditoria recente, mais nova primeiro.
    audit: Mutex<Vec<AuditItem>>,
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
            recent_audit
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Pulse Desktop");
}
