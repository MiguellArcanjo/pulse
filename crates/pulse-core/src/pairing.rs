//! Sessões de pareamento (só em memória: nada disso precisa sobreviver a um restart).
//!
//! Ciclo: `create` (Desktop) → `claim` (iPhone) → `approve`/`deny` (Desktop)
//! → `poll` (iPhone recebe os tokens uma única vez).

use std::collections::HashMap;

use pulse_protocol::remote::{
    pairing_code, ClaimRequest, PairingStatus, PollRequest, TokenPair, PAIRING_DOMAIN,
};
use pulse_protocol::PairingRequest;

use crate::auth::{b64, b64_decode, hmac, random_bytes, verify_hmac};

/// Tempo para escanear o QR.
pub const QR_TTL_MS: u64 = 120_000;
/// Tempo para aprovar no Desktop depois que o iPhone leu o QR.
pub const APPROVAL_TTL_MS: u64 = 120_000;
/// Tempo para o iPhone buscar os tokens depois da aprovação.
pub const DELIVERY_TTL_MS: u64 = 60_000;
/// Provas inválidas aceitas antes de invalidar a sessão.
pub const MAX_BAD_PROOFS: u32 = 5;
/// Códigos errados digitados no Desktop antes de recusar o pedido.
pub const MAX_CODE_ATTEMPTS: u32 = 3;

const MAX_NAME_LEN: usize = 64;

#[derive(Debug, Clone, PartialEq)]
enum Stage {
    Open,
    Claimed {
        nonce: String,
        request: PairingRequest,
        /// Código que o iPhone mostra; o usuário digita no Desktop.
        code: String,
        wrong_codes: u32,
    },
    Approved {
        nonce: String,
        device_id: String,
        tokens: TokenPair,
    },
    Denied {
        nonce: String,
    },
}

struct Session {
    secret: [u8; 32],
    expires_at_ms: u64,
    bad_proofs: u32,
    stage: Stage,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PairingError {
    NotFound,
    Expired,
    AlreadyClaimed,
    InvalidProof,
    BadRequest,
    /// Ação do Desktop num estado em que ela não cabe (ex.: aprovar antes do claim).
    WrongState,
    WrongCode,
    /// Errou o código vezes demais: o pedido foi recusado.
    TooManyCodeAttempts,
}

impl PairingError {
    pub fn code(self) -> &'static str {
        match self {
            Self::NotFound => "pairing_not_found",
            Self::Expired => "pairing_expired",
            Self::AlreadyClaimed => "pairing_already_claimed",
            Self::InvalidProof => "invalid_proof",
            Self::BadRequest => "bad_request",
            Self::WrongState => "pairing_wrong_state",
            Self::WrongCode => "wrong_code",
            Self::TooManyCodeAttempts => "too_many_code_attempts",
        }
    }

    pub fn message(self) -> &'static str {
        match self {
            Self::NotFound => "Pareamento não encontrado. Gere um QR novo no Desktop.",
            Self::Expired => "O QR expirou. Gere um novo no Desktop.",
            Self::AlreadyClaimed => "Este QR já foi usado por outro dispositivo.",
            Self::InvalidProof => "Prova de pareamento inválida.",
            Self::BadRequest => "Requisição de pareamento malformada.",
            Self::WrongState => "O pareamento não está aguardando esta ação.",
            Self::WrongCode => "Código incorreto. Confira o número mostrado no iPhone.",
            Self::TooManyCodeAttempts => {
                "Código incorreto várias vezes; o pedido foi recusado. Gere um novo QR."
            }
        }
    }
}

pub struct NewPairing {
    pub pairing_id: String,
    pub secret_b64: String,
    pub expires_at_ms: u64,
}

pub fn claim_message(pairing_id: &str, nonce: &str) -> String {
    format!("{PAIRING_DOMAIN}|claim|{pairing_id}|{nonce}")
}

