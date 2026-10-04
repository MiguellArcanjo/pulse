//! API remota (HTTP + WebSocket) — consumida pelo Pulse Mobile via Tailscale Serve.
//!
//! Escuta SOMENTE em 127.0.0.1. Quem publica no tailnet, com HTTPS, é o
//! `tailscale serve`.
//!
//! | Rota | Auth |
//! |---|---|
//! | `GET  /v1/health` | pública, sem dados do PC |
//! | `POST /v1/pairing/claim`, `POST /v1/pairing/poll` | prova HMAC do QR |
//! | `POST /v1/auth/refresh` | token de renovação |
//! | `GET  /v1/status`, `GET /v1/devices`, `POST /v1/devices/me/revoke` | Bearer (acesso) |
//! | `GET  /v1/stream` (WebSocket) | token na 1ª mensagem |

use std::net::{Ipv4Addr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use axum::extract::ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade};
use axum::extract::{FromRequestParts, State as AxState};
use axum::http::request::Parts;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use pulse_db::{AuditResult, DeviceRow, PermissionLevel};
use pulse_protocol::ipc::Event;
use pulse_protocol::remote::{
    ApiError, ClaimRequest, DevicesResponse, PairingStatus, PollRequest, RefreshRequest,
    RemoteStatus, StreamClientMsg, StreamServerMsg, TokenPair,
};
use pulse_protocol::{HealthResponse, PROTOCOL_VERSION};
use tokio::net::TcpListener;
use tokio::sync::broadcast;

use crate::auth::{self, AuthError};
use crate::pairing::PairingError;
use crate::rate_limit::Bucket;
use crate::state::{audit_item, now_ms, AuditExtra, State};

pub const DEFAULT_PORT_PROD: u16 = 47600;
pub const DEFAULT_PORT_DEV: u16 = 47610;

const STREAM_AUTH_TIMEOUT: Duration = Duration::from_secs(5);
const STREAM_PING_EVERY: Duration = Duration::from_secs(20);
const STREAM_REPLAY_LIMIT: u32 = 200;

/// Códigos de fechamento do WebSocket (faixa 4000–4999 é da aplicação).
pub const CLOSE_BAD_REQUEST: u16 = 4400;
pub const CLOSE_UNAUTHORIZED: u16 = 4401;
pub const CLOSE_REVOKED: u16 = 4403;

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

pub async fn serve(listener: TcpListener, state: Arc<State>) {
    if let Err(e) = axum::serve(listener, router(state)).await {
        tracing::error!("API remota parou: {e}");
    }
}

pub fn router(state: Arc<State>) -> Router {
    Router::new()
        .route("/v1/health", get(health))
        .route("/v1/pairing/claim", post(pairing_claim))
        .route("/v1/pairing/poll", post(pairing_poll))
        .route("/v1/auth/refresh", post(auth_refresh))
        .route("/v1/status", get(status))
        .route("/v1/devices", get(devices))
        .route("/v1/devices/me/revoke", post(revoke_me))
        .route("/v1/stream", get(stream))
        .with_state(state)
}

// ---------- erros ----------

pub struct ApiErr(StatusCode, &'static str, String);

impl ApiErr {
    fn new(status: StatusCode, code: &'static str, message: impl Into<String>) -> Self {
        Self(status, code, message.into())
    }

    fn internal() -> Self {
        Self::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal",
            "Erro interno do Pulse Core.",
        )
    }

    fn rate_limited() -> Self {
        Self::new(
            StatusCode::TOO_MANY_REQUESTS,
            "rate_limited",
            "Muitas requisições; tente de novo em instantes.",
        )
    }
}

impl From<AuthError> for ApiErr {
    fn from(e: AuthError) -> Self {
        let status = match e {
            AuthError::RefreshSuperseded => StatusCode::CONFLICT,
            _ => StatusCode::UNAUTHORIZED,
        };
        Self::new(status, e.code(), e.message())
    }
}

impl From<PairingError> for ApiErr {
    fn from(e: PairingError) -> Self {
        let status = match e {
            PairingError::NotFound => StatusCode::NOT_FOUND,
            PairingError::Expired => StatusCode::GONE,
            PairingError::AlreadyClaimed | PairingError::WrongState => StatusCode::CONFLICT,
            PairingError::InvalidProof => StatusCode::UNAUTHORIZED,
            PairingError::BadRequest => StatusCode::BAD_REQUEST,
        };
        Self::new(status, e.code(), e.message())
    }
}

