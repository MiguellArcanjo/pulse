//! Conexão permanente com o Pulse Core, com reconexão automática.
//!
//! Eventos emitidos para o frontend:
//! - `core://connection`         → `CoreConnection`
//! - `core://heartbeat`          → `Heartbeat`
//! - `core://audit`              → `AuditItem[]` (lista recente completa, mais nova primeiro)
//! - `core://pairing-requested`  → `PairingRequest`
//! - `core://pairing-resolved`   → `PairingResolved`
//! - `core://devices`            → `DeviceInfo[]`
//! - `core://policy`             → `SecurityPolicy`
//!
//! Comandos do frontend chegam por [`request`], que encaminha ao Core e espera
//! a resposta casando pelo `id`.

use std::collections::HashMap;
use std::time::Duration;

use pulse_ipc::IpcError;
use pulse_protocol::ipc::{
    ClientKind, ClientMessage, Event, Outcome, Request, ResponseData, ServerMessage, Topic,
};
use pulse_protocol::{AuditItem, CoreConnection, PROTOCOL_VERSION};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{mpsc, oneshot};

use crate::Shared;

const BACKOFF_MIN: Duration = Duration::from_millis(500);
const BACKOFF_MAX: Duration = Duration::from_secs(5);
const AUDIT_KEEP: usize = 50;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

/// Pedido do frontend aguardando a resposta do Core.
pub type Pending = (Request, oneshot::Sender<Outcome>);

pub async fn run(app: AppHandle) {
    let mut backoff = BACKOFF_MIN;
    loop {
        set_connection(&app, CoreConnection::Connecting);
        let reason = match session(&app).await {
            Ok(()) => "o Pulse Core encerrou a conexão".to_owned(),
            Err(e) => describe(&e),
        };
        *app.state::<Shared>().requests.lock().unwrap() = None;
        // Sessão que chegou a conectar reinicia o backoff.
        if matches!(current(&app), Some(CoreConnection::Connected { .. })) {
            backoff = BACKOFF_MIN;
        }
        set_connection(&app, CoreConnection::Disconnected { reason });
        tokio::time::sleep(backoff).await;
        backoff = (backoff * 2).min(BACKOFF_MAX);
    }
}

/// Envia um pedido ao Core e espera a resposta.
pub async fn request(app: &AppHandle, req: Request) -> Result<ResponseData, String> {
    let tx = app
        .state::<Shared>()
        .requests
        .lock()
        .unwrap()
        .clone()
        .ok_or("O Pulse Core não está conectado.")?;
    let (reply_tx, reply_rx) = oneshot::channel();
    tx.send((req, reply_tx))
        .await
        .map_err(|_| "O Pulse Core não está conectado.")?;
    match tokio::time::timeout(REQUEST_TIMEOUT, reply_rx).await {
        Ok(Ok(Outcome::Ok(data))) => Ok(data),
        Ok(Ok(Outcome::Error(e))) => Err(e.message),
        Ok(Err(_)) => Err("A conexão com o Pulse Core caiu.".into()),
        Err(_) => Err("O Pulse Core não respondeu a tempo.".into()),
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

    // Ids 1–3 são os pedidos iniciais; os do frontend começam depois.
    ch.send(&ClientMessage::Request {
        id: 1,
        request: Request::Subscribe {
            topics: vec![
                Topic::Heartbeat,
                Topic::Audit,
                Topic::Pairing,
                Topic::Devices,
                Topic::Security,
            ],
        },
    })
    .await?;
    // Snapshots depois de assinar: o que chegar nos dois caminhos é deduplicado.
    ch.send(&ClientMessage::Request {
        id: 2,
        request: Request::RecentAudit {
            limit: AUDIT_KEEP as u32,
        },
    })
    .await?;
    ch.send(&ClientMessage::Request {
        id: 3,
        request: Request::DevicesList,
    })
    .await?;

    let (tx, mut rx) = mpsc::channel::<Pending>(16);
    *app.state::<Shared>().requests.lock().unwrap() = Some(tx);
    set_connection(app, CoreConnection::Connected { status });

    let mut next_id: u64 = 100;
    let mut pending: HashMap<u64, oneshot::Sender<Outcome>> = HashMap::new();

    loop {
        tokio::select! {
            msg = ch.recv::<ServerMessage>() => match msg? {
                ServerMessage::Event { event } => on_event(app, event),
                ServerMessage::Response { id, outcome } => {
                    if let Some(reply) = pending.remove(&id) {
                        let _ = reply.send(outcome);
                    } else {
                        on_snapshot(app, outcome);
                    }
                }
                ServerMessage::Welcome { .. } => {}
            },
            Some((req, reply)) = rx.recv() => {
                next_id += 1;
                pending.insert(next_id, reply);
                ch.send(&ClientMessage::Request { id: next_id, request: req }).await?;
            }
        }
    }
}

fn on_event(app: &AppHandle, event: Event) {
    match event {
        Event::Heartbeat(hb) => {
            *app.state::<Shared>().heartbeat.lock().unwrap() = Some(hb.clone());
            let _ = app.emit("core://heartbeat", hb);
        }
        Event::Audit(item) => merge_audit(app, vec![item]),
        Event::PairingRequested(req) => {
            let _ = app.emit("core://pairing-requested", req);
        }
        Event::PairingResolved(res) => {
            let _ = app.emit("core://pairing-resolved", res);
        }
        Event::DevicesChanged(list) => set_devices(app, list),
        Event::PolicyChanged(policy) => {
            let _ = app.emit("core://policy", policy);
        }
    }
}

fn on_snapshot(app: &AppHandle, outcome: Outcome) {
    match outcome {
        Outcome::Ok(ResponseData::Audit(items)) => merge_audit(app, items),
        Outcome::Ok(ResponseData::Devices(list)) => set_devices(app, list),
        _ => {}
    }
}

fn set_devices(app: &AppHandle, list: Vec<pulse_protocol::remote::DeviceInfo>) {
    *app.state::<Shared>().devices.lock().unwrap() = list.clone();
    let _ = app.emit("core://devices", list);
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
