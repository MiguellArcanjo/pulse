//! Amostragem periódica do PC: heartbeat a cada segundo; processos, disco e
//! GPU a cada 5 s (custam mais para ler e mudam devagar).

use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

use pulse_protocol::control::ProcessInfo;
use pulse_protocol::{ipc::Event, DiskUsage, Heartbeat};
use sysinfo::{Disks, Networks, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

use crate::state::{now_ms, State};
use crate::system::GpuSampler;

pub const INTERVAL: Duration = Duration::from_secs(1);
const SLOW_EVERY_TICKS: u32 = 5;

pub async fn run(state: Arc<State>, core_started: Instant) {
    let mut sys = System::new();
    let mut networks = Networks::new_with_refreshed_list();
    let mut disks = Disks::new_with_refreshed_list();
    let system_mount = system_drive_mount();
    let mut gpu = GpuSampler::new();
    if gpu.is_none() {
        tracing::info!("contador de GPU indisponível; GPU não será exibida");
    }

    // CPU (global e por processo) e rede são taxas: a primeira leitura é a base.
    sys.refresh_cpu_usage();
    let mut last_net = Instant::now();
    refresh_processes(&mut sys);
    let mut system_disk = read_disk(&disks, &system_mount);
    let mut gpu_percent: Option<f32> = None;
    let cpus = sys.cpus().len().max(1) as f32;

    let mut tick = tokio::time::interval(INTERVAL.max(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL));
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    tick.tick().await;
    let mut n: u32 = 0;
    loop {
        tick.tick().await;
        n = n.wrapping_add(1);

        sys.refresh_cpu_usage();
        sys.refresh_memory();

        networks.refresh(true);
        let elapsed = last_net.elapsed().as_secs_f64().max(0.001);
        last_net = Instant::now();
        let (rx, tx) = networks
            .iter()
            .filter(|(name, _)| !is_loopback(name))
            .fold((0u64, 0u64), |(rx, tx), (_, data)| {
                (rx + data.received(), tx + data.transmitted())
            });

        if n.is_multiple_of(SLOW_EVERY_TICKS) {
            refresh_processes(&mut sys);
            let mut exes = HashMap::new();
            let list = sys
                .processes()
                .iter()
                .map(|(pid, p)| {
                    if let Some(exe) = p.exe() {
                        exes.insert(pid.as_u32(), exe.display().to_string());
                    }
                    ProcessInfo {
                        pid: pid.as_u32(),
                        name: p.name().to_string_lossy().into_owned(),
                        // sysinfo soma os núcleos (até 100% × núcleos); normaliza para 0–100.
                        cpu_percent: p.cpu_usage() / cpus,
                        mem_bytes: p.memory(),
                    }
                })
                .collect();
            state.set_processes(list, exes);
            disks.refresh(true);
            system_disk = read_disk(&disks, &system_mount);
            gpu_percent = gpu.as_mut().and_then(|g| g.sample());
        }

        let hb = Heartbeat {
            ts_ms: now_ms(),
            cpu_percent: sys.global_cpu_usage(),
            mem_used_bytes: sys.used_memory(),
            mem_total_bytes: sys.total_memory(),
            system_disk: system_disk.clone(),
            net_rx_bytes_per_sec: (rx as f64 / elapsed) as u64,
            net_tx_bytes_per_sec: (tx as f64 / elapsed) as u64,
            process_count: sys.processes().len() as u32,
            gpu_percent,
            system_uptime_secs: System::uptime(),
            core_uptime_secs: core_started.elapsed().as_secs(),
        };
        state.set_heartbeat(hb.clone());
        // Sem assinantes é normal; o erro só indica isso.
        let _ = state.events.send(Event::Heartbeat(hb));
    }
}

fn refresh_processes(sys: &mut System) {
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing()
            .with_cpu()
            .with_memory()
            // O caminho não muda durante a vida do processo: lê uma vez só.
            .with_exe(UpdateKind::OnlyIfNotSet),
    );
}

/// `C:\` (ou a unidade em `%SystemDrive%`).
fn system_drive_mount() -> String {
    let drive = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into());
    format!("{}\\", drive.trim_end_matches('\\'))
}

fn read_disk(disks: &Disks, mount: &str) -> Option<DiskUsage> {
    disks
        .iter()
        .find(|d| d.mount_point() == Path::new(mount))
        .map(|d| DiskUsage {
            mount: mount.to_owned(),
            used_bytes: d.total_space().saturating_sub(d.available_space()),
            total_bytes: d.total_space(),
        })
}

fn is_loopback(name: &str) -> bool {
    name.to_ascii_lowercase().contains("loopback")
}
