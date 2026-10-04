//! Tokens de dispositivo e primitivas criptográficas.
//!
//! - Tokens são 32 bytes aleatórios (base64url) com prefixo `pa_` (acesso) ou
//!   `pr_` (renovação). No banco fica só o SHA-256.
//! - Acesso dura 15 min. Renovação dura 30 dias e **gira** a cada uso.
//! - Reusar um token de renovação já girado é tratado como roubo: o dispositivo
//!   é revogado. Exceção: dentro de `REUSE_GRACE_MS`, que cobre duas renovações
//!   simultâneas legítimas do mesmo app, a resposta é só "superseded".

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use hmac::{Hmac, KeyInit, Mac};
use pulse_db::{Db, DeviceRow, DeviceStatus, TokenKind};
use pulse_protocol::remote::TokenPair;
use sha2::{Digest, Sha256};

pub const ACCESS_TTL_MS: u64 = 15 * 60 * 1000;
pub const REFRESH_TTL_MS: u64 = 30 * 24 * 60 * 60 * 1000;
pub const REUSE_GRACE_MS: i64 = 30_000;

const ACCESS_PREFIX: &str = "pa_";
const REFRESH_PREFIX: &str = "pr_";

type HmacSha256 = Hmac<Sha256>;

pub fn random_bytes<const N: usize>() -> [u8; N] {
    let mut buf = [0u8; N];
    getrandom::fill(&mut buf).expect("gerador aleatório do sistema indisponível");
    buf
}

pub fn b64(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

pub fn b64_decode(s: &str) -> Option<Vec<u8>> {
    URL_SAFE_NO_PAD.decode(s).ok()
}

pub fn hmac(key: &[u8], msg: &str) -> Vec<u8> {
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC aceita chave de qualquer tamanho");
    mac.update(msg.as_bytes());
    mac.finalize().into_bytes().to_vec()
}

/// Comparação em tempo constante do HMAC esperado com o recebido (base64url).
pub fn verify_hmac(key: &[u8], msg: &str, tag_b64: &str) -> bool {
    let Some(tag) = b64_decode(tag_b64) else {
        return false;
    };
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC aceita chave de qualquer tamanho");
    mac.update(msg.as_bytes());
    mac.verify_slice(&tag).is_ok()
}

pub fn hash_token(token: &str) -> String {
    let digest = Sha256::digest(token.as_bytes());
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthError {
    /// Token ausente, malformado ou desconhecido.
    Unauthorized,
    Expired,
    DeviceRevoked,
    /// Renovação concorrente legítima: o cliente deve usar o par mais novo.
    RefreshSuperseded,
    /// Token de renovação antigo reapresentado fora da janela: dispositivo revogado.
    RefreshReused,
}

impl AuthError {
    pub fn code(self) -> &'static str {
        match self {
            Self::Unauthorized => "unauthorized",
            Self::Expired => "token_expired",
            Self::DeviceRevoked => "device_revoked",
            Self::RefreshSuperseded => "refresh_superseded",
            Self::RefreshReused => "device_revoked",
        }
    }

    pub fn message(self) -> &'static str {
        match self {
            Self::Unauthorized => "Credencial inválida.",
            Self::Expired => "Token expirado; renove a sessão.",
            Self::DeviceRevoked => "Este dispositivo não tem mais acesso ao Pulse.",
            Self::RefreshSuperseded => "Sessão já renovada por outra requisição.",
            Self::RefreshReused => {
                "Token reutilizado; o acesso deste dispositivo foi revogado por segurança."
            }
        }
    }
}

pub type DbResult<T> = Result<T, pulse_db::DbError>;

/// Emite um par novo de tokens para o dispositivo.
pub fn issue_tokens(db: &Db, device_id: &str, now_ms: u64) -> DbResult<TokenPair> {
    let access = format!("{ACCESS_PREFIX}{}", b64(&random_bytes::<32>()));
    let refresh = format!("{REFRESH_PREFIX}{}", b64(&random_bytes::<32>()));
    let access_exp = now_ms + ACCESS_TTL_MS;
    let refresh_exp = now_ms + REFRESH_TTL_MS;
    db.insert_token(
        device_id,
        TokenKind::Access,
        &hash_token(&access),
        now_ms as i64,
        access_exp as i64,
    )?;
    db.insert_token(
        device_id,
        TokenKind::Refresh,
        &hash_token(&refresh),
        now_ms as i64,
        refresh_exp as i64,
    )?;
    Ok(TokenPair {
        access_token: access,
        access_expires_at_ms: access_exp,
        refresh_token: refresh,
        refresh_expires_at_ms: refresh_exp,
    })
}

/// Valida um token de acesso e devolve o dispositivo dono dele.
pub fn authenticate(db: &Db, token: &str, now_ms: u64) -> DbResult<Result<DeviceRow, AuthError>> {
    if !token.starts_with(ACCESS_PREFIX) {
        return Ok(Err(AuthError::Unauthorized));
    }
    let Some(row) = db.find_token(&hash_token(token))? else {
        return Ok(Err(AuthError::Unauthorized));
    };
    if row.kind != TokenKind::Access {
        return Ok(Err(AuthError::Unauthorized));
    }
    let Some(device) = db.get_device(&row.device_id)? else {
        return Ok(Err(AuthError::Unauthorized));
    };
    if device.status != DeviceStatus::Active || row.revoked_at_ms.is_some() {
        return Ok(Err(AuthError::DeviceRevoked));
    }
    if row.expires_at_ms <= now_ms as i64 {
        return Ok(Err(AuthError::Expired));
    }
    Ok(Ok(device))
}

