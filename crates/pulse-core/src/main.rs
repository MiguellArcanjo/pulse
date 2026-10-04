//! Pulse Core.
//!
//! Processo em segundo plano, na sessão do usuário. No M0 ele:
//! - abre/migra o SQLite fora do repositório;
//! - registra início/fim na auditoria;
//! - publica um heartbeat (CPU/RAM) por segundo;
//! - atende o Desktop pelo named pipe restrito ao usuário.

mod ipc_server;
mod metrics;
mod paths;

use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result};
use pulse_db::{AuditResult, Db};
use pulse_ipc::{IpcError, Listener};
use pulse_protocol::{ipc::Event, CoreStatus, PROTOCOL_VERSION};
use tokio::sync::broadcast;

pub struct State {
    pub status: CoreStatus,
    pub db: Mutex<Db>,
    pub events: broadcast::Sender<Event>,
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "pulse_core=info".into()),
        )
        .with_target(false)
        .init();

    if let Err(e) = run().await {
        tracing::error!("{e:#}");
        std::process::exit(1);
    }
}

async fn run() -> Result<()> {
    let started = Instant::now();
    let dev = pulse_ipc::is_dev();
    let data_dir = paths::data_dir(dev)?;
    std::fs::create_dir_all(&data_dir)
        .with_context(|| format!("não foi possível criar {}", data_dir.display()))?;

    let pipe = pulse_ipc::pipe_name(dev)?;
    // Bind antes de abrir o banco: se outro Core já roda, saímos sem tocar em nada.
    let listener = match Listener::bind(&pipe) {
        Ok(l) => l,
        Err(IpcError::AlreadyRunning(_)) => {
            tracing::warn!("já existe um Pulse Core rodando para este usuário; encerrando");
            std::process::exit(2);
        }
        Err(e) => return Err(e).context("falha ao criar o named pipe"),
    };

    let db_path = data_dir.join("pulse.db");
    let db = Db::open(&db_path)
        .with_context(|| format!("falha ao abrir o banco {}", db_path.display()))?;

    let status = CoreStatus {
        version: env!("CARGO_PKG_VERSION").to_owned(),
        protocol_version: PROTOCOL_VERSION,
        pid: std::process::id(),
        hostname: sysinfo::System::host_name().unwrap_or_default(),
        os_version: sysinfo::System::long_os_version().unwrap_or_else(|| "Windows".into()),
        started_at_ms: now_ms(),
        data_dir: data_dir.display().to_string(),
        dev_mode: dev,
    };

    let (events, _) = broadcast::channel(256);
    let state = Arc::new(State {
        status,
        db: Mutex::new(db),
        events: events.clone(),
    });

    state.audit("system", "core", "core.started", AuditResult::Ok);
    tracing::info!(
        "Pulse Core {} ({}) iniciado",
        state.status.version,
        if dev { "dev" } else { "prod" }
    );
    tracing::info!("dados: {}", db_path.display());
    tracing::info!("pipe:  {pipe}");

    tokio::spawn(metrics::run(events, started));
    tokio::spawn(ipc_server::serve(listener, state.clone()));

    tokio::signal::ctrl_c().await?;
    state.audit("system", "core", "core.stopped", AuditResult::Ok);
    tracing::info!("Pulse Core encerrado");
    Ok(())
}
