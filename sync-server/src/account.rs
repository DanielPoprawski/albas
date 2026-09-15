//! Account names, and the self-service account routes: deletion and export.

use axum::{extract::State, http::StatusCode, Json};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;

use crate::admin_db::delete_account_rows;
use crate::auth::Authed;
use crate::error::{internal, Rejection};
use crate::sync::Change;
use crate::{password, AppState};

pub(crate) const NAME_RULE: &str = "account names are 1-64 characters: letters, digits, '-' or '_'";

pub(crate) fn name_ok(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

#[derive(Deserialize)]
pub(crate) struct DeleteAccountReq {
    password: String,
}

/// The self-service counterpart of the admin `account delete`: same steps,
/// but authenticated by bearer token + a re-typed password rather than a
/// shell in the container, and always scoped to the caller's own account.
pub(crate) async fn self_delete_account(
    State(state): State<Arc<AppState>>,
    auth: Authed,
    Json(body): Json<DeleteAccountReq>,
) -> Result<StatusCode, Rejection> {
    state
        .db(move |conn| {
            password::verify_account_password(conn, auth.account_id, &body.password)?;
            let tx = conn.transaction().map_err(internal)?;
            delete_account_rows(&tx, auth.account_id).map_err(internal)?;
            tx.commit().map_err(internal)?;
            Ok(StatusCode::NO_CONTENT)
        })
        .await
}

/// Every non-deleted row this account owns, as JSON — the "download your
/// data" self-service export. Payloads included, on purpose: this is the
/// account owner asking for their own data back, not an operator browsing
/// bookkeeping columns.
pub(crate) async fn account_export(
    State(state): State<Arc<AppState>>,
    auth: Authed,
) -> Result<Json<Value>, Rejection> {
    state
        .db(move |conn| {
            let (name, created_at): (String, i64) = conn
                .query_row(
                    "SELECT name, created_at FROM accounts WHERE id = ?1",
                    [auth.account_id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .map_err(internal)?;
            let mut stmt = conn
                .prepare(
                    "SELECT tbl, pk, payload, updated_at, deleted FROM rows
                     WHERE account_id = ?1 AND deleted = 0 ORDER BY tbl, pk",
                )
                .map_err(internal)?;
            let rows = stmt
                .query_map([auth.account_id], |r| {
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
                .map_err(internal)?;
            Ok(Json(json!({
                "account": { "name": name, "createdAt": created_at },
                "rows": rows,
            })))
        })
        .await
}
