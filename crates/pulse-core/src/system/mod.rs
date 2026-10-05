//! Operações reais sobre o Windows, atrás de uma interface para que os testes
//! nunca bloqueiem, suspendam ou reiniciem o PC de verdade.

mod gpu;
pub mod packaged;
mod screenshot;
#[cfg(windows)]
mod windows_ops;

use std::path::Path;

use pulse_protocol::control::{Screenshot, ServiceInfo};

pub use gpu::GpuSampler;

#[cfg(windows)]
pub use windows_ops::WindowsOps;

pub type OpResult<T> = Result<T, String>;

/// Processos que o Pulse nunca encerra, mesmo com permissão: derrubá-los
/// trava ou reinicia o Windows.
pub const PROTECTED_PROCESSES: &[&str] = &[
    "system",
    "registry",
    "smss.exe",
    "csrss.exe",
    "wininit.exe",
    "winlogon.exe",
    "services.exe",
    "lsass.exe",
    "lsaiso.exe",
    "fontdrvhost.exe",
    "dwm.exe",
    "memory compression",
    "secure system",
];

pub fn is_protected(name: &str, pid: u32) -> bool {
    pid <= 4 || pid == std::process::id() || {
        let n = name.to_ascii_lowercase();
        PROTECTED_PROCESSES.contains(&n.as_str()) || n.starts_with("pulse-core")
    }
}

pub trait SystemOps: Send + Sync {
    /// Permite aos testes inspecionar a implementação falsa.
    #[cfg(test)]
    fn as_any(&self) -> &dyn std::any::Any;
    /// Janelas de apps visíveis: (pid, título).
    fn app_windows(&self) -> Vec<(u32, String)>;
    fn running_services(&self) -> Vec<ServiceInfo>;
    fn launch(&self, path: &Path) -> OpResult<()>;
    /// Pede às janelas do processo para fecharem. Retorna quantas recebeu o pedido.
    fn close_app(&self, pid: u32) -> OpResult<usize>;
    fn kill(&self, pid: u32) -> OpResult<()>;
    fn screenshot(&self) -> OpResult<Screenshot>;
    fn lock(&self) -> OpResult<()>;
    fn suspend(&self) -> OpResult<()>;
    fn restart(&self) -> OpResult<()>;
    fn shutdown(&self) -> OpResult<()>;
}

/// Implementação de teste: registra as chamadas e não toca no sistema.
#[cfg(test)]
#[derive(Default)]
pub struct FakeOps {
    pub calls: std::sync::Mutex<Vec<String>>,
}

#[cfg(test)]
impl FakeOps {
    fn record(&self, call: String) {
        self.calls.lock().unwrap().push(call);
    }
}

#[cfg(test)]
impl SystemOps for FakeOps {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }
    fn app_windows(&self) -> Vec<(u32, String)> {
        vec![(100, "Documento - Bloco de Notas".into())]
    }
    fn running_services(&self) -> Vec<ServiceInfo> {
        vec![]
    }
    fn launch(&self, path: &Path) -> OpResult<()> {
        self.record(format!("launch {}", path.display()));
        Ok(())
    }
    fn close_app(&self, pid: u32) -> OpResult<usize> {
        self.record(format!("close {pid}"));
        Ok(1)
    }
    fn kill(&self, pid: u32) -> OpResult<()> {
        self.record(format!("kill {pid}"));
        Ok(())
    }
    fn screenshot(&self) -> OpResult<Screenshot> {
        self.record("screenshot".into());
        Ok(Screenshot {
            mime: "image/jpeg".into(),
            base64: "AA".into(),
            width: 1,
            height: 1,
        })
    }
    fn lock(&self) -> OpResult<()> {
        self.record("lock".into());
        Ok(())
    }
    fn suspend(&self) -> OpResult<()> {
        self.record("suspend".into());
        Ok(())
    }
    fn restart(&self) -> OpResult<()> {
        self.record("restart".into());
        Ok(())
    }
    fn shutdown(&self) -> OpResult<()> {
        self.record("shutdown".into());
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn critical_processes_are_protected() {
        assert!(is_protected("lsass.exe", 900));
        assert!(is_protected("CSRSS.EXE", 900));
        assert!(is_protected("qualquer.exe", 4));
        assert!(is_protected("x", std::process::id()));
        assert!(!is_protected("Spotify.exe", 1234));
    }
}