pub fn poll_message(pairing_id: &str, nonce: &str) -> String {
    format!("{PAIRING_DOMAIN}|poll|{pairing_id}|{nonce}")
}

pub fn sas_message(pairing_id: &str, nonce: &str) -> String {
    format!("{PAIRING_DOMAIN}|sas|{pairing_id}|{nonce}")
}

#[derive(Default)]
pub struct Pairings {
    sessions: HashMap<String, Session>,
}

impl Pairings {
    pub fn create(&mut self, now_ms: u64) -> NewPairing {
        let pairing_id = b64(&random_bytes::<12>());
        let secret = random_bytes::<32>();
        let expires_at_ms = now_ms + QR_TTL_MS;
        self.sessions.insert(
            pairing_id.clone(),
            Session {
                secret,
                expires_at_ms,
                bad_proofs: 0,
                stage: Stage::Open,
            },
        );
        NewPairing {
            pairing_id,
            secret_b64: b64(&secret),
            expires_at_ms,
        }
    }

    fn live(&mut self, id: &str, now_ms: u64) -> Result<&mut Session, PairingError> {
        let expired = match self.sessions.get(id) {
            None => return Err(PairingError::NotFound),
            Some(s) => s.expires_at_ms <= now_ms,
        };
        if expired {
            self.sessions.remove(id);
            return Err(PairingError::Expired);
        }
        Ok(self.sessions.get_mut(id).expect("verificado acima"))
    }

    /// Conta uma prova inválida; na quinta, a sessão é destruída.
    fn bad_proof(&mut self, id: &str) -> PairingError {
        if let Some(s) = self.sessions.get_mut(id) {
            s.bad_proofs += 1;
            if s.bad_proofs >= MAX_BAD_PROOFS {
                self.sessions.remove(id);
            }
        }
        PairingError::InvalidProof
    }

    pub fn claim(
        &mut self,
        req: &ClaimRequest,
        now_ms: u64,
    ) -> Result<PairingRequest, PairingError> {
        if b64_decode(&req.device_nonce).is_none_or(|n| n.len() != 32) {
            return Err(PairingError::BadRequest);
        }
        let device_name = sanitize(&req.device_name);
        if device_name.is_empty() {
            return Err(PairingError::BadRequest);
        }
        let session = self.live(&req.pairing_id, now_ms)?;
        if !verify_hmac(
            &session.secret,
            &claim_message(&req.pairing_id, &req.device_nonce),
            &req.proof,
        ) {
            return Err(self.bad_proof(&req.pairing_id));
        }
        if session.stage != Stage::Open {
            return Err(PairingError::AlreadyClaimed);
        }
        let mac = hmac(
            &session.secret,
            &sas_message(&req.pairing_id, &req.device_nonce),
        );
        let request = PairingRequest {
            pairing_id: req.pairing_id.clone(),
            device_name,
            device_model: sanitize(&req.device_model),
        };
        session.stage = Stage::Claimed {
            nonce: req.device_nonce.clone(),
            request: request.clone(),
            code: pairing_code(&mac),
            wrong_codes: 0,
        };
        session.expires_at_ms = now_ms + APPROVAL_TTL_MS;
        Ok(request)
    }