/// Troca um token de renovação por um par novo (rotação).
///
/// Em `Err(RefreshReused)` o dispositivo **já foi revogado** aqui dentro.
pub fn refresh(db: &mut Db, token: &str, now_ms: u64) -> DbResult<Result<TokenPair, AuthError>> {
    if !token.starts_with(REFRESH_PREFIX) {
        return Ok(Err(AuthError::Unauthorized));
    }
    let Some(row) = db.find_token(&hash_token(token))? else {
        return Ok(Err(AuthError::Unauthorized));
    };
    if row.kind != TokenKind::Refresh {
        return Ok(Err(AuthError::Unauthorized));
    }
    let Some(device) = db.get_device(&row.device_id)? else {
        return Ok(Err(AuthError::Unauthorized));
    };
    if device.status != DeviceStatus::Active || row.revoked_at_ms.is_some() {
        return Ok(Err(AuthError::DeviceRevoked));
    }
    if let Some(rotated) = row.rotated_at_ms {
        if now_ms as i64 - rotated <= REUSE_GRACE_MS {
            return Ok(Err(AuthError::RefreshSuperseded));
        }
        db.revoke_device(&device.id, "refresh_token_reused", now_ms as i64)?;
        return Ok(Err(AuthError::RefreshReused));
    }
    if row.expires_at_ms <= now_ms as i64 {
        return Ok(Err(AuthError::Expired));
    }
    db.mark_token_rotated(row.id, now_ms as i64)?;
    Ok(Ok(issue_tokens(db, &device.id, now_ms)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db_with_device() -> Db {
        let db = Db::open_in_memory().unwrap();
        db.insert_device(&DeviceRow {
            id: "dev1".into(),
            name: "iPhone".into(),
            model: "".into(),
            status: DeviceStatus::Active,
            grants: vec!["READ".into()],
            paired_at_ms: 0,
            last_seen_ms: None,
            revoked_at_ms: None,
        })
        .unwrap();
        db
    }

    #[test]
    fn hmac_roundtrip_and_tamper() {
        let key = random_bytes::<32>();
        let tag = b64(&hmac(&key, "msg"));
        assert!(verify_hmac(&key, "msg", &tag));
        assert!(!verify_hmac(&key, "msg2", &tag));
        assert!(!verify_hmac(&random_bytes::<32>(), "msg", &tag));
        assert!(!verify_hmac(&key, "msg", "not-base64!!"));
    }

    #[test]
    fn hmac_matches_known_vector() {
        // RFC 4231, caso de teste 2.
        let tag = hmac(b"Jefe", "what do ya want for nothing?");
        let hex: String = tag.iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(
            hex,
            "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"
        );
    }

    #[test]
    fn access_token_lifecycle() {
        let db = db_with_device();
        let pair = issue_tokens(&db, "dev1", 1_000).unwrap();
        assert!(pair.access_token.starts_with("pa_"));
        assert_eq!(
            authenticate(&db, &pair.access_token, 2_000)
                .unwrap()
                .unwrap()
                .id,
            "dev1"
        );
        assert_eq!(
            authenticate(&db, &pair.access_token, 1_000 + ACCESS_TTL_MS).unwrap(),
            Err(AuthError::Expired)
        );
        // Token de renovação não serve como acesso.
        assert_eq!(
            authenticate(&db, &pair.refresh_token, 2_000).unwrap(),
            Err(AuthError::Unauthorized)
        );
        assert_eq!(
            authenticate(&db, "pa_desconhecido", 2_000).unwrap(),
            Err(AuthError::Unauthorized)
        );
    }

    #[test]
    fn refresh_rotates_and_detects_reuse() {
        let mut db = db_with_device();
        let first = issue_tokens(&db, "dev1", 0).unwrap();

        let second = refresh(&mut db, &first.refresh_token, 1_000)
            .unwrap()
            .unwrap();
        assert_ne!(second.refresh_token, first.refresh_token);

        // Corrida legítima dentro da janela: não revoga.
        assert_eq!(
            refresh(&mut db, &first.refresh_token, 1_000 + 5_000).err_kind(),
            Some(AuthError::RefreshSuperseded)
        );
        // O par novo continua válido.
        assert!(authenticate(&db, &second.access_token, 2_000)
            .unwrap()
            .is_ok());

        // Reuso tardio: revoga o dispositivo inteiro.
        assert_eq!(
            refresh(
                &mut db,
                &first.refresh_token,
                1_000 + REUSE_GRACE_MS as u64 + 1
            )
            .err_kind(),
            Some(AuthError::RefreshReused)
        );
        assert_eq!(
            authenticate(&db, &second.access_token, 2_000).unwrap(),
            Err(AuthError::DeviceRevoked)
        );
        assert_eq!(
            refresh(&mut db, &second.refresh_token, 3_000).err_kind(),
            Some(AuthError::DeviceRevoked)
        );
    }

    trait ErrKind {
        fn err_kind(self) -> Option<AuthError>;
    }
    impl ErrKind for DbResult<Result<TokenPair, AuthError>> {
        fn err_kind(self) -> Option<AuthError> {
            self.unwrap().err()
        }
    }
}
