//! Conexão permanente com o Pulse Core, com reconexão automática.
//!
//! Eventos emitidos para o frontend:
//! - `core://connection` → `CoreConnection`
//! - `core://heartbeat`  → `Heartbeat`
//! - `core://audit`      → `AuditItem[]` (lista recente completa, mais nova primeiro)

use std::time::Duration;

use pulse_ipc::IpcError;
use pulse_protocol::ipc::{
    ClientKind, ClientMessage, Event, Outcome, Request, ResponseData, ServerMessage, Topic,
};
use pulse_protocol::{AuditItem, CoreConnection, PROTOCOL_VERSION};
use tauri::{AppHandle, Emitter, Manager};

use crate::Shared;

const BACKOFF_MIN: Duration = Duration::from_millis(500);
const BACKOFF_MAX: Duration = Duration::from_secs(5);
const AUDIT_KEEP: usize = 50;

pub async fn run(app: AppHandle) {
    let mut backoff = BACKOFF_MIN;
    loop {
        set_connection(&app, CoreConnection::Connecting);
        let reason = match session(&app).await {
            Ok(()) => "o Pulse Core encerrou a conexão".to_owned(),
            Err(e) => describe(&e),
        };
        // Sessão que chegou a conectar reinicia o backoff.
        if matches!(current(&app), Some(CoreConnection::Connected { .. })) {
            backoff = BACKOFF_MIN;
        }
        set_connection(&app, CoreConnection::Disconnected { reason });
        tokio::time::sleep(backoff).await;
        backoff = (backoff * 2).min(BACKOFF_MAX);
    }
}

async fn session(app: &AppHandle) -> pulse_ipc::Result<()> {
    let pipe = pulse_ipc::pipe_name(pulse_ipc::is_dev())?;
    let mut ch = pulse_ipc::connect(&pipe).await?;

    ch.send(&ClientMessage::Hello {
        protocol_version: PROTOCOL_VERSION,
        client: ClientKind::Desktop,
    })
    .await?;

    let status = match ch.recv::<ServerMessage>().await? {
        ServerMessage::Welcome { status } => status,
        _ => return Err(IpcError::Closed),
    };
    set_connection(app, CoreConnection::Connected { status });

    ch.send(&ClientMessage::Request {
        id: 1,
        request: Request::Subscribe {
            topics: vec![Topic::Heartbeat, Topic::Audit],
        },
    })
    .await?;
    // Snapshot depois de assinar: o que chegar nos dois caminhos é deduplicado por id.
    ch.send(&ClientMessage::Request {
        id: 2,
        request: Request::RecentAudit {
            limit: AUDIT_KEEP as u32,
        },
    })
    .await?;

    loop {
        match ch.recv::<ServerMessage>().await? {
            ServerMessage::Event {
                event: Event::Heartbeat(hb),
            } => {
                *app.state::<Shared>().heartbeat.lock().unwrap() = Some(hb.clone());
                let _ = app.emit("core://heartbeat", hb);
            }
            ServerMessage::Event {
                event: Event::Audit(item),
            } => merge_audit(app, vec![item]),
            ServerMessage::Response {
                outcome: Outcome::Ok(ResponseData::Audit(items)),
                ..
            } => merge_audit(app, items),
            ServerMessage::Response { .. } | ServerMessage::Welcome { .. } => {}
        }
    }
}

fn merge_audit(app: &AppHandle, items: Vec<AuditItem>) {
    let shared = app.state::<Shared>();
    let mut list = shared.audit.lock().unwrap();
    for item in items {
        if !list.iter().any(|a| a.id == item.id) {
            list.push(item);
        }
    }
    list.sort_by_key(|a| std::cmp::Reverse(a.id));
    list.truncate(AUDIT_KEEP);
    let snapshot = list.clone();
    drop(list);
    let _ = app.emit("core://audit", snapshot);
}

fn describe(e: &IpcError) -> String {
    const ERROR_FILE_NOT_FOUND: i32 = 2;
    match e {
        IpcError::Io(io) if io.raw_os_error() == Some(ERROR_FILE_NOT_FOUND) => {
            "o Pulse Core não está rodando".to_owned()
        }
        IpcError::Closed => "o Pulse Core encerrou a conexão".to_owned(),
        other => other.to_string(),
    }
}

fn current(app: &AppHandle) -> Option<CoreConnection> {
    app.state::<Shared>().connection.lock().unwrap().clone()
}

fn set_connection(app: &AppHandle, conn: CoreConnection) {
    let shared = app.state::<Shared>();
    let mut slot = shared.connection.lock().unwrap();
    // Não reemite "desconectado → conectando → desconectado" a cada tentativa:
    // enquanto o Core estiver fora, o frontend continua vendo "desconectado".
    if matches!(
        (&*slot, &conn),
        (
            Some(CoreConnection::Disconnected { .. }),
            CoreConnection::Connecting
        )
    ) {
        return;
    }
    if slot.as_ref() == Some(&conn) {
        return;
    }
    *slot = Some(conn.clone());
    drop(slot);
    let _ = app.emit("core://connection", conn);
}
