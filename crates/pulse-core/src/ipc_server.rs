//! Atende clientes locais no named pipe.

use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

use pulse_db::AuditResult;
use pulse_ipc::{Channel, IpcError, Listener};
use pulse_protocol::ipc::{
    ClientKind, ClientMessage, IpcError as WireError, Outcome, Request, ResponseData,
    ServerMessage, Topic,
};
use pulse_protocol::PROTOCOL_VERSION;
use tokio::net::windows::named_pipe::NamedPipeServer;
use tokio::sync::broadcast;

use crate::state::{audit_item, OpError, State};

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
                let outcome = dispatch(&state, request, &mut topics).await;
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

async fn dispatch(state: &State, request: Request, topics: &mut HashSet<Topic>) -> Outcome {
    let result: Result<ResponseData, OpError> = match request {
        Request::CoreStatus => Ok(ResponseData::CoreStatus(state.status.clone())),
        Request::Subscribe { topics: wanted } => {
            topics.extend(wanted.iter().copied());
            Ok(ResponseData::Subscribed {
                topics: topics.iter().copied().collect(),
            })
        }
        Request::RecentAudit { limit } => state
            .db()
            .recent_audit(limit.min(MAX_AUDIT_LIMIT))
            .map(|rows| ResponseData::Audit(rows.into_iter().map(audit_item).collect()))
            .map_err(OpError::from),
        Request::PairingCreate => Ok(ResponseData::Pairing(state.create_pairing().await)),
        Request::PairingApprove { pairing_id, code } => state
            .approve_pairing(&pairing_id, &code)
            .map(|()| ResponseData::Done),
        Request::PairingDeny { pairing_id } => {
            state.deny_pairing(&pairing_id).map(|()| ResponseData::Done)
        }
        Request::DevicesList => state.devices().map(ResponseData::Devices),
        Request::DeviceRevoke { device_id } => state
            .revoke_device(&device_id, "local:desktop", "revoked_from_desktop")
            .map(|()| ResponseData::Done),
    };
    match result {
        Ok(data) => Outcome::Ok(data),
        Err(e) => Outcome::Error(wire_error(e)),
    }
}

fn wire_error(e: OpError) -> WireError {
    match e {
        OpError::Pairing(p) => WireError {
            code: p.code().into(),
            message: p.message().into(),
        },
        OpError::NotFound => WireError {
            code: "not_found".into(),
            message: "Não encontrado.".into(),
        },
        OpError::Db(e) => {
            tracing::error!("erro de banco no IPC: {e}");
            WireError {
                code: "db_error".into(),
                message: "Falha ao acessar o banco do Pulse.".into(),
            }
        }
    }
}

fn principal_for(kind: ClientKind) -> &'static str {
    match kind {
        ClientKind::Desktop => "local:desktop",
    }
}
