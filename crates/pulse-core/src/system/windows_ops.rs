//! Implementação real das operações no Windows.

use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::Command;

use pulse_protocol::control::{Screenshot, ServiceInfo};
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};
use windows::core::{BOOL, PCWSTR};
use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
use windows::Win32::System::Power::SetSuspendState;
use windows::Win32::System::Services::{
    CloseServiceHandle, EnumServicesStatusExW, OpenSCManagerW, ENUM_SERVICE_STATUS_PROCESSW,
    SC_ENUM_PROCESS_INFO, SC_MANAGER_ENUMERATE_SERVICE, SERVICE_ACTIVE, SERVICE_WIN32,
};
use windows::Win32::System::Shutdown::LockWorkStation;
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindow, GetWindowLongPtrW, GetWindowTextLengthW, GetWindowTextW,
    GetWindowThreadProcessId, IsWindowVisible, PostMessageW, GWL_EXSTYLE, GW_OWNER, WM_CLOSE,
    WS_EX_TOOLWINDOW,
};

use super::packaged::{aumid_for, SHELL_PREFIX};
use super::{is_protected, screenshot, OpResult, SystemOps};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const DETACHED_PROCESS: u32 = 0x0000_0008;
/// Tempo para o usuário ver o aviso do Windows (e cancelar com `shutdown /a`).
const POWER_DELAY_SECS: &str = "10";

pub struct WindowsOps;

/// Janela "de app": visível, com título, sem dono, não é tool window e não está
/// escondida pelo DWM (apps UWP suspensos ficam "cloaked").
fn is_app_window(hwnd: HWND) -> bool {
    // SAFETY: consultas de leitura sobre um HWND recebido do EnumWindows.
    unsafe {
        if !IsWindowVisible(hwnd).as_bool() || GetWindowTextLengthW(hwnd) == 0 {
            return false;
        }
        if GetWindow(hwnd, GW_OWNER).is_ok_and(|o| !o.is_invalid()) {
            return false;
        }
        if (GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32) & WS_EX_TOOLWINDOW.0 != 0 {
            return false;
        }
        let mut cloaked = 0u32;
        let _ = DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED,
            &mut cloaked as *mut u32 as *mut _,
            std::mem::size_of::<u32>() as u32,
        );
        cloaked == 0
    }
}

fn top_windows() -> Vec<(HWND, u32)> {
    unsafe extern "system" fn collect(hwnd: HWND, lparam: LPARAM) -> BOOL {
        // SAFETY: lparam aponta para o Vec abaixo durante toda a enumeração.
        let out = unsafe { &mut *(lparam.0 as *mut Vec<(HWND, u32)>) };
        if is_app_window(hwnd) {
            let mut pid = 0u32;
            // SAFETY: HWND válido durante o callback.
            unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
            out.push((hwnd, pid));
        }
        BOOL(1)
    }
    let mut out: Vec<(HWND, u32)> = Vec::new();
    // SAFETY: o callback só escreve em `out`, que vive até o fim da chamada.
    unsafe {
        let _ = EnumWindows(Some(collect), LPARAM(&mut out as *mut _ as isize));
    }
    out
}

fn window_title(hwnd: HWND) -> String {
    let mut buf = [0u16; 512];
    // SAFETY: buffer de tamanho fixo; a API trunca.
    let n = unsafe { GetWindowTextW(hwnd, &mut buf) };
    String::from_utf16_lossy(&buf[..n.max(0) as usize])
}

fn process_name(pid: u32) -> Option<String> {
    let mut sys = System::new();
    let p = Pid::from_u32(pid);
    sys.refresh_processes_specifics(
        ProcessesToUpdate::Some(&[p]),
        true,
        ProcessRefreshKind::nothing(),
    );
    sys.process(p)
        .map(|pr| pr.name().to_string_lossy().into_owned())
}

