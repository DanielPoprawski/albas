//! Self-service account deletion and export.

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;

use crate::{account_for, delete_account_rows, password, AppState, Change};

#[derive(Deserialize)]
pub(crate) struct DeleteAccountReq {
    password: String,
}

/// The self-service counterpart of the admin `delete_account`: same steps,
/// but authenticated by bearer token + a re-typed password rather than the
/// admin token, and always scoped to the caller's own account.
pub(crate) async fn self_delete_account(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<DeleteAccountReq>,
) -> Result<StatusCode, (StatusCode, String)> {
    let mut guard = state
        .conn
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let account_id =
        account_for(&guard, &headers).ok_or((StatusCode::UNAUTHORIZED, "Unauthorized".into()))?;
    password::verify_account_password(&guard, account_id, &body.password)?;
    let tx = guard
        .transaction()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    delete_account_rows(&tx, account_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    tx.commit()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}

/// Every non-deleted row this account owns, as JSON — the "download your
/// data" self-service export. Payloads included, on purpose: this is the
/// account owner asking for their own data back, not an operator browsing
/// bookkeeping columns.
pub(crate) async fn account_export(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, StatusCode> {
    let guard = state
        .conn
        .lock()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let account_id = account_for(&guard, &headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let (name, created_at): (String, i64) = guard
        .query_row(
            "SELECT name, created_at FROM accounts WHERE id = ?1",
            [account_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let mut stmt = guard
        .prepare(
            "SELECT tbl, pk, payload, updated_at, deleted FROM rows
             WHERE account_id = ?1 AND deleted = 0 ORDER BY tbl, pk",
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let rows = stmt
        .query_map([account_id], |r| {
            Ok(Change {
                tbl: r.get(0)?,
                pk: r.get(1)?,
                payload: serde_json::from_str(&r.get::<_, String>(2)?)
                    .unwrap_or(serde_json::Value::Null),
                updated_at: r.get(3)?,
                deleted: r.get::<_, i64>(4)? != 0,
                seq: 0,
            })
        })
        .and_then(|rows| rows.collect::<rusqlite::Result<Vec<_>>>())
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(json!({
        "account": { "name": name, "createdAt": created_at },
        "rows": rows,
    })))
}
