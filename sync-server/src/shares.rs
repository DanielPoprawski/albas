//! Self-service `/shares` routes: who the bearer account shares with and who
//! shares with it. The admin counterpart is `admin_db::set_share_db`.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::Arc;

use crate::auth::Authed;
use crate::error::{internal, Rejection};
use crate::AppState;

/// One grant, either direction. A grant is all-or-nothing, so the name is
/// the whole record.
#[derive(Serialize)]
pub(crate) struct ShareInfo {
    name: String,
}

#[derive(Serialize)]
pub(crate) struct SharesRes {
    outgoing: Vec<ShareInfo>,
    incoming: Vec<ShareInfo>,
}

pub(crate) async fn shares_get(
    State(state): State<Arc<AppState>>,
    auth: Authed,
) -> Result<Json<SharesRes>, Rejection> {
    state
        .db(move |conn| {
            let me = auth.account_id;
            let list = |sql: &str| -> Result<Vec<ShareInfo>, Rejection> {
                let mut stmt = conn.prepare(sql).map_err(internal)?;
                stmt.query_map([me], |r| Ok(ShareInfo { name: r.get(0)? }))
                    .and_then(|rows| rows.collect())
                    .map_err(internal)
            };
            let outgoing = list(
                "SELECT a.name FROM shares s
                 JOIN accounts a ON a.id = s.grantee_id WHERE s.owner_id = ?1 ORDER BY a.name",
            )?;
            let incoming = list(
                "SELECT a.name FROM shares s
                 JOIN accounts a ON a.id = s.owner_id WHERE s.grantee_id = ?1 ORDER BY a.name",
            )?;
            Ok(Json(SharesRes { outgoing, incoming }))
        })
        .await
}

pub(crate) async fn shares_put(
    State(state): State<Arc<AppState>>,
    auth: Authed,
    Path(name): Path<String>,
) -> Result<Json<Value>, Rejection> {
    state
        .db(move |conn| set_share(conn, auth.account_id, &name, true))
        .await
}

pub(crate) async fn shares_delete(
    State(state): State<Arc<AppState>>,
    auth: Authed,
    Path(name): Path<String>,
) -> Result<Json<Value>, Rejection> {
    state
        .db(move |conn| set_share(conn, auth.account_id, &name, false))
        .await
}

/// `{"ok": true}` on success, `{"ok": false}` (still 200, not 404) for an
/// unknown grantee name — a 404 here would let anyone probe which account
/// names exist on the server just by trying to share with them.
fn set_share(
    conn: &mut Connection,
    me: i64,
    grantee_name: &str,
    grant: bool,
) -> Result<Json<Value>, Rejection> {
    let tx = conn.transaction().map_err(internal)?;
    let grantee: Option<i64> = tx
        .query_row(
            "SELECT id FROM accounts WHERE name = ?1",
            [grantee_name],
            |r| r.get(0),
        )
        .optional()
        .map_err(internal)?;
    let Some(grantee) = grantee else {
        return Ok(Json(json!({ "ok": false })));
    };
    if grantee == me {
        return Err((
            StatusCode::UNPROCESSABLE_ENTITY,
            "An account cannot share with itself.".into(),
        ));
    }
    // The row's existence is the grant; the legacy `calendar`/`todos`
    // columns stay at their defaults and are never read.
    if grant {
        tx.execute(
            "INSERT INTO shares (owner_id, grantee_id) VALUES (?1, ?2)
             ON CONFLICT(owner_id, grantee_id) DO NOTHING",
            params![me, grantee],
        )
        .map_err(internal)?;
    } else {
        tx.execute(
            "DELETE FROM shares WHERE owner_id = ?1 AND grantee_id = ?2",
            params![me, grantee],
        )
        .map_err(internal)?;
    }
    // Any grant change invalidates the grantee's shared snapshot.
    tx.execute(
        "UPDATE accounts SET grant_rev = grant_rev + 1 WHERE id = ?1",
        [grantee],
    )
    .map_err(internal)?;
    tx.commit().map_err(internal)?;
    Ok(Json(json!({ "ok": true })))
}