fn run_shutdown(args: &[&str]) -> OpResult<()> {
    let status = Command::new("shutdown.exe")
        .args(args)
        .creation_flags(CREATE_NO_WINDOW)
        .status()
        .map_err(|e| format!("falha ao chamar shutdown.exe: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("shutdown.exe terminou com {status}"))
    }
}

impl SystemOps for WindowsOps {
    #[cfg(test)]
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn app_windows(&self) -> Vec<(u32, String)> {
        let mut seen = std::collections::HashSet::new();
        top_windows()
            .into_iter()
            .filter(|(_, pid)| seen.insert(*pid))
            .map(|(hwnd, pid)| (pid, window_title(hwnd)))
            .collect()
    }

    fn running_services(&self) -> Vec<ServiceInfo> {
        // SAFETY: duas chamadas (tamanho, dados) com buffer alocado aqui;
        // ponteiros de string apontam para dentro do próprio buffer.
        unsafe {
            let Ok(scm) =
                OpenSCManagerW(PCWSTR::null(), PCWSTR::null(), SC_MANAGER_ENUMERATE_SERVICE)
            else {
                return vec![];
            };
            let mut needed = 0u32;
            let mut count = 0u32;
            let mut resume = 0u32;
            let _ = EnumServicesStatusExW(
                scm,
                SC_ENUM_PROCESS_INFO,
                SERVICE_WIN32,
                SERVICE_ACTIVE,
                None,
                &mut needed,
                &mut count,
                Some(&mut resume),
                PCWSTR::null(),
            );
            let mut buf = vec![0u8; needed as usize + 1024];
            resume = 0;
            let ok = EnumServicesStatusExW(
                scm,
                SC_ENUM_PROCESS_INFO,
                SERVICE_WIN32,
                SERVICE_ACTIVE,
                Some(&mut buf),
                &mut needed,
                &mut count,
                Some(&mut resume),
                PCWSTR::null(),
            );
            let mut out = Vec::new();
            if ok.is_ok() {
                let items = std::slice::from_raw_parts(
                    buf.as_ptr() as *const ENUM_SERVICE_STATUS_PROCESSW,
                    count as usize,
                );
                for it in items {
                    out.push(ServiceInfo {
                        name: it.lpServiceName.to_string().unwrap_or_default(),
                        display_name: it.lpDisplayName.to_string().unwrap_or_default(),
                    });
                }
            }
            let _ = CloseServiceHandle(scm);
            out.sort_by_key(|s| s.display_name.to_lowercase());
            out
        }
    }

    fn launch(&self, path: &Path) -> OpResult<()> {
        // Apps da Store: abre pelo ID (AUMID) via shell, como o menu Iniciar faz.
        let text = path.to_string_lossy();
        let aumid = match text.strip_prefix(SHELL_PREFIX) {
            Some(id) => Some(id.to_owned()),
            None => aumid_for(path),
        };
        if let Some(id) = aumid {
            // explorer.exe devolve código 1 mesmo quando abre; só falha ao iniciar importa.
            return Command::new("explorer.exe")
                .arg(format!("{SHELL_PREFIX}{id}"))
                .spawn()
                .map(|_| ())
                .map_err(|e| format!("não foi possível abrir {id}: {e}"));
        }
        let mut cmd = Command::new(path);
        if let Some(dir) = path.parent() {
            cmd.current_dir(dir);
        }
        cmd.creation_flags(DETACHED_PROCESS)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("não foi possível abrir {}: {e}", path.display()))
    }

    fn close_app(&self, pid: u32) -> OpResult<usize> {
        let name = process_name(pid).ok_or("processo não encontrado")?;
        if is_protected(&name, pid) {
            return Err(format!("{name} é protegido pelo Pulse"));
        }
        let targets: Vec<HWND> = top_windows()
            .into_iter()
            .filter(|(_, p)| *p == pid)
            .map(|(h, _)| h)
            .collect();
        if targets.is_empty() {
            return Err(format!("{name} não tem janelas abertas"));
        }
        for hwnd in &targets {
            // SAFETY: mensagem assíncrona padrão de fechamento.
            unsafe {
                let _ = PostMessageW(Some(*hwnd), WM_CLOSE, WPARAM(0), LPARAM(0));
            }
        }
        Ok(targets.len())
    }

    fn kill(&self, pid: u32) -> OpResult<()> {
        let mut sys = System::new();
        let p = Pid::from_u32(pid);
        sys.refresh_processes_specifics(
            ProcessesToUpdate::Some(&[p]),
            true,
            ProcessRefreshKind::nothing(),
        );
        let proc = sys.process(p).ok_or("processo não encontrado")?;
        let name = proc.name().to_string_lossy().into_owned();
        if is_protected(&name, pid) {
            return Err(format!("{name} é protegido pelo Pulse"));
        }
        if proc.kill() {
            Ok(())
        } else {
            Err(format!("o Windows recusou encerrar {name}"))
        }
    }

    fn screenshot(&self) -> OpResult<Screenshot> {
        screenshot::capture_primary()
    }

    fn lock(&self) -> OpResult<()> {
        // SAFETY: sem parâmetros.
        unsafe { LockWorkStation() }.map_err(|e| format!("falha ao bloquear: {e}"))
    }

    fn suspend(&self) -> OpResult<()> {
        // SAFETY: suspensão (não hibernação), sem forçar.
        if unsafe { SetSuspendState(false, false, false) } {
            Ok(())
        } else {
            Err("o Windows recusou a suspensão".into())
        }
    }

    fn restart(&self) -> OpResult<()> {
        run_shutdown(&[
            "/r",
            "/t",
            POWER_DELAY_SECS,
            "/c",
            "Pulse: reinício pedido pelo iPhone. Para cancelar: shutdown /a",
        ])
    }

    fn shutdown(&self) -> OpResult<()> {
        run_shutdown(&[
            "/s",
            "/t",
            POWER_DELAY_SECS,
            "/c",
            "Pulse: desligamento pedido pelo iPhone. Para cancelar: shutdown /a",
        ])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Só leitura: enumera janelas e serviços reais sem alterar nada.
    #[test]
    fn enumerations_work_on_this_machine() {
        let ops = WindowsOps;
        let services = ops.running_services();
        assert!(!services.is_empty(), "todo Windows tem serviços rodando");
        assert!(services.iter().all(|s| !s.name.is_empty()));
        // Janelas podem ser zero no CI (sem desktop interativo); só não pode travar.
        let _ = ops.app_windows();
    }

    #[test]
    fn refuses_to_touch_protected_or_missing_processes() {
        let ops = WindowsOps;
        assert!(ops.kill(std::process::id()).is_err());
        assert!(ops.kill(4).is_err());
        assert!(ops.close_app(u32::MAX - 1).is_err());
    }
}
