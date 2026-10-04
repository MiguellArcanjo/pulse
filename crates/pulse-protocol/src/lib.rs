//! Contratos do Pulse.
//!
//! Todo tipo que atravessa uma fronteira de processo (Core ↔ Desktop, Core ↔ Mobile)
//! é definido aqui. Os tipos marcados com `#[ts(export)]` geram TypeScript em
//! `packages/protocol/src/generated` via `pnpm gen:protocol`.

pub mod ipc;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Versão do protocolo IPC. Incrementar em mudanças incompatíveis.
pub const PROTOCOL_VERSION: u32 = 2;

/// Amostra periódica de saúde do PC emitida pelo Core.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Heartbeat {
    /// Unix epoch em milissegundos.
    #[ts(type = "number")]
    pub ts_ms: u64,
    /// Uso global de CPU, 0–100.
    pub cpu_percent: f32,
    #[ts(type = "number")]
    pub mem_used_bytes: u64,
    #[ts(type = "number")]
    pub mem_total_bytes: u64,
    /// Disco do sistema (normalmente `C:`); `None` se não foi possível ler.
    pub system_disk: Option<DiskUsage>,
    /// Bytes/s recebidos somando as interfaces de rede (exceto loopback).
    #[ts(type = "number")]
    pub net_rx_bytes_per_sec: u64,
    /// Bytes/s enviados somando as interfaces de rede (exceto loopback).
    #[ts(type = "number")]
    pub net_tx_bytes_per_sec: u64,
    /// Quantidade de processos em execução.
    pub process_count: u32,
    /// Tempo desde o boot do Windows.
    #[ts(type = "number")]
    pub system_uptime_secs: u64,
    /// Tempo desde que o Core iniciou.
    #[ts(type = "number")]
    pub core_uptime_secs: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DiskUsage {
    /// Ponto de montagem, ex.: `C:\`.
    pub mount: String,
    #[ts(type = "number")]
    pub used_bytes: u64,
    #[ts(type = "number")]
    pub total_bytes: u64,
}

/// Identidade e estado do processo Core.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CoreStatus {
    pub version: String,
    pub protocol_version: u32,
    pub pid: u32,
    pub hostname: String,
    /// Ex.: "Windows 11 Pro".
    pub os_version: String,
    #[ts(type = "number")]
    pub started_at_ms: u64,
    pub data_dir: String,
    pub dev_mode: bool,
}

/// Uma entrada do log de auditoria, como exibida nas interfaces.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AuditItem {
    #[ts(type = "number")]
    pub id: i64,
    #[ts(type = "number")]
    pub ts_ms: i64,
    pub principal: String,
    pub module: String,
    pub action: String,
    pub permission_level: String,
    pub result: String,
}

/// Estado da conexão de um cliente (Desktop) com o Core.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "state", rename_all = "camelCase")]
#[ts(export)]
pub enum CoreConnection {
    Connecting,
    Connected { status: CoreStatus },
    Disconnected { reason: String },
}