    /// O iPhone consulta o andamento. Os tokens são entregues uma única vez.
    pub fn poll(&mut self, req: &PollRequest, now_ms: u64) -> Result<PairingStatus, PairingError> {
        let session = match self.live(&req.pairing_id, now_ms) {
            Ok(s) => s,
            Err(PairingError::Expired) => return Ok(PairingStatus::Expired),
            Err(e) => return Err(e),
        };
        if !verify_hmac(
            &session.secret,
            &poll_message(&req.pairing_id, &req.device_nonce),
            &req.proof,
        ) {
            return Err(self.bad_proof(&req.pairing_id));
        }
        let owner = match &session.stage {
            Stage::Open => return Err(PairingError::WrongState),
            Stage::Claimed { nonce, .. }
            | Stage::Approved { nonce, .. }
            | Stage::Denied { nonce } => nonce,
        };
        // Só quem fez o claim (dono do nonce) acompanha este pareamento.
        if *owner != req.device_nonce {
            return Err(self.bad_proof(&req.pairing_id));
        }
        match &session.stage {
            Stage::Claimed { .. } => Ok(PairingStatus::Pending),
            Stage::Denied { .. } => {
                self.sessions.remove(&req.pairing_id);
                Ok(PairingStatus::Denied)
            }
            Stage::Approved { .. } => {
                let Some(Session {
                    stage:
                        Stage::Approved {
                            device_id, tokens, ..
                        },
                    ..
                }) = self.sessions.remove(&req.pairing_id)
                else {
                    unreachable!("estágio verificado acima")
                };
                Ok(PairingStatus::Approved { device_id, tokens })
            }
            Stage::Open => unreachable!("tratado acima"),
        }
    }

    /// Confere o código digitado no Desktop e devolve o pedido pendente, para
    /// criar o dispositivo antes de aprovar. Após `MAX_CODE_ATTEMPTS` erros o
    /// pedido é recusado (o iPhone recebe `denied` no próximo poll).
    pub fn verify_code(
        &mut self,
        id: &str,
        typed: &str,
        now_ms: u64,
    ) -> Result<PairingRequest, PairingError> {
        let session = self.live(id, now_ms)?;
        let Stage::Claimed {
            nonce,
            request,
            code,
            wrong_codes,
        } = &mut session.stage
        else {
            return Err(PairingError::WrongState);
        };
        let typed: String = typed.chars().filter(|c| c.is_ascii_digit()).collect();
        if constant_time_eq(typed.as_bytes(), code.as_bytes()) {
            return Ok(request.clone());
        }
        *wrong_codes += 1;
        if *wrong_codes >= MAX_CODE_ATTEMPTS {
            let nonce = nonce.clone();
            session.stage = Stage::Denied { nonce };
            session.expires_at_ms = now_ms + DELIVERY_TTL_MS;
            return Err(PairingError::TooManyCodeAttempts);
        }
        Err(PairingError::WrongCode)
    }

    pub fn approve(
        &mut self,
        id: &str,
        device_id: String,
        tokens: TokenPair,
        now_ms: u64,
    ) -> Result<(), PairingError> {
        let session = self.live(id, now_ms)?;
        let Stage::Claimed { nonce, .. } = &session.stage else {
            return Err(PairingError::WrongState);
        };
        session.stage = Stage::Approved {
            nonce: nonce.clone(),
            device_id,
            tokens,
        };
        session.expires_at_ms = now_ms + DELIVERY_TTL_MS;
        Ok(())
    }

    pub fn deny(&mut self, id: &str, now_ms: u64) -> Result<(), PairingError> {
        let session = self.live(id, now_ms)?;
        match &session.stage {
            Stage::Claimed { nonce, .. } => {
                session.stage = Stage::Denied {
                    nonce: nonce.clone(),
                };
                session.expires_at_ms = now_ms + DELIVERY_TTL_MS;
            }
            // Cancelar um QR que ninguém leu.
            Stage::Open => {
                self.sessions.remove(id);
            }
            _ => return Err(PairingError::WrongState),
        }
        Ok(())
    }

