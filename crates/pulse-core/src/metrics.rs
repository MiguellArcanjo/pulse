//! Amostragem periódica do PC publicada como evento `heartbeat`.

use std::path::Path;
use std::time::{Duration, Instant};

use pulse_protocol::{ipc::Event, DiskUsage, Heartbeat};
use sysinfo::{Disks, Networks, ProcessRefreshKind, ProcessesToUpdate, System};
use tokio::sync::broadcast;

use crate::now_ms;

pub const INTERVAL: Duration = Duration::from_secs(1);
/// Disco e contagem de processos mudam devagar e custam mais para ler.
const SLOW_EVERY_TICKS: u32 = 5;

pub async fn run(events: broadcast::Sender<Event>, core_started: Instant) {
    let mut sys = System::new();
    let mut networks = Networks::new_with_refreshed_list();
    let mut disks = Disks::new_with_refreshed_list();
    let system_mount = system_drive_mount();

    // CPU e rede são calculados entre duas leituras; a primeira serve de base.
    sys.refresh_cpu_usage();
    let mut last_net = Instant::now();
    let mut process_count = refresh_process_count(&mut sys);
    let mut system_disk = read_disk(&disks, &system_mount);

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
            process_count = refresh_process_count(&mut sys);
            disks.refresh(true);
            system_disk = read_disk(&disks, &system_mount);
        }

        let hb = Heartbeat {
            ts_ms: now_ms(),
            cpu_percent: sys.global_cpu_usage(),
            mem_used_bytes: sys.used_memory(),
            mem_total_bytes: sys.total_memory(),
            system_disk: system_disk.clone(),
            net_rx_bytes_per_sec: (rx as f64 / elapsed) as u64,
            net_tx_bytes_per_sec: (tx as f64 / elapsed) as u64,
            process_count,
            system_uptime_secs: System::uptime(),
            core_uptime_secs: core_started.elapsed().as_secs(),
        };
        // Sem assinantes é normal; o erro só indica isso.
        let _ = events.send(Event::Heartbeat(hb));
    }
}

fn refresh_process_count(sys: &mut System) -> u32 {
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
    sys.processes().len() as u32
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
