//! Everything read from the environment, in one place and once. `serve()`
//! and the admin CLI both start from `Config::from_env()`, so the two can
//! never disagree about which database file or which owner token they mean,
//! and a malformed value is refused at boot rather than discovered by the
//! first request that needs it.

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};

use crate::google::GoogleConfig;

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum Signups {
    Open,
    InviteOnly,
}

pub(crate) struct Config {
    /// `ALBAS_SYNC_DB`, default `/data/albas-sync.db`.
    pub(crate) db_path: String,
    /// `ALBAS_SYNC_ADDR`, default `0.0.0.0:8787`.
    pub(crate) addr: String,
    /// `ALBAS_SYNC_PORT`, else the port part of `addr`, else 8787: what
    /// `albas-sync health` probes on localhost.
    pub(crate) health_port: u16,
    /// `ALBAS_SYNC_TOKEN`: the `owner` account's `env`-labelled token.
    pub(crate) owner_token: Option<String>,
    /// `ALBAS_SYNC_SIGNUPS`: `open` (default) or `invite`.
    pub(crate) signups: Signups,
    /// `ALBAS_SYNC_ASSETLINKS`: served verbatim at `/.well-known/assetlinks.json`.
    pub(crate) assetlinks: Option<String>,
    /// `ALBAS_SYNC_ORIGIN` / `ALBAS_SYNC_ANDROID_ORIGIN`: passkeys, off when
    /// the first is unset.
    pub(crate) origin: Option<String>,
    pub(crate) android_origin: Option<String>,
    /// The three `ALBAS_SYNC_GOOGLE_*` vars, all or none.
    pub(crate) google: Option<GoogleConfig>,
    /// `ALBAS_SYNC_KEK`: the AES-256-GCM key TOTP secrets are stored under.
    pub(crate) kek: Option<[u8; 32]>,
}

impl Config {
    pub(crate) fn from_env() -> Result<Config, String> {
        let addr = var("ALBAS_SYNC_ADDR").unwrap_or_else(|| "0.0.0.0:8787".into());
        let health_port = match var("ALBAS_SYNC_PORT") {
            Some(p) => p
                .parse()
                .map_err(|_| format!("ALBAS_SYNC_PORT is not a port number: '{p}'"))?,
            None => port_of(&addr).unwrap_or(8787),
        };
        let signups = match var("ALBAS_SYNC_SIGNUPS").as_deref() {
            None | Some("open") => Signups::Open,
            Some("invite") => Signups::InviteOnly,
            Some(other) => {
                return Err(format!(
                    "ALBAS_SYNC_SIGNUPS must be 'open' or 'invite', not '{other}'"
                ))
            }
        };
        Ok(Config {
            db_path: var("ALBAS_SYNC_DB").unwrap_or_else(|| "/data/albas-sync.db".into()),
            addr,
            health_port,
            owner_token: token_var("ALBAS_SYNC_TOKEN")?,
            signups,
            assetlinks: var("ALBAS_SYNC_ASSETLINKS"),
            origin: var("ALBAS_SYNC_ORIGIN"),
            android_origin: var("ALBAS_SYNC_ANDROID_ORIGIN"),
            google: GoogleConfig::from_env()?,
            kek: kek_from(var("ALBAS_SYNC_KEK"))?,
        })
    }
}

/// A trimmed env var; unset and blank are both `None`.
pub(crate) fn var(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// A token-valued env var, refusing weak values.
fn token_var(name: &str) -> Result<Option<String>, String> {
    match var(name) {
        Some(v) if v.len() < 16 => Err(format!("{name} is too short; use at least 16 characters")),
        v => Ok(v),
    }
}

fn port_of(addr: &str) -> Option<u16> {
    addr.rsplit(':').next()?.trim().parse().ok()
}

/// `ALBAS_SYNC_KEK` decoded. Unset is "no key" (TOTP enrollment answers 503),
/// but a value that is set and wrong refuses to boot: a KEK that silently
/// read as absent would make password login fail closed for every account
/// that has TOTP turned on, with nothing in the log at startup to say why.
fn kek_from(raw: Option<String>) -> Result<Option<[u8; 32]>, String> {
    let Some(raw) = raw else {
        return Ok(None);
    };
    let bytes = B64
        .decode(&raw)
        .map_err(|e| format!("ALBAS_SYNC_KEK is not valid base64: {e}"))?;
    bytes.try_into().map(Some).map_err(|b: Vec<u8>| {
        format!(
            "ALBAS_SYNC_KEK must decode to exactly 32 bytes, not {}",
            b.len()
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn port_of_reads_the_last_colon_group() {
        assert_eq!(port_of("0.0.0.0:8787"), Some(8787));
        assert_eq!(port_of("[::]:9000"), Some(9000));
        assert_eq!(port_of("nonsense"), None);
    }

    #[test]
    fn kek_must_be_32_base64_bytes_or_absent() {
        assert_eq!(kek_from(None).unwrap(), None);
        let good = B64.encode([9u8; 32]);
        assert_eq!(kek_from(Some(good)).unwrap(), Some([9u8; 32]));
        assert!(kek_from(Some("not base64!".into())).is_err());
        assert!(kek_from(Some(B64.encode([9u8; 16]))).is_err());
    }
}
