//! Atende clientes locais no named pipe.

use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

use pulse_db::{AuditEntry, AuditResult, PermissionLevel};
use pulse_ipc::{Channel, IpcError, Listener};
use pulse_protocol::ipc::{
    ClientKind, ClientMessage, Event, IpcError as WireError, Outcome, Request, ResponseData,
    ServerMessage, Topic,
};
use pulse_protocol::{AuditItem, PROTOCOL_VERSION};
use tokio::net::windows::named_pipe::NamedPipeServer;
use tokio::sync::broadcast;

use crate::{now_ms, State};

const HELLO_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_AUDIT_LIMIT: u32 = 200;

pub async fn serve(mut listener: Listener, state: Arc<State>) {
    loop {
        match listener.accept().await {
            Ok(ch) => {
                let state = state.clone();
                tokio::spawn(async move {
                    if let Err(e) = handle(ch, state).await {
                        match e {
                            IpcError::Closed => tracing::debug!("cliente desconectou"),
                            e => tracing::warn!("conexão IPC encerrada com erro: {e}"),
                        }
                    }
                });
            }
            Err(e) => {
                tracing::error!("falha ao aceitar conexão IPC: {e}");
                tokio::time::sleep(Duration::from_millis(200)).await;
            }
        }
    }
}

async fn handle(mut ch: Channel<NamedPipeServer>, state: Arc<State>) -> pulse_ipc::Result<()> {
    let client = match tokio::time::timeout(HELLO_TIMEOUT, ch.recv::<ClientMessage>()).await {
        Ok(Ok(ClientMessage::Hello {
            protocol_version,
            client,
        })) if protocol_version == PROTOCOL_VERSION => client,
        Ok(Ok(ClientMessage::Hello {
            protocol_version, ..
        })) => {
            tracing::warn!("cliente com protocolo {protocol_version}, esperado {PROTOCOL_VERSION}");
            return Ok(());
        }
        _ => {
            tracing::warn!("cliente não enviou hello válido; desconectando");
            return Ok(());
        }
    };

    let principal = principal_for(client);
    state.audit(principal, "ipc", "ipc.client_connected", AuditResult::Ok);
    tracing::info!("{principal} conectado");

    ch.send(&ServerMessage::Welcome {
        status: state.status.clone(),
    })
    .await?;

    let mut events = state.events.subscribe();
    let mut topics: HashSet<Topic> = HashSet::new();

    let result = loop {
        tokio::select! {
            msg = ch.recv::<ClientMessage>() => {
                let msg = match msg {
                    Ok(m) => m,
                    Err(e) => break Err(e),
                };
                let ClientMessage::Request { id, request } = msg else {
                    break Ok(());
                };
                let outcome = match request {
                    Request::CoreStatus => Outcome::Ok(ResponseData::CoreStatus(state.status.clone())),
                    Request::Subscribe { topics: wanted } => {
                        topics.extend(wanted.iter().copied());
                        Outcome::Ok(ResponseData::Subscribed { topics: topics.iter().copied().collect() })
                    }
                    Request::RecentAudit { limit } => state.recent_audit(limit.min(MAX_AUDIT_LIMIT)),
                };
                ch.send(&ServerMessage::Response { id, outcome }).await?;
            }
            ev = events.recv() => {
                match ev {
                    Ok(event) if topics.contains(&event.topic()) => {
                        ch.send(&ServerMessage::Event { event }).await?;
                    }
                    Ok(_) => {}
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        tracing::warn!("{principal} atrasado; {n} eventos descartados");
                    }
                    Err(broadcast::error::RecvError::Closed) => break Ok(()),
                }
            }
        }
    };

    state.audit(principal, "ipc", "ipc.client_disconnected", AuditResult::Ok);
    tracing::info!("{principal} desconectado");
    result
}

fn principal_for(kind: ClientKind) -> &'static str {
    match kind {
        ClientKind::Desktop => "local:desktop",
    }
}

impl State {
    pub fn audit(&self, principal: &str, module: &str, action: &str, result: AuditResult) {
        let entry = AuditEntry {
            ts_ms: now_ms(),
            principal,
            device_id: None,
            module,
            action,
            params: serde_json::json!({}),
            permission_level: PermissionLevel::Read,
            result,
            error: None,
            duration_ms: 0,
        };
        let inserted = {
            let db = self.db.lock().unwrap_or_else(|p| p.into_inner());
            db.audit(&entry)
        };
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

    fn recent_audit(&self, limit: u32) -> Outcome {
        let rows = {
            let db = self.db.lock().unwrap_or_else(|p| p.into_inner());
            db.recent_audit(limit)
        };
        match rows {
            Ok(rows) => Outcome::Ok(ResponseData::Audit(
                rows.into_iter()
                    .map(|r| AuditItem {
                        id: r.id,
                        ts_ms: r.ts_ms,
                        principal: r.principal,
                        module: r.module,
                        action: r.action,
                        permission_level: r.permission_level,
                        result: r.result,
                    })
                    .collect(),
            )),
            Err(e) => {
                tracing::error!("falha ao ler auditoria: {e}");
                Outcome::Error(WireError {
                    code: "db_error".into(),
                    message: "falha ao ler a auditoria".into(),
                })
            }
        }
    }
}
