//! Self-service bearer-token routes (Settings -> Sessions).

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use rusqlite::params;
use serde::Serialize;
use std::sync::Arc;

use crate::auth::Authed;
use crate::error::{internal, unauthorized, Rejection};
use crate::AppState;

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
    auth: Authed,
) -> Result<Json<Vec<SelfTokenInfo>>, Rejection> {
    state
        .db(move |conn| {
            let mut stmt = conn
                .prepare(
                    "SELECT id, label, created_at, expires_at, last_used_at, token_hash
                     FROM tokens WHERE account_id = ?1 ORDER BY created_at",
                )
                .map_err(internal)?;
            let out = stmt
                .query_map([auth.account_id], |r| {
                    let hash: String = r.get(5)?;
                    Ok(SelfTokenInfo {
                        id: r.get(0)?,
                        label: r.get(1)?,
                        created_at: r.get(2)?,
                        expires_at: r.get(3)?,
                        last_used_at: r.get(4)?,
                        current: hash == auth.token_hash,
                    })
                })
                .and_then(|rows| rows.collect::<rusqlite::Result<Vec<_>>>())
                .map_err(internal)?;
            Ok(Json(out))
        })
        .await
}

/// Revokes the token this very request is authenticated with — "sign out this
/// device", the alias `sync_sign_out` calls best-effort before clearing local
/// state. `id` is deliberately not accepted here; `DELETE /tokens/:id` covers
/// that, and would let a caller mistype an id and be told nothing changed.
pub(crate) async fn tokens_delete_current(
    State(state): State<Arc<AppState>>,
    auth: Authed,
) -> Result<StatusCode, Rejection> {
    state
        .db(move |conn| {
            let n = conn
                .execute(
                    "DELETE FROM tokens WHERE token_hash = ?1",
                    [&auth.token_hash],
                )
                .map_err(internal)?;
            if n == 0 {
                return Err(unauthorized());
            }
            Ok(StatusCode::NO_CONTENT)
        })
        .await
}

/// Revokes one other session by id — scoped to the caller's own account, so
/// naming another account's token id 404s exactly like an unknown one.
pub(crate) async fn tokens_delete_one(
    State(state): State<Arc<AppState>>,
    auth: Authed,
    Path(id): Path<i64>,
) -> Result<StatusCode, Rejection> {
    state
        .db(move |conn| {
            let n = conn
                .execute(
                    "DELETE FROM tokens WHERE id = ?1 AND account_id = ?2",
                    params![id, auth.account_id],
                )
                .map_err(internal)?;
            if n == 0 {
                return Err((StatusCode::NOT_FOUND, "No such session.".into()));
            }
            Ok(StatusCode::NO_CONTENT)
        })
        .await
}

/// "Sign out everywhere else" — every token on the account except the one
/// this request used.
pub(crate) async fn tokens_delete_others(
    State(state): State<Arc<AppState>>,
    auth: Authed,
) -> Result<StatusCode, Rejection> {
    state
        .db(move |conn| {
            conn.execute(
                "DELETE FROM tokens WHERE account_id = ?1 AND token_hash != ?2",
                params![auth.account_id, auth.token_hash],
            )
            .map_err(internal)?;
            Ok(StatusCode::NO_CONTENT)
        })
        .await
}