    /// Remove sessões vencidas. Devolve as que expiraram com alguém aguardando
    /// aprovação, para avisar o Desktop.
    pub fn sweep(&mut self, now_ms: u64) -> Vec<String> {
        let mut expired_claims = Vec::new();
        self.sessions.retain(|id, s| {
            let keep = s.expires_at_ms > now_ms;
            if !keep && matches!(s.stage, Stage::Claimed { .. } | Stage::Open) {
                expired_claims.push(id.clone());
            }
            keep
        });
        expired_claims
    }
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Nome vindo do iPhone: sem caracteres de controle e com tamanho limitado.
fn sanitize(s: &str) -> String {
    s.chars()
        .filter(|c| !c.is_control())
        .take(MAX_NAME_LEN)
        .collect::<String>()
        .trim()
        .to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Phone {
        pairing_id: String,
        secret: Vec<u8>,
        nonce: String,
    }

    impl Phone {
        fn scan(p: &NewPairing) -> Self {
            Self {
                pairing_id: p.pairing_id.clone(),
                secret: b64_decode(&p.secret_b64).unwrap(),
                nonce: b64(&random_bytes::<32>()),
            }
        }
        fn claim(&self) -> ClaimRequest {
            ClaimRequest {
                pairing_id: self.pairing_id.clone(),
                device_nonce: self.nonce.clone(),
                proof: b64(&hmac(
                    &self.secret,
                    &claim_message(&self.pairing_id, &self.nonce),
                )),
                device_name: "iPhone de Miguel".into(),
                device_model: "iPhone15,4".into(),
            }
        }
        fn poll(&self) -> PollRequest {
            PollRequest {
                pairing_id: self.pairing_id.clone(),
                device_nonce: self.nonce.clone(),
                proof: b64(&hmac(
                    &self.secret,
                    &poll_message(&self.pairing_id, &self.nonce),
                )),
            }
        }
        fn code(&self) -> String {
            pairing_code(&hmac(
                &self.secret,
                &sas_message(&self.pairing_id, &self.nonce),
            ))
        }
    }

    fn tokens() -> TokenPair {
        TokenPair {
            access_token: "pa_x".into(),
            access_expires_at_ms: 1,
            refresh_token: "pr_x".into(),
            refresh_expires_at_ms: 2,
        }
    }

    /// Vetor fixo compartilhado com packages/client (pairing.test.ts) e calculado
    /// de forma independente em Python: garante que iPhone e Core falam o mesmo HMAC.
    #[test]
    fn cross_language_vector() {
        let key: Vec<u8> = (1..=32).collect();
        assert_eq!(b64(&key), "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA");
        let (id, nonce) = ("pair123", "nonce456");
        assert_eq!(
            b64(&hmac(&key, &claim_message(id, nonce))),
            "7IUHhCThhuxcDlTCw5ElNs3CSyuiAQTzK15SyQYRGV0"
        );
        assert_eq!(
            b64(&hmac(&key, &poll_message(id, nonce))),
            "vqBpdmAP8XmtT6RA7gj9XzUtech47QjpSO630GE-aDw"
        );
        assert_eq!(pairing_code(&hmac(&key, &sas_message(id, nonce))), "655521");
    }

    #[test]
    fn happy_path_delivers_tokens_once() {
        let mut p = Pairings::default();
        let ticket = p.create(0);
        let phone = Phone::scan(&ticket);

        let req = p.claim(&phone.claim(), 10).unwrap();
        assert_eq!(req.device_name, "iPhone de Miguel");
        assert_eq!(
            p.verify_code(&ticket.pairing_id, "000000", 11),
            Err(PairingError::WrongCode)
        );
        // Aceita o código digitado com espaço, como o iPhone mostra ("123 456").
        let typed = format!("{} {}", &phone.code()[..3], &phone.code()[3..]);
        assert_eq!(p.verify_code(&ticket.pairing_id, &typed, 12).unwrap(), req);

        assert_eq!(p.poll(&phone.poll(), 20).unwrap(), PairingStatus::Pending);
        p.approve(&ticket.pairing_id, "dev1".into(), tokens(), 30)
            .unwrap();
        assert!(matches!(
            p.poll(&phone.poll(), 40).unwrap(),
            PairingStatus::Approved { .. }
        ));
        assert_eq!(p.poll(&phone.poll(), 50), Err(PairingError::NotFound));
    }

    #[test]
    fn second_claimer_is_rejected_and_cannot_poll() {
        let mut p = Pairings::default();
        let ticket = p.create(0);
        let phone = Phone::scan(&ticket);
        let attacker = Phone::scan(&ticket); // fotografou o mesmo QR
        p.claim(&phone.claim(), 1).unwrap();
        assert_eq!(
            p.claim(&attacker.claim(), 2),
            Err(PairingError::AlreadyClaimed)
        );
        p.approve(&ticket.pairing_id, "dev1".into(), tokens(), 3)
            .unwrap();
        assert_eq!(p.poll(&attacker.poll(), 4), Err(PairingError::InvalidProof));
        assert!(matches!(
            p.poll(&phone.poll(), 5).unwrap(),
            PairingStatus::Approved { .. }
        ));
    }

    #[test]
    fn wrong_secret_is_rejected_and_session_dies_after_limit() {
        let mut p = Pairings::default();
        let ticket = p.create(0);
        let mut forger = Phone::scan(&ticket);
        forger.secret = random_bytes::<32>().to_vec();
        for _ in 0..MAX_BAD_PROOFS {
            assert_eq!(p.claim(&forger.claim(), 1), Err(PairingError::InvalidProof));
        }
        let honest = Phone::scan(&ticket);
        assert_eq!(p.claim(&honest.claim(), 2), Err(PairingError::NotFound));
    }

    #[test]
    fn expiry_and_deny() {
        let mut p = Pairings::default();
        let ticket = p.create(0);
        let phone = Phone::scan(&ticket);
        assert_eq!(
            p.claim(&phone.claim(), QR_TTL_MS),
            Err(PairingError::Expired)
        );

        let ticket = p.create(0);
        let phone = Phone::scan(&ticket);
        p.claim(&phone.claim(), 1).unwrap();
        p.deny(&ticket.pairing_id, 2).unwrap();
        assert_eq!(p.poll(&phone.poll(), 3).unwrap(), PairingStatus::Denied);
    }

    #[test]
    fn approve_requires_claim_and_sweep_reports_waiting() {
        let mut p = Pairings::default();
        let ticket = p.create(0);
        assert_eq!(
            p.approve(&ticket.pairing_id, "d".into(), tokens(), 1),
            Err(PairingError::WrongState)
        );
        let phone = Phone::scan(&ticket);
        p.claim(&phone.claim(), 1).unwrap();
        assert_eq!(
            p.sweep(1 + APPROVAL_TTL_MS),
            vec![ticket.pairing_id.clone()]
        );
        assert_eq!(
            p.poll(&phone.poll(), 2 + APPROVAL_TTL_MS)
                .unwrap_or(PairingStatus::Expired),
            PairingStatus::Expired
        );
    }

    #[test]
    fn too_many_wrong_codes_denies() {
        let mut p = Pairings::default();
        let ticket = p.create(0);
        let phone = Phone::scan(&ticket);
        p.claim(&phone.claim(), 1).unwrap();
        for _ in 1..MAX_CODE_ATTEMPTS {
            assert_eq!(
                p.verify_code(&ticket.pairing_id, "999999", 2),
                Err(PairingError::WrongCode)
            );
        }
        assert_eq!(
            p.verify_code(&ticket.pairing_id, "999999", 3),
            Err(PairingError::TooManyCodeAttempts)
        );
        // Depois disso nem o código certo vale.
        assert_eq!(
            p.verify_code(&ticket.pairing_id, &phone.code(), 4),
            Err(PairingError::WrongState)
        );
        assert_eq!(p.poll(&phone.poll(), 5).unwrap(), PairingStatus::Denied);
    }

    #[test]
    fn device_name_is_sanitized() {
        let mut p = Pairings::default();
        let ticket = p.create(0);
        let phone = Phone::scan(&ticket);
        let mut claim = phone.claim();
        claim.device_name = format!("  Ev\u{0007}il{}  ", "x".repeat(200));
        let req = p.claim(&claim, 1).unwrap();
        assert!(req.device_name.starts_with("Evil"));
        assert!(req.device_name.chars().count() <= MAX_NAME_LEN);
    }
}
