//! Mensagens do canal local (named pipe) entre o Core e seus clientes locais.
//!
//! Cada frame é um JSON prefixado pelo tamanho (ver `pulse-ipc`).

use serde::{Deserialize, Serialize};

use crate::control::{Action, ActionResult, ControlSnapshot, Level, SecurityPolicy};
use crate::remote::DeviceInfo;
use crate::{AuditItem, CoreStatus, Heartbeat, PairingRequest, PairingResolved, PairingTicket};

/// Tipo de cliente local. Determina o escopo do que ele pode pedir.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ClientKind {
    Desktop,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMessage {
    /// Primeira mensagem obrigatória da conexão.
    Hello {
        protocol_version: u32,
        client: ClientKind,
    },
    Request {
        id: u64,
        #[serde(flatten)]
        request: Request,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "method", content = "params", rename_all = "snake_case")]
pub enum Request {
    CoreStatus,
    Subscribe {
        topics: Vec<Topic>,
    },
    /// Últimas entradas da auditoria, mais recente primeiro.
    RecentAudit {
        limit: u32,
    },
    /// Gera um QR de pareamento (válido por pouco tempo, uso único).
    PairingCreate,
    /// Aprova digitando o código de 6 dígitos que o iPhone mostra.
    PairingApprove {
        pairing_id: String,
        code: String,
    },
    PairingDeny {
        pairing_id: String,
    },
    DevicesList,
    DeviceRevoke {
        device_id: String,
    },
    DeviceSetGrants {
        device_id: String,
        grants: Vec<Level>,
    },
    ControlSnapshot,
    /// O Desktop executa direto: a própria interface já confirmou com o usuário.
    RunAction {
        action: Action,
    },
    AllowedAppAdd {
        name: String,
        path: String,
    },
    AllowedAppRemove {
        id: String,
    },
    SecurityGet,
    SecuritySet {
        policy: SecurityPolicy,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Topic {
    Heartbeat,
    Audit,
    Pairing,
    Devices,
    Security,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMessage {
    Welcome {
        status: CoreStatus,
    },
    Response {
        id: u64,
        #[serde(flatten)]
        outcome: Outcome,
    },
    Event {
        #[serde(flatten)]
        event: Event,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Outcome {
    Ok(ResponseData),
    Error(IpcError),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "data", rename_all = "snake_case")]
pub enum ResponseData {
    CoreStatus(CoreStatus),
    Subscribed { topics: Vec<Topic> },
    Audit(Vec<AuditItem>),
    Pairing(PairingTicket),
    Devices(Vec<DeviceInfo>),
    Control(ControlSnapshot),
    ActionDone(ActionResult),
    Security(SecurityPolicy),
    Done,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IpcError {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "topic", content = "payload", rename_all = "snake_case")]
pub enum Event {
    Heartbeat(Heartbeat),
    /// Nova entrada gravada na auditoria.
    Audit(AuditItem),
    PairingRequested(PairingRequest),
    PairingResolved(PairingResolved),
    DevicesChanged(Vec<DeviceInfo>),
    PolicyChanged(SecurityPolicy),
}

impl Event {
    pub fn topic(&self) -> Topic {
        match self {
            Event::Heartbeat(_) => Topic::Heartbeat,
            Event::Audit(_) => Topic::Audit,
            Event::PairingRequested(_) | Event::PairingResolved(_) => Topic::Pairing,
            Event::DevicesChanged(_) => Topic::Devices,
            Event::PolicyChanged(_) => Topic::Security,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_roundtrip() {
        let msg = ClientMessage::Request {
            id: 7,
            request: Request::Subscribe {
                topics: vec![Topic::Heartbeat],
            },
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert_eq!(
            json,
            r#"{"type":"request","id":7,"method":"subscribe","params":{"topics":["heartbeat"]}}"#
        );
        assert_eq!(serde_json::from_str::<ClientMessage>(&json).unwrap(), msg);
    }

    #[test]
    fn unit_request_roundtrip() {
        let msg = ClientMessage::Request {
            id: 1,
            request: Request::CoreStatus,
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert_eq!(serde_json::from_str::<ClientMessage>(&json).unwrap(), msg);
    }

    #[test]
    fn event_roundtrip() {
        let msg = ServerMessage::Event {
            event: Event::Heartbeat(Heartbeat {
                ts_ms: 1,
                cpu_percent: 12.5,
                mem_used_bytes: 2,
                mem_total_bytes: 4,
                system_disk: Some(crate::DiskUsage {
                    mount: "C:\\".into(),
                    used_bytes: 1,
                    total_bytes: 2,
                }),
                net_rx_bytes_per_sec: 10,
                net_tx_bytes_per_sec: 20,
                process_count: 150,
                gpu_percent: Some(3.5),
                system_uptime_secs: 5,
                core_uptime_secs: 6,
            }),
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert_eq!(serde_json::from_str::<ServerMessage>(&json).unwrap(), msg);
    }

    #[test]
    fn error_response_roundtrip() {
        let msg = ServerMessage::Response {
            id: 3,
            outcome: Outcome::Error(IpcError {
                code: "bad_request".into(),
                message: "x".into(),
            }),
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert_eq!(serde_json::from_str::<ServerMessage>(&json).unwrap(), msg);
    }
}
