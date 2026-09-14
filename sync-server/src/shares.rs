//! Self-service `/shares` routes: who the bearer account shares with and who
//! shares with it. The admin counterpart (`set_share_db`) stays in `main.rs`.

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;

use crate::{account_for, AppState};

#[derive(Deserialize)]
pub(crate) struct ShareBody {
    calendar: bool,
    todos: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShareInfo {
    name: String,
    calendar: bool,
    todos: bool,
}

#[derive(Serialize)]
pub(crate) struct SharesRes {
    outgoing: Vec<ShareInfo>,
    incoming: Vec<ShareInfo>,
}

pub(crate) async fn shares_get(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<SharesRes>, StatusCode> {
    let guard = state
        .conn
        .lock()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let me = account_for(&guard, &headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let list = |sql: &str| -> Result<Vec<ShareInfo>, StatusCode> {
        let mut stmt = guard
            .prepare(sql)
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        stmt.query_map([me], |r| {
            Ok(ShareInfo {
                name: r.get(0)?,
                calendar: r.get::<_, i64>(1)? != 0,
                todos: r.get::<_, i64>(2)? != 0,
            })
        })
        .and_then(|rows| rows.collect())
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
    };
    let outgoing = list(
        "SELECT a.name, s.calendar, s.todos FROM shares s
         JOIN accounts a ON a.id = s.grantee_id WHERE s.owner_id = ?1 ORDER BY a.name",
    )?;
    let incoming = list(
        "SELECT a.name, s.calendar, s.todos FROM shares s
         JOIN accounts a ON a.id = s.owner_id WHERE s.grantee_id = ?1 ORDER BY a.name",
    )?;
    Ok(Json(SharesRes { outgoing, incoming }))
}

pub(crate) async fn shares_put(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(name): Path<String>,
    Json(body): Json<ShareBody>,
) -> Result<Json<Value>, StatusCode> {
    set_share(&state, &headers, &name, body.calendar, body.todos)
}

pub(crate) async fn shares_delete(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(name): Path<String>,
) -> Result<Json<Value>, StatusCode> {
    set_share(&state, &headers, &name, false, false)
}

/// `{"ok": true}` on success, `{"ok": false}` (still 200, not 404) for an
/// unknown grantee name — a 404 here would let anyone probe which account
/// names exist on the server just by trying to share with them.
fn set_share(
    state: &AppState,
    headers: &HeaderMap,
    grantee_name: &str,
    calendar: bool,
    todos: bool,
) -> Result<Json<Value>, StatusCode> {
    let mut guard = state
        .conn
        .lock()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let me = account_for(&guard, headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let tx = guard
        .transaction()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let grantee: Option<i64> = tx
        .query_row(
            "SELECT id FROM accounts WHERE name = ?1",
            [grantee_name],
            |r| r.get(0),
        )
        .optional()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let Some(grantee) = grantee else {
        return Ok(Json(json!({ "ok": false })));
    };
    if grantee == me {
        return Err(StatusCode::UNPROCESSABLE_ENTITY);
    }
    if !calendar && !todos {
        tx.execute(
            "DELETE FROM shares WHERE owner_id = ?1 AND grantee_id = ?2",
            params![me, grantee],
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    } else {
        tx.execute(
            "INSERT INTO shares (owner_id, grantee_id, calendar, todos) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(owner_id, grantee_id) DO UPDATE SET
               calendar = excluded.calendar, todos = excluded.todos",
            params![me, grantee, calendar as i64, todos as i64],
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }
    // Any grant change invalidates the grantee's shared snapshot.
    tx.execute(
        "UPDATE accounts SET grant_rev = grant_rev + 1 WHERE id = ?1",
        [grantee],
    )
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    tx.commit().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(json!({ "ok": true })))
}
