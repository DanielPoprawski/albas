//! Self-service bearer-token routes (Settings -> Sessions).

use axum::{extract::{Path, State}, http::{HeaderMap, StatusCode}, Json};
use rusqlite::params;
use serde::Serialize;
use std::sync::Arc;

use crate::{account_for, bearer, token_hash, AppState};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SelfTokenInfo {
    id: i64,
    label: String,
    created_at: i64,
    expires_at: i64,
    last_used_at: i64,
    /// Whether this is the token the request itself was authenticated with —
    /// so the client can label "this device" and warn before revoking it.
    current: bool,
}

pub(crate) async fn tokens_list(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<SelfTokenInfo>>, StatusCode> {
    let guard = state.conn.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let account_id = account_for(&guard, &headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let current_hash = bearer(&headers).map(token_hash).unwrap_or_default();
    let mut stmt = guard
        .prepare(
            "SELECT id, label, created_at, expires_at, last_used_at, token_hash
             FROM tokens WHERE account_id = ?1 ORDER BY created_at",
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let out = stmt
        .query_map([account_id], |r| {
            let hash: String = r.get(5)?;
            Ok(SelfTokenInfo {
                id: r.get(0)?,
                label: r.get(1)?,
                created_at: r.get(2)?,
                expires_at: r.get(3)?,
                last_used_at: r.get(4)?,
                current: hash == current_hash,
            })
        })
        .and_then(|rows| rows.collect::<rusqlite::Result<Vec<_>>>())
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(out))
}

/// Revokes the token this very request is authenticated with — "sign out this
/// device", the alias `sync_sign_out` calls best-effort before clearing local
/// state. `id` is deliberately not accepted here; `DELETE /tokens/:id` covers
/// that, and would let a caller mistype an id and be told nothing changed.
pub(crate) async fn tokens_delete_current(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<StatusCode, StatusCode> {
    let guard = state.conn.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let token = bearer(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let n = guard
        .execute("DELETE FROM tokens WHERE token_hash = ?1", [token_hash(token)])
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if n == 0 {
        return Err(StatusCode::UNAUTHORIZED);
    }
    Ok(StatusCode::NO_CONTENT)
}

/// Revokes one other session by id — scoped to the caller's own account, so
/// naming another account's token id 404s exactly like an unknown one.
pub(crate) async fn tokens_delete_one(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<StatusCode, StatusCode> {
    let guard = state.conn.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let account_id = account_for(&guard, &headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let n = guard
        .execute(
            "DELETE FROM tokens WHERE id = ?1 AND account_id = ?2",
            params![id, account_id],
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if n == 0 {
        return Err(StatusCode::NOT_FOUND);
    }
    Ok(StatusCode::NO_CONTENT)
}

/// "Sign out everywhere else" — every token on the account except the one
/// this request used.
pub(crate) async fn tokens_delete_others(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<StatusCode, StatusCode> {
    let guard = state.conn.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let account_id = account_for(&guard, &headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let token = bearer(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    guard
        .execute(
            "DELETE FROM tokens WHERE account_id = ?1 AND token_hash != ?2",
            params![account_id, token_hash(token)],
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::NO_CONTENT)
}
