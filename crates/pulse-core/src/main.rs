//! Pulse Core.
//!
//! Processo em segundo plano, na sessão do usuário. Ele:
//! - abre/migra o SQLite fora do repositório e grava a auditoria;
//! - publica um heartbeat (CPU/RAM/disco/rede) por segundo;
//! - atende o Desktop pelo named pipe restrito ao usuário;
//! - atende o iPhone pela API remota em 127.0.0.1 (publicada via tailscale serve):
//!   pareamento, tokens por dispositivo e stream em tempo real.

mod auth;
mod ipc_server;
mod metrics;
mod pairing;
mod paths;
mod rate_limit;
mod remote_api;
mod state;
mod tailscale;

use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use pulse_db::{AuditResult, Db};
use pulse_ipc::{IpcError, Listener};
use pulse_protocol::{ipc::Event, CoreStatus, PROTOCOL_VERSION};
use tokio::sync::broadcast;

use crate::state::{now_ms, State};

const SWEEP_EVERY: Duration = Duration::from_secs(5);
const PRUNE_EVERY: Duration = Duration::from_secs(3600);

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

    let remote_port = remote_api::port(dev)?;
    let remote_listener = remote_api::bind(remote_port).await?;

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

    let state = Arc::new(State::new(status, remote_port, db));

    state.audit("system", "core", "core.started", AuditResult::Ok);
    tracing::info!(
        "Pulse Core {} ({}) iniciado",
        state.status.version,
        if dev { "dev" } else { "prod" }
    );
    tracing::info!("dados: {}", db_path.display());
    tracing::info!("pipe:  {pipe}");
    tracing::info!(
        "API remota: http://127.0.0.1:{remote_port} (somente local; publique com tailscale serve)"
    );

    tokio::spawn(metrics::run(state.events.clone(), started));
    tokio::spawn(keep_latest_heartbeat(state.clone()));
    tokio::spawn(housekeeping(state.clone()));
    tokio::spawn(ipc_server::serve(listener, state.clone()));
    tokio::spawn(remote_api::serve(remote_listener, state.clone()));

    tokio::signal::ctrl_c().await?;
    state.audit("system", "core", "core.stopped", AuditResult::Ok);
    tracing::info!("Pulse Core encerrado");
    Ok(())
}

/// Guarda o último heartbeat para o snapshot de `/v1/status` e do stream.
async fn keep_latest_heartbeat(state: Arc<State>) {
    let mut rx = state.events.subscribe();
    loop {
        match rx.recv().await {
            Ok(Event::Heartbeat(hb)) => state.set_heartbeat(hb),
            Ok(_) | Err(broadcast::error::RecvError::Lagged(_)) => {}
            Err(broadcast::error::RecvError::Closed) => break,
        }
    }
}

async fn housekeeping(state: Arc<State>) {
    let mut sweep = tokio::time::interval(SWEEP_EVERY);
    let mut prune = tokio::time::interval(PRUNE_EVERY);
    loop {
        tokio::select! {
            _ = sweep.tick() => state.sweep(),
            _ = prune.tick() => state.prune_tokens(),
        }
    }
}
