//! Canal local do Pulse.
//!
//! Core e clientes locais (Desktop; depois browser host e hook do Claude Code)
//! conversam por um named pipe do Windows. O pipe:
//! - só aceita o SID do usuário que iniciou o Core (DACL explícita);
//! - recusa clientes remotos (SMB);
//! - é criado com `first_pipe_instance`, então um segundo Core — ou um processo
//!   tentando se passar pelo Core — não consegue criá-lo enquanto o primeiro existe.
//!
//! Frames: tamanho (u32 big-endian) + JSON. Ver `pulse_protocol::ipc`.

#![cfg(windows)]

mod security;

use std::io;
use std::time::Duration;

use futures::{SinkExt, StreamExt};
use serde::{de::DeserializeOwned, Serialize};
use tokio::net::windows::named_pipe::{
    ClientOptions, NamedPipeClient, NamedPipeServer, ServerOptions,
};
use tokio_util::codec::{Framed, LengthDelimitedCodec};

pub use security::current_user_sid;

/// Tamanho máximo de um frame. Mensagens maiores indicam bug ou abuso.
pub const MAX_FRAME_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum IpcError {
    #[error(transparent)]
    Io(#[from] io::Error),
    #[error("JSON inválido: {0}")]
    Json(#[from] serde_json::Error),
    #[error("conexão encerrada")]
    Closed,
    #[error("o Core já está rodando (pipe {0} existe)")]
    AlreadyRunning(String),
}

pub type Result<T> = std::result::Result<T, IpcError>;

/// Modo de execução compartilhado por Core e clientes: `PULSE_ENV=dev|prod`,
/// senão dev em builds de debug. Dev e produção têm pipe e banco separados.
pub fn is_dev() -> bool {
    match std::env::var("PULSE_ENV").as_deref() {
        Ok("prod") => false,
        Ok("dev") => true,
        _ => cfg!(debug_assertions),
    }
}

/// Nome do pipe para o usuário atual. Dev e produção usam pipes diferentes.
pub fn pipe_name(dev: bool) -> Result<String> {
    let sid = current_user_sid()?;
    let flavor = if dev { "dev" } else { "prod" };
    Ok(format!(r"\\.\pipe\pulse-core-{flavor}-{sid}"))
}

/// Conexão enquadrada (framed) sobre um lado do pipe.
pub struct Channel<T> {
    framed: Framed<T, LengthDelimitedCodec>,
}

fn codec() -> LengthDelimitedCodec {
    LengthDelimitedCodec::builder()
        .max_frame_length(MAX_FRAME_BYTES)
        .new_codec()
}

impl<T> Channel<T>
where
    T: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    pub fn new(io: T) -> Self {
        Self {
            framed: Framed::new(io, codec()),
        }
    }

    pub async fn send<M: Serialize>(&mut self, msg: &M) -> Result<()> {
        let bytes = serde_json::to_vec(msg)?;
        self.framed.send(bytes.into()).await?;
        Ok(())
    }

    /// Recebe a próxima mensagem. `Err(Closed)` quando o outro lado fecha.
    pub async fn recv<M: DeserializeOwned>(&mut self) -> Result<M> {
        match self.framed.next().await {
            Some(frame) => Ok(serde_json::from_slice(&frame?)?),
            None => Err(IpcError::Closed),
        }
    }
}

/// Lado servidor: aceita conexões em loop.
pub struct Listener {
    name: String,
    next: NamedPipeServer,
}

impl Listener {
    /// Cria a primeira instância do pipe. Falha com `AlreadyRunning` se outro
    /// processo já for dono do nome.
    pub fn bind(name: &str) -> Result<Self> {
        let next = create_instance(name, true).map_err(|e| {
            if e.kind() == io::ErrorKind::PermissionDenied {
                IpcError::AlreadyRunning(name.to_owned())
            } else {
                IpcError::Io(e)
            }
        })?;
        Ok(Self {
            name: name.to_owned(),
            next,
        })
    }

    /// Espera o próximo cliente. Já deixa outra instância pronta antes de retornar,
    /// para nunca haver janela sem servidor escutando.
    pub async fn accept(&mut self) -> Result<Channel<NamedPipeServer>> {
        self.next.connect().await?;
        let fresh = create_instance(&self.name, false)?;
        let connected = std::mem::replace(&mut self.next, fresh);
        Ok(Channel::new(connected))
    }
}

fn create_instance(name: &str, first: bool) -> io::Result<NamedPipeServer> {
    let mut sa = security::OwnerOnly::new()?;
    let mut opts = ServerOptions::new();
    opts.first_pipe_instance(first).reject_remote_clients(true);
    // SAFETY: `sa` aponta para SECURITY_ATTRIBUTES válidos durante a chamada.
    unsafe { opts.create_with_security_attributes_raw(name, sa.as_mut_ptr()) }
}

/// Lado cliente: conecta ao pipe do Core, esperando se todas as instâncias
/// estiverem ocupadas.
pub async fn connect(name: &str) -> Result<Channel<NamedPipeClient>> {
    const ERROR_PIPE_BUSY: i32 = 231;
    let started = std::time::Instant::now();
    loop {
        match ClientOptions::new().open(name) {
            Ok(client) => return Ok(Channel::new(client)),
            Err(e)
                if e.raw_os_error() == Some(ERROR_PIPE_BUSY)
                    && started.elapsed() < Duration::from_secs(2) =>
            {
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            Err(e) => return Err(e.into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::{Deserialize, Serialize};

    #[derive(Debug, PartialEq, Serialize, Deserialize)]
    struct Ping {
        n: u32,
    }

    /// Nome único por teste. O relógio do Windows não tem resolução suficiente
    /// para distinguir testes rodando em paralelo, então usamos um contador.
    fn test_pipe() -> String {
        use std::sync::atomic::{AtomicU32, Ordering};
        static NEXT: AtomicU32 = AtomicU32::new(0);
        format!(
            r"\\.\pipe\pulse-ipc-test-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        )
    }

    #[test]
    fn sid_looks_valid() {
        let sid = current_user_sid().unwrap();
        assert!(sid.starts_with("S-1-"), "{sid}");
    }

    #[tokio::test]
    async fn roundtrip_and_multiple_clients() {
        let name = test_pipe();
        let mut listener = Listener::bind(&name).unwrap();
        let server = tokio::spawn(async move {
            for _ in 0..2 {
                let mut ch = listener.accept().await.unwrap();
                tokio::spawn(async move {
                    let p: Ping = ch.recv().await.unwrap();
                    ch.send(&Ping { n: p.n + 1 }).await.unwrap();
                });
            }
        });
        for n in [1, 10] {
            let mut c = connect(&name).await.unwrap();
            c.send(&Ping { n }).await.unwrap();
            let r: Ping = c.recv().await.unwrap();
            assert_eq!(r, Ping { n: n + 1 });
        }
        server.await.unwrap();
    }

    #[tokio::test]
    async fn second_bind_is_rejected() {
        let name = test_pipe();
        let _first = Listener::bind(&name).unwrap();
        match Listener::bind(&name) {
            Err(IpcError::AlreadyRunning(_)) => {}
            Err(e) => panic!("erro inesperado: {e}"),
            Ok(_) => panic!("segundo bind deveria falhar"),
        }
    }
}
