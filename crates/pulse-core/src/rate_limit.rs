//! Limite de requisições por janela fixa de 1 minuto, em memória.

use std::collections::HashMap;
use std::sync::Mutex;

const WINDOW_MS: u64 = 60_000;
/// Acima disso, entradas antigas são descartadas para não crescer sem limite.
const MAX_KEYS: usize = 10_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Bucket {
    /// Pareamento (claim/poll): sem autenticação, então o mais restrito.
    Pairing,
    /// Renovação de tokens.
    Refresh,
    /// Rotas autenticadas, por dispositivo.
    Device,
}

impl Bucket {
    fn limit(self) -> u32 {
        match self {
            // O poll roda a cada ~1,5 s durante até 2 min de espera.
            Self::Pairing => 90,
            Self::Refresh => 20,
            Self::Device => 300,
        }
    }
}

#[derive(Default)]
pub struct RateLimiter {
    windows: Mutex<HashMap<(Bucket, String), (u64, u32)>>,
}

impl RateLimiter {
    /// `true` se a requisição pode seguir.
    pub fn check(&self, bucket: Bucket, key: &str, now_ms: u64) -> bool {
        let mut w = self.windows.lock().unwrap_or_else(|p| p.into_inner());
        if w.len() > MAX_KEYS {
            w.retain(|_, (start, _)| now_ms.saturating_sub(*start) < WINDOW_MS);
        }
        let entry = w.entry((bucket, key.to_owned())).or_insert((now_ms, 0));
        if now_ms.saturating_sub(entry.0) >= WINDOW_MS {
            *entry = (now_ms, 0);
        }
        entry.1 += 1;
        entry.1 <= bucket.limit()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limits_per_key_and_resets() {
        let rl = RateLimiter::default();
        for _ in 0..Bucket::Refresh.limit() {
            assert!(rl.check(Bucket::Refresh, "a", 0));
        }
        assert!(!rl.check(Bucket::Refresh, "a", 1));
        assert!(
            rl.check(Bucket::Refresh, "b", 1),
            "outra chave tem cota própria"
        );
        assert!(
            rl.check(Bucket::Pairing, "a", 1),
            "outro bucket tem cota própria"
        );
        assert!(rl.check(Bucket::Refresh, "a", WINDOW_MS), "janela nova");
    }
}
