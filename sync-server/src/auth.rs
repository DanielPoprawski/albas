//! Bearer tokens: minting, hashing, lookup with the sliding expiry, and the
//! `Authed` extractor every authenticated route takes instead of reading the
//! `Authorization` header itself.

use axum::{
    async_trait,
    extract::FromRequestParts,
    http::{request::Parts, HeaderMap},
};
use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};
use std::sync::Arc;

use crate::error::{unauthorized, Rejection};
use crate::{now_ms, AppState};

/// A bearer token's sliding idle expiry: 90 days from the last time it was
/// used, extended (see `account_for_token`) rather than fixed from minting,
/// so a device someone actually uses never has to re-authenticate.
pub(crate) const TOKEN_TTL_MS: i64 = 90 * 24 * 60 * 60 * 1000;
/// `account_for_token` only rewrites `expires_at`/`last_used_at` this often —
/// every authenticated request sliding the watermark would be a write on
/// every `/sync`, for no observable benefit over touching it hourly.
pub(crate) const TOKEN_TOUCH_INTERVAL_MS: i64 = 60 * 60 * 1000;

pub(crate) fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub(crate) fn token_hash(token: &str) -> String {
    to_hex(&Sha256::digest(token.as_bytes()))
}

pub(crate) fn random_token() -> String {
    let mut buf = [0u8; 32];
    getrandom::getrandom(&mut buf).expect("OS randomness unavailable");
    to_hex(&buf)
}

/// Mints a fresh bearer token for an account and stores its hash. Starts with
/// the full 90-day sliding window, which `account_for_token` then extends.
pub(crate) fn mint_token(
    conn: &Connection,
    account_id: i64,
    label: &str,
) -> rusqlite::Result<String> {
    let token = random_token();
    let now = now_ms();
    conn.execute(
        "INSERT INTO tokens (account_id, token_hash, label, created_at, expires_at, last_used_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?4)",
        params![
            account_id,
            token_hash(&token),
            label,
            now,
            now + TOKEN_TTL_MS
        ],
    )?;
    Ok(token)
}

pub(crate) fn bearer(headers: &HeaderMap) -> Option<&str> {
    headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
}

/// Maps a presented token to its account. Lookup is by SHA-256, so response
/// timing reveals nothing useful about any stored credential.
///
/// Also enforces and slides the token's expiry: a token past `expires_at` is
/// treated as absent (401 further up the stack), and one used after its last
/// touch is more than an hour old gets both `expires_at` and `last_used_at`
/// pushed forward — so an idle-but-abandoned token eventually expires, while
/// a device syncing regularly never has to re-authenticate.
pub(crate) fn account_for_token(conn: &Connection, token: &str) -> Option<i64> {
    let hash = token_hash(token);
    let (token_id, account_id, expires_at, last_used_at): (i64, i64, i64, i64) = conn
        .query_row(
            "SELECT id, account_id, expires_at, last_used_at FROM tokens WHERE token_hash = ?1",
            [&hash],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()
        .ok()
        .flatten()?;
    let now = now_ms();
    if expires_at <= now {
        return None;
    }
    if now - last_used_at > TOKEN_TOUCH_INTERVAL_MS {
        // Best-effort: a failed touch must not turn a valid token into a 401.
        let _ = conn.execute(
            "UPDATE tokens SET expires_at = ?1, last_used_at = ?2 WHERE id = ?3",
            params![now + TOKEN_TTL_MS, now, token_id],
        );
    }
    Some(account_id)
}

/// `account_for_token` for a request's headers — what tests that build
/// their own `HeaderMap` use; handlers go through `Authed`.
#[cfg(test)]
pub(crate) fn account_for(conn: &Connection, headers: &HeaderMap) -> Option<i64> {
    bearer(headers).and_then(|token| account_for_token(conn, token))
}

/// The signed-in account behind a request's bearer token. As an extractor it
/// runs before the handler and answers 401 itself, so a route that takes
/// `Authed` cannot forget the check. `token_hash` identifies the session the
/// request came in on, for the routes that treat "this device" specially.
#[derive(Debug)]
pub(crate) struct Authed {
    pub(crate) account_id: i64,
    pub(crate) token_hash: String,
}

#[async_trait]
impl FromRequestParts<Arc<AppState>> for Authed {
    type Rejection = Rejection;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &Arc<AppState>,
    ) -> Result<Self, Rejection> {
        let token = bearer(&parts.headers).ok_or_else(unauthorized)?.to_string();
        state
            .db(move |conn| {
                Ok(account_for_token(conn, &token).map(|account_id| Authed {
                    account_id,
                    token_hash: token_hash(&token),
                }))
            })
            .await?
            .ok_or_else(unauthorized)
    }
}
