//! Descobre, pela CLI oficial do Tailscale, o endereço pelo qual o iPhone
//! alcança o Core e se o `tailscale serve` aponta para a porta certa.
//!
//! Só leitura: o Pulse nunca altera a configuração do Tailscale.

use std::path::PathBuf;
use std::time::Duration;

use serde::Deserialize;
use tokio::process::Command;

const TIMEOUT: Duration = Duration::from_secs(4);

#[derive(Debug, Clone, Default)]
pub struct Detection {
    /// Ex.: `https://miguel.tail790030.ts.net`.
    pub core_url: Option<String>,
    pub warnings: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Status {
    backend_state: Option<String>,
    #[serde(rename = "Self")]
    me: Option<SelfNode>,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct SelfNode {
    #[serde(rename = "DNSName")]
    dns_name: Option<String>,
}

fn exe() -> PathBuf {
    let default = PathBuf::from(r"C:\Program Files\Tailscale\tailscale.exe");
    if default.exists() {
        default
    } else {
        PathBuf::from("tailscale")
    }
}

async fn run(args: &[&str]) -> Option<String> {
    let mut cmd = Command::new(exe());
    cmd.args(args).kill_on_drop(true);
    #[cfg(windows)]
    {
        // CREATE_NO_WINDOW: sem janela de console piscando quando o Core roda oculto.
        cmd.creation_flags(0x0800_0000);
    }
    let out = tokio::time::timeout(TIMEOUT, cmd.output())
        .await
        .ok()?
        .ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

/// `PULSE_PUBLIC_URL` tem prioridade (útil fora do Tailscale ou em testes).
pub async fn detect(remote_port: u16) -> Detection {
    if let Ok(url) = std::env::var("PULSE_PUBLIC_URL") {
        return Detection {
            core_url: Some(url.trim_end_matches('/').to_owned()),
            warnings: vec![],
        };
    }

    let mut d = Detection::default();
    let Some(raw) = run(&["status", "--json"]).await else {
        d.warnings
            .push("Tailscale não encontrado ou parado neste PC.".into());
        return d;
    };
    let Ok(status) = serde_json::from_str::<Status>(&raw) else {
        d.warnings
            .push("Não foi possível ler o status do Tailscale.".into());
        return d;
    };
    if status.backend_state.as_deref() != Some("Running") {
        d.warnings
            .push("Tailscale não está conectado neste PC.".into());
    }
    match status.me.and_then(|m| m.dns_name) {
        Some(name) if !name.is_empty() => {
            d.core_url = Some(format!("https://{}", name.trim_end_matches('.')));
        }
        _ => d
            .warnings
            .push("Este PC não tem nome MagicDNS no Tailscale.".into()),
    }

    let serve = run(&["serve", "status", "--json"])
        .await
        .unwrap_or_default();
    let targets = [
        format!("127.0.0.1:{remote_port}"),
        format!("localhost:{remote_port}"),
    ];
    if !targets.iter().any(|t| serve.contains(t.as_str())) {
        d.warnings.push(format!(
            "O tailscale serve não aponta para o Pulse. Rode: tailscale serve --bg --https=443 http://127.0.0.1:{remote_port}"
        ));
    }
    d
}