impl From<pulse_db::DbError> for ApiErr {
    fn from(e: pulse_db::DbError) -> Self {
        tracing::error!("erro de banco na API remota: {e}");
        Self::internal()
    }
}

impl IntoResponse for ApiErr {
    fn into_response(self) -> Response {
        let body = ApiError {
            code: self.1.into(),
            message: self.2,
        };
        (self.0, Json(body)).into_response()
    }
}

/// Identifica a origem para o rate limit. Atrás do `tailscale serve` a conexão
/// vem de 127.0.0.1, então usamos os headers que ele adiciona.
fn client_key(headers: &HeaderMap) -> String {
    for name in ["x-forwarded-for", "tailscale-user-login"] {
        if let Some(v) = headers.get(name).and_then(|v| v.to_str().ok()) {
            if let Some(first) = v.split(',').next() {
                return first.trim().to_owned();
            }
        }
    }
    "local".into()
}

fn limit(state: &State, bucket: Bucket, key: &str) -> Result<(), ApiErr> {
    if state.rate_limit.check(bucket, key, now_ms()) {
        Ok(())
    } else {
        Err(ApiErr::rate_limited())
    }
}

// ---------- autenticação ----------

/// Dispositivo autenticado por `Authorization: Bearer pa_...`.
pub struct Device(pub DeviceRow);

impl FromRequestParts<Arc<State>> for Device {
    type Rejection = ApiErr;

    async fn from_request_parts(parts: &mut Parts, state: &Arc<State>) -> Result<Self, ApiErr> {
        let token = parts
            .headers
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .ok_or(ApiErr::from(AuthError::Unauthorized))?;
        let now = now_ms();
        let device = {
            let db = state.db();
            let device = auth::authenticate(&db, token, now)??;
            db.touch_device(&device.id, now as i64)?;
            device
        };
        limit(state, Bucket::Device, &device.id)?;
        Ok(Device(device))
    }
}

// ---------- rotas ----------

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        ok: true,
        service: "pulse-core".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        protocol_version: PROTOCOL_VERSION,
    })
}

async fn pairing_claim(
    AxState(state): AxState<Arc<State>>,
    headers: HeaderMap,
    Json(req): Json<ClaimRequest>,
) -> Result<Json<PairingStatus>, ApiErr> {
    limit(&state, Bucket::Pairing, &client_key(&headers))?;
    let claimed = state.pairings.lock().unwrap().claim(&req, now_ms());
    match claimed {
        Ok(request) => {
            state.audit_ext(
                "remote:pairing",
                "devices",
                "pairing.claimed",
                AuditResult::Ok,
                AuditExtra {
                    level: Some(PermissionLevel::Confirm),
                    params: Some(serde_json::json!({
                        "name": request.device_name,
                        "model": request.device_model,
                    })),
                    ..Default::default()
                },
            );
            let _ = state.events.send(Event::PairingRequested(request));
            Ok(Json(PairingStatus::Pending))
        }
        Err(e) => {
            if e == PairingError::InvalidProof {
                state.audit_ext(
                    "remote:pairing",
                    "devices",
                    "pairing.claim_rejected",
                    AuditResult::Denied,
                    AuditExtra {
                        level: Some(PermissionLevel::Confirm),
                        error: Some(e.code()),
                        ..Default::default()
                    },
                );
            }
            Err(e.into())
        }
    }
}

async fn pairing_poll(
    AxState(state): AxState<Arc<State>>,
    headers: HeaderMap,
    Json(req): Json<PollRequest>,
) -> Result<Json<PairingStatus>, ApiErr> {
    limit(&state, Bucket::Pairing, &client_key(&headers))?;
    let status = state.pairings.lock().unwrap().poll(&req, now_ms())?;
    Ok(Json(status))
}

async fn auth_refresh(
    AxState(state): AxState<Arc<State>>,
    headers: HeaderMap,
    Json(req): Json<RefreshRequest>,
) -> Result<Json<TokenPair>, ApiErr> {
    limit(&state, Bucket::Refresh, &client_key(&headers))?;
    let outcome = {
        let mut db = state.db();
        auth::refresh(&mut db, &req.refresh_token, now_ms())?
    };
    match outcome {
        Ok(tokens) => Ok(Json(tokens)),
        Err(AuthError::RefreshReused) => {
            // `auth::refresh` já revogou no banco; aqui só os efeitos.
            if let Some(id) = device_of_refresh(&state, &req.refresh_token) {
                tracing::warn!("token de renovação reutilizado; dispositivo {id} revogado");
                state.after_revocation(&id, "system", "refresh_token_reused");
            }
            Err(AuthError::RefreshReused.into())
        }
        Err(e) => Err(e.into()),
    }
}

