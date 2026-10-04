//! API remota (HTTP) — consumida pelo Pulse Mobile via Tailscale Serve.
//!
//! Escuta SOMENTE em 127.0.0.1. Quem publica no tailnet, com HTTPS, é o
//! `tailscale serve`. No M1 há apenas `/v1/health`, pública e sem dados do PC;
//! autenticação por dispositivo chega no M2.

use std::net::{Ipv4Addr, SocketAddr};

use anyhow::{Context, Result};
use axum::{routing::get, Json, Router};
use pulse_protocol::{HealthResponse, PROTOCOL_VERSION};
use tokio::net::TcpListener;

pub const DEFAULT_PORT_PROD: u16 = 47600;
pub const DEFAULT_PORT_DEV: u16 = 47610;

pub fn port(dev: bool) -> Result<u16> {
    match std::env::var("PULSE_REMOTE_PORT") {
        Ok(v) => v.parse().context("PULSE_REMOTE_PORT inválida"),
        Err(_) => Ok(if dev {
            DEFAULT_PORT_DEV
        } else {
            DEFAULT_PORT_PROD
        }),
    }
}

pub async fn bind(port: u16) -> Result<TcpListener> {
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    TcpListener::bind(addr)
        .await
        .with_context(|| format!("porta {port} em uso (defina PULSE_REMOTE_PORT)"))
}

pub async fn serve(listener: TcpListener) {
    if let Err(e) = axum::serve(listener, router()).await {
        tracing::error!("API remota parou: {e}");
    }
}

fn router() -> Router {
    Router::new().route("/v1/health", get(health))
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        ok: true,
        service: "pulse-core".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        protocol_version: PROTOCOL_VERSION,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn health_responds_on_loopback() {
        let listener = bind(0).await.unwrap();
        let addr = listener.local_addr().unwrap();
        assert!(addr.ip().is_loopback());
        tokio::spawn(serve(listener));

        let mut stream = tokio::net::TcpStream::connect(addr).await.unwrap();
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        stream
            .write_all(b"GET /v1/health HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n")
            .await
            .unwrap();
        let mut out = String::new();
        stream.read_to_string(&mut out).await.unwrap();
        assert!(out.starts_with("HTTP/1.1 200"), "{out}");
        assert!(out.contains(r#""ok":true"#), "{out}");
        assert!(out.contains(r#""service":"pulse-core""#), "{out}");
    }
}
