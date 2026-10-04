//! Contratos da API remota (Core ↔ Pulse Mobile, via Tailscale Serve).
//!
//! Pareamento (ver docs/ARCHITECTURE.md §9):
//! 1. Desktop pede um ticket; o QR leva `pairingId` + `secret` (+ URL do Core).
//! 2. O iPhone gera um `deviceNonce` e prova que tem o segredo:
//!    `proof = HMAC-SHA256(secret, "pulse-pair-v1|claim|{pairingId}|{deviceNonce}")`.
//! 3. Os dois lados mostram o mesmo código de 6 dígitos (`pairing_code`).
//! 4. Aprovado no Desktop, o iPhone recebe os tokens via `poll`
//!    (prova com rótulo `poll`, que só quem tem o nonce consegue gerar).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{AuditItem, Heartbeat};

/// Prefixo de domínio das mensagens HMAC do pareamento.
pub const PAIRING_DOMAIN: &str = "pulse-pair-v1";

/// Dados embutidos no QR Code (serializados como `pulse://pair?...`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PairingQr {
    pub version: u32,
    /// Ex.: `https://meu-pc.tailnet.ts.net`.
    pub core_url: String,
    pub pairing_id: String,
    /// base64url, 32 bytes. Nunca sai do QR; só é usado para HMAC.
    pub secret: String,
    #[ts(type = "number")]
    pub expires_at_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ClaimRequest {
    pub pairing_id: String,
    /// base64url, 32 bytes aleatórios gerados no iPhone.
    pub device_nonce: String,
    /// base64url do HMAC.
    pub proof: String,
    pub device_name: String,
    pub device_model: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PollRequest {
    pub pairing_id: String,
    pub device_nonce: String,
    pub proof: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "status", rename_all = "camelCase")]
#[ts(export)]
pub enum PairingStatus {
    /// Aguardando aprovação no Desktop.
    Pending,
    #[serde(rename_all = "camelCase")]
    Approved {
        device_id: String,
        tokens: TokenPair,
    },
    Denied,
    Expired,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TokenPair {
    pub access_token: String,
    #[ts(type = "number")]
    pub access_expires_at_ms: u64,
    pub refresh_token: String,
    #[ts(type = "number")]
    pub refresh_expires_at_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RefreshRequest {
    pub refresh_token: String,
}

/// Corpo de erro de todas as rotas remotas.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ApiError {
    /// Código estável para o cliente decidir o que fazer (ex.: `unauthorized`,
    /// `device_revoked`, `rate_limited`, `pairing_expired`).
    pub code: String,
    pub message: String,
}

/// O que um dispositivo pareado vê do PC.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RemoteStatus {
    pub hostname: String,
    pub os_version: String,
    pub core_version: String,
    #[ts(type = "number")]
    pub core_started_at_ms: u64,
    pub heartbeat: Option<Heartbeat>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DeviceInfo {
    pub id: String,
    pub name: String,
    pub model: String,
    /// `active` | `revoked`.
    pub status: String,
    /// Conectado agora pelo stream.
    pub online: bool,
    pub grants: Vec<String>,
    #[ts(type = "number")]
    pub paired_at_ms: i64,
    #[ts(type = "number | null")]
    pub last_seen_ms: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DevicesResponse {
    /// Id do dispositivo que fez a chamada.
    pub me: String,
    pub devices: Vec<DeviceInfo>,
}

/// Mensagens do cliente no WebSocket `/v1/stream`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "camelCase")]
#[ts(export)]
pub enum StreamClientMsg {
    /// Primeira mensagem obrigatória. O token não vai na URL para não cair em logs.
    #[serde(rename_all = "camelCase")]
    Auth {
        access_token: String,
        /// Último `AuditItem.id` recebido; o Core reenvia o que veio depois.
        #[ts(type = "number | null")]
        since_audit_id: Option<i64>,
    },
}

/// Mensagens do Core no WebSocket `/v1/stream`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "camelCase")]
#[ts(export)]
pub enum StreamServerMsg {
    Ready {
        status: RemoteStatus,
    },
    Heartbeat {
        heartbeat: Heartbeat,
    },
    Audit {
        item: AuditItem,
    },
    /// Enviada antes de fechar; o cliente deve reagir conforme o código.
    Error {
        error: ApiError,
    },
}

/// Código de 6 dígitos que o Desktop e o iPhone mostram durante o pareamento.
pub fn pairing_code(sas_mac: &[u8]) -> String {
    let n = u32::from_be_bytes([sas_mac[0], sas_mac[1], sas_mac[2], sas_mac[3]]) % 1_000_000;
    format!("{n:06}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pairing_status_shape() {
        let json = serde_json::to_string(&PairingStatus::Pending).unwrap();
        assert_eq!(json, r#"{"status":"pending"}"#);
        let approved = PairingStatus::Approved {
            device_id: "d".into(),
            tokens: TokenPair {
                access_token: "a".into(),
                access_expires_at_ms: 1,
                refresh_token: "r".into(),
                refresh_expires_at_ms: 2,
            },
        };
        let json = serde_json::to_string(&approved).unwrap();
        assert!(
            json.starts_with(r#"{"status":"approved","deviceId":"d","tokens":{"accessToken":"a""#),
            "{json}"
        );
    }

    #[test]
    fn stream_auth_shape() {
        let msg: StreamClientMsg =
            serde_json::from_str(r#"{"type":"auth","accessToken":"t","sinceAuditId":5}"#).unwrap();
        assert_eq!(
            msg,
            StreamClientMsg::Auth {
                access_token: "t".into(),
                since_audit_id: Some(5)
            }
        );
    }

    #[test]
    fn pairing_code_is_six_digits() {
        assert_eq!(pairing_code(&[0, 0, 0, 7, 9, 9]), "000007");
        assert_eq!(pairing_code(&[0xff, 0xff, 0xff, 0xff]), "967295");
    }
}