fn device_of_refresh(state: &State, token: &str) -> Option<String> {
    state
        .db()
        .find_token(&auth::hash_token(token))
        .ok()
        .flatten()
        .map(|t| t.device_id)
}

async fn status(AxState(state): AxState<Arc<State>>, _device: Device) -> Json<RemoteStatus> {
    Json(state.remote_status())
}

async fn devices(
    AxState(state): AxState<Arc<State>>,
    Device(me): Device,
) -> Result<Json<DevicesResponse>, ApiErr> {
    let devices = state.devices().map_err(|_| ApiErr::internal())?;
    Ok(Json(DevicesResponse { me: me.id, devices }))
}

/// O iPhone desfaz o próprio pareamento.
async fn revoke_me(
    AxState(state): AxState<Arc<State>>,
    Device(me): Device,
) -> Result<StatusCode, ApiErr> {
    state
        .revoke_device(&me.id, &format!("device:{}", me.id), "unpaired_from_device")
        .map_err(|_| ApiErr::internal())?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------- stream ----------

async fn stream(
    ws: WebSocketUpgrade,
    AxState(state): AxState<Arc<State>>,
    headers: HeaderMap,
) -> Result<Response, ApiErr> {
    // Conexões ainda não autenticadas contam no mesmo balde da renovação.
    limit(&state, Bucket::Refresh, &client_key(&headers))?;
    Ok(ws.on_upgrade(move |socket| stream_session(socket, state)))
}

async fn send(socket: &mut WebSocket, msg: &StreamServerMsg) -> bool {
    let Ok(text) = serde_json::to_string(msg) else {
        return false;
    };
    socket.send(Message::Text(text.into())).await.is_ok()
}

async fn close(mut socket: WebSocket, code: u16, error: Option<(&str, &str)>) {
    if let Some((code_str, message)) = error {
        let _ = send(
            &mut socket,
            &StreamServerMsg::Error {
                error: ApiError {
                    code: code_str.into(),
                    message: message.into(),
                },
            },
        )
        .await;
    }
    let _ = socket
        .send(Message::Close(Some(CloseFrame {
            code,
            reason: "".into(),
        })))
        .await;
}

async fn stream_session(mut socket: WebSocket, state: Arc<State>) {
    let first = tokio::time::timeout(STREAM_AUTH_TIMEOUT, socket.recv()).await;
    let Ok(Some(Ok(Message::Text(text)))) = first else {
        return close(
            socket,
            CLOSE_BAD_REQUEST,
            Some(("bad_request", "Autenticação ausente.")),
        )
        .await;
    };
    let Ok(StreamClientMsg::Auth {
        access_token,
        since_audit_id,
    }) = serde_json::from_str::<StreamClientMsg>(text.as_str())
    else {
        return close(
            socket,
            CLOSE_BAD_REQUEST,
            Some(("bad_request", "Mensagem inválida.")),
        )
        .await;
    };

    let authed = auth::authenticate(&state.db(), &access_token, now_ms());
    let device = match authed {
        Ok(Ok(d)) => d,
        Ok(Err(e)) => {
            let code = if e == AuthError::DeviceRevoked {
                CLOSE_REVOKED
            } else {
                CLOSE_UNAUTHORIZED
            };
            return close(socket, code, Some((e.code(), e.message()))).await;
        }
        Err(e) => {
            tracing::error!("erro de banco ao autenticar stream: {e}");
            return close(socket, 1011, None).await;
        }
    };

    // Assina antes do snapshot para não perder nada entre um e outro.
    let mut events = state.events.subscribe();
    let mut revocations = state.revocations.subscribe();
    state.stream_opened(&device.id);
    tracing::info!("stream aberto: {} ({})", device.name, device.id);

    let mut ok = send(
        &mut socket,
        &StreamServerMsg::Ready {
            status: state.remote_status(),
        },
    )
    .await;

    if let (true, Some(since)) = (ok, since_audit_id) {
        let missed = state.db().audit_since(since, STREAM_REPLAY_LIMIT);
        for row in missed.unwrap_or_default() {
            if !send(
                &mut socket,
                &StreamServerMsg::Audit {
                    item: audit_item(row),
                },
            )
            .await
            {
                ok = false;
                break;
            }
        }
    }

    let mut ping = tokio::time::interval(STREAM_PING_EVERY);
    ping.tick().await;

    while ok {
        tokio::select! {
            ev = events.recv() => {
                let msg = match ev {
                    Ok(Event::Heartbeat(hb)) => Some(StreamServerMsg::Heartbeat { heartbeat: hb }),
                    Ok(Event::Audit(item)) => Some(StreamServerMsg::Audit { item }),
                    Ok(_) => None,
                    Err(broadcast::error::RecvError::Lagged(_)) => None,
                    Err(broadcast::error::RecvError::Closed) => break,
                };
                if let Some(msg) = msg {
                    ok = send(&mut socket, &msg).await;
                }
            }
            rev = revocations.recv() => {
                if matches!(rev, Ok(ref id) if *id == device.id) {
                    state.stream_closed(&device.id);
                    return close(
                        socket,
                        CLOSE_REVOKED,
                        Some(("device_revoked", AuthError::DeviceRevoked.message())),
                    )
                    .await;
                }
            }
            incoming = socket.recv() => {
                match incoming {
                    Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                    Some(Ok(_)) => {}
                }
            }
            _ = ping.tick() => {
                ok = socket.send(Message::Ping(Default::default())).await.is_ok();
            }
        }
    }

    state.stream_closed(&device.id);
    tracing::info!("stream fechado: {} ({})", device.name, device.id);
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::Request;
    use http_body_util::BodyExt;
    use pulse_db::Db;
    use pulse_protocol::remote::PAIRING_DOMAIN;
    use pulse_protocol::CoreStatus;
    use tower::ServiceExt;

    use crate::auth::{b64, b64_decode, hmac, random_bytes};

    fn test_state() -> Arc<State> {
        let status = CoreStatus {
            version: "0.0.0".into(),
            protocol_version: PROTOCOL_VERSION,
            pid: 1,
            hostname: "pc-teste".into(),
            os_version: "Windows".into(),
            started_at_ms: 0,
            data_dir: "x".into(),
            dev_mode: true,
        };
        Arc::new(State::new(status, 0, Db::open_in_memory().unwrap()))
    }

    async fn call(
        app: &Router,
        method: &str,
        uri: &str,
        bearer: Option<&str>,
        body: Option<serde_json::Value>,
    ) -> (StatusCode, serde_json::Value) {
        let mut req = Request::builder().method(method).uri(uri);
        if let Some(t) = bearer {
            req = req.header("authorization", format!("Bearer {t}"));
        }
        let req = match body {
            Some(b) => req
                .header("content-type", "application/json")
                .body(Body::from(b.to_string()))
                .unwrap(),
            None => req.body(Body::empty()).unwrap(),
        };
        let res = app.clone().oneshot(req).await.unwrap();
        let status = res.status();
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        let json = serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null);
        (status, json)
    }

    #[tokio::test]
    async fn health_responds_on_loopback() {
        let listener = bind(0).await.unwrap();
        let addr = listener.local_addr().unwrap();
        assert!(addr.ip().is_loopback());
        tokio::spawn(serve(listener, test_state()));

        let mut stream = tokio::net::TcpStream::connect(addr).await.unwrap();
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        stream
            .write_all(b"GET /v1/health HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n")
            .await
            .unwrap();
        let mut out = String::new();
        stream.read_to_string(&mut out).await.unwrap();
        assert!(out.starts_with("HTTP/1.1 200"), "{out}");
        assert!(out.contains(r#""service":"pulse-core""#), "{out}");
    }

    /// Fluxo completo como o iPhone faz: claim → aprovação no Desktop → poll →
    /// rotas autenticadas → renovação → revogação.
    #[tokio::test]
    async fn full_pairing_and_auth_flow() {
        let state = test_state();
        let app = router(state.clone());

        let ticket = state.pairings.lock().unwrap().create(now_ms());
        let secret = b64_decode(&ticket.secret_b64).unwrap();
        let nonce = b64(&random_bytes::<32>());
        let id = ticket.pairing_id.clone();
        let proof = |label: &str| {
            b64(&hmac(
                &secret,
                &format!("{PAIRING_DOMAIN}|{label}|{id}|{nonce}"),
            ))
        };

        // Sem autenticação, rotas protegidas recusam.
        let (st, body) = call(&app, "GET", "/v1/status", None, None).await;
        assert_eq!(st, StatusCode::UNAUTHORIZED);
        assert_eq!(body["code"], "unauthorized");

        let (st, body) = call(
            &app,
            "POST",
            "/v1/pairing/claim",
            None,
            Some(serde_json::json!({
                "pairingId": id, "deviceNonce": nonce, "proof": proof("claim"),
                "deviceName": "iPhone de Miguel", "deviceModel": "iPhone15,4",
            })),
        )
        .await;
        assert_eq!(st, StatusCode::OK, "{body}");
        assert_eq!(body["status"], "pending");

        let poll_body =
            serde_json::json!({ "pairingId": id, "deviceNonce": nonce, "proof": proof("poll") });
        let (_, body) = call(
            &app,
            "POST",
            "/v1/pairing/poll",
            None,
            Some(poll_body.clone()),
        )
        .await;
        assert_eq!(body["status"], "pending");

        state.approve_pairing(&id).unwrap();

        let (st, body) = call(
            &app,
            "POST",
            "/v1/pairing/poll",
            None,
            Some(poll_body.clone()),
        )
        .await;
        assert_eq!(st, StatusCode::OK, "{body}");
        assert_eq!(body["status"], "approved");
        let access = body["tokens"]["accessToken"].as_str().unwrap().to_owned();
        let refresh = body["tokens"]["refreshToken"].as_str().unwrap().to_owned();
        let device_id = body["deviceId"].as_str().unwrap().to_owned();

        // Tokens são entregues uma vez só.
        let (st, _) = call(&app, "POST", "/v1/pairing/poll", None, Some(poll_body)).await;
        assert_eq!(st, StatusCode::NOT_FOUND);

        let (st, body) = call(&app, "GET", "/v1/status", Some(&access), None).await;
        assert_eq!(st, StatusCode::OK);
        assert_eq!(body["hostname"], "pc-teste");

        let (_, body) = call(&app, "GET", "/v1/devices", Some(&access), None).await;
        assert_eq!(body["me"], device_id);
        assert_eq!(body["devices"][0]["name"], "iPhone de Miguel");
        assert_eq!(body["devices"][0]["grants"][0], "READ");

        let (st, body) = call(
            &app,
            "POST",
            "/v1/auth/refresh",
            None,
            Some(serde_json::json!({ "refreshToken": refresh })),
        )
        .await;
        assert_eq!(st, StatusCode::OK, "{body}");
        let access2 = body["accessToken"].as_str().unwrap().to_owned();

        let (st, _) = call(&app, "POST", "/v1/devices/me/revoke", Some(&access2), None).await;
        assert_eq!(st, StatusCode::NO_CONTENT);
        let (st, body) = call(&app, "GET", "/v1/status", Some(&access2), None).await;
        assert_eq!(st, StatusCode::UNAUTHORIZED);
        assert_eq!(body["code"], "device_revoked");

        // A auditoria registrou o ciclo de vida.
        let actions: Vec<String> = state
            .db()
            .recent_audit(20)
            .unwrap()
            .into_iter()
            .map(|r| r.action)
            .collect();
        for expected in ["pairing.claimed", "device.paired", "device.revoked"] {
            assert!(
                actions.iter().any(|a| a == expected),
                "{expected} em {actions:?}"
            );
        }
    }

    /// Stream real sobre TCP: exige auth na 1ª mensagem, entrega heartbeat e
    /// replay de auditoria, e fecha com 4403 quando o dispositivo é revogado.
    #[tokio::test]
    async fn stream_auth_events_and_revocation() {
        use futures::{SinkExt, StreamExt};
        use tokio_tungstenite::tungstenite::Message as WsMsg;

        let state = test_state();
        // Dispositivo pareado direto pelo estado.
        let device_id = "dev-ws".to_owned();
        let access = {
            let db = state.db();
            db.insert_device(&DeviceRow {
                id: device_id.clone(),
                name: "iPhone".into(),
                model: "".into(),
                status: pulse_db::DeviceStatus::Active,
                grants: vec!["READ".into()],
                paired_at_ms: 0,
                last_seen_ms: None,
                revoked_at_ms: None,
            })
            .unwrap();
            auth::issue_tokens(&db, &device_id, now_ms())
                .unwrap()
                .access_token
        };
        state.audit("system", "core", "core.started", AuditResult::Ok);

        let listener = bind(0).await.unwrap();
        let url = format!("ws://{}/v1/stream", listener.local_addr().unwrap());
        tokio::spawn(serve(listener, state.clone()));

        async fn next_json(
            ws: &mut tokio_tungstenite::WebSocketStream<
                tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
            >,
        ) -> Option<serde_json::Value> {
            loop {
                match tokio::time::timeout(Duration::from_secs(3), ws.next())
                    .await
                    .ok()??
                {
                    Ok(WsMsg::Text(t)) => return serde_json::from_str(t.as_str()).ok(),
                    Ok(WsMsg::Close(frame)) => {
                        return Some(
                            serde_json::json!({ "close": frame.map(|f| u16::from(f.code)) }),
                        )
                    }
                    Ok(_) => continue,
                    Err(_) => return None,
                }
            }
        }

        // Token inválido: erro e fechamento 4401.
        let (mut bad, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
        bad.send(WsMsg::Text(
            r#"{"type":"auth","accessToken":"pa_x","sinceAuditId":null}"#.into(),
        ))
        .await
        .unwrap();
        assert_eq!(
            next_json(&mut bad).await.unwrap()["error"]["code"],
            "unauthorized"
        );
        assert_eq!(next_json(&mut bad).await.unwrap()["close"], 4401);

        // Token válido, pedindo replay desde o início.
        let (mut ws, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
        let auth = serde_json::json!({ "type": "auth", "accessToken": access, "sinceAuditId": 0 });
        ws.send(WsMsg::Text(auth.to_string().into())).await.unwrap();
        let ready = next_json(&mut ws).await.unwrap();
        assert_eq!(ready["type"], "ready");
        assert_eq!(ready["status"]["hostname"], "pc-teste");
        let replay = next_json(&mut ws).await.unwrap();
        assert_eq!(replay["type"], "audit");
        assert_eq!(replay["item"]["action"], "core.started");

        assert!(
            state.devices().unwrap()[0].online,
            "stream aberto marca online"
        );

        // Evento ao vivo.
        let _ = state
            .events
            .send(Event::Heartbeat(pulse_protocol::Heartbeat {
                ts_ms: 1,
                cpu_percent: 50.0,
                mem_used_bytes: 1,
                mem_total_bytes: 2,
                system_disk: None,
                net_rx_bytes_per_sec: 0,
                net_tx_bytes_per_sec: 0,
                process_count: 1,
                system_uptime_secs: 1,
                core_uptime_secs: 1,
            }));
        let mut saw_heartbeat = false;
        for _ in 0..5 {
            let m = next_json(&mut ws).await.unwrap();
            if m["type"] == "heartbeat" {
                assert_eq!(m["heartbeat"]["cpuPercent"], 50.0);
                saw_heartbeat = true;
                break;
            }
        }
        assert!(saw_heartbeat);

        // Revogação no Desktop derruba o stream.
        state
            .revoke_device(&device_id, "local:desktop", "teste")
            .unwrap();
        let mut close_code = None;
        for _ in 0..10 {
            let Some(m) = next_json(&mut ws).await else {
                break;
            };
            if m["type"] == "error" {
                assert_eq!(m["error"]["code"], "device_revoked");
            }
            if let Some(code) = m.get("close") {
                close_code = code.as_u64();
                break;
            }
        }
        assert_eq!(close_code, Some(4403));
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert!(!state.devices().unwrap()[0].online);
    }

    #[tokio::test]
    async fn claim_with_wrong_secret_is_rejected_and_audited() {
        let state = test_state();
        let app = router(state.clone());
        let ticket = state.pairings.lock().unwrap().create(now_ms());
        let nonce = b64(&random_bytes::<32>());
        let forged = b64(&hmac(&random_bytes::<32>(), "x"));
        let (st, body) = call(
            &app,
            "POST",
            "/v1/pairing/claim",
            None,
            Some(serde_json::json!({
                "pairingId": ticket.pairing_id, "deviceNonce": nonce, "proof": forged,
                "deviceName": "Intruso", "deviceModel": "",
            })),
        )
        .await;
        assert_eq!(st, StatusCode::UNAUTHORIZED);
        assert_eq!(body["code"], "invalid_proof");
        assert_eq!(
            state.db().recent_audit(1).unwrap()[0].action,
            "pairing.claim_rejected"
        );
    }

    #[tokio::test]
    async fn pairing_endpoint_is_rate_limited() {
        let state = test_state();
        let app = router(state);
        let body = serde_json::json!({ "pairingId": "x", "deviceNonce": "y", "proof": "z" });
        let mut last = StatusCode::OK;
        for _ in 0..100 {
            let (st, _) = call(&app, "POST", "/v1/pairing/poll", None, Some(body.clone())).await;
            last = st;
        }
        assert_eq!(last, StatusCode::TOO_MANY_REQUESTS);
    }
}
